import { Hono } from "hono";
import type { Env, SyncResult } from "../types";
import {
  encodeLinearIssue,
  encodeLinearLabel,
  encodeLinearProject,
  type LinearIssueRow,
  type LinearLabelRow,
  type LinearProjectRow,
} from "./parquet";

const app = new Hono<{ Bindings: Env }>();

// --- Types ---

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  estimate: number | null;
  state: { name: string; type: string } | null;
  labels: { nodes: { name: string }[] };
  project: { name: string } | null;
  cycle: { number: number } | null;
  assignee: { name: string } | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  dueDate: string | null;
}

interface LinearProject {
  id: string;
  name: string;
  state: string;
  progress: number;
  startDate: string | null;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

// --- GraphQL Client ---

async function fetchLinearGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  apiKey: string
): Promise<T> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Linear API error: ${res.status}`);
  }

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
  }
  return json.data as T;
}

// --- Pagination Helper ---

async function fetchAllPages<T>(apiKey: string, query: string, rootField: string): Promise<T[]> {
  const results: T[] = [];
  let after: string | null = null;

  type Connection = Record<string, { nodes: T[]; pageInfo: PageInfo }>;
  do {
    const data: Connection = await fetchLinearGraphQL<Connection>(
      query,
      { first: 50, after },
      apiKey
    );
    const connection = data[rootField];
    results.push(...connection.nodes);
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);

  return results;
}

// --- GraphQL Queries ---

const ISSUES_QUERY = `
  query Issues($first: Int!, $after: String) {
    issues(first: $first, after: $after, orderBy: updatedAt) {
      nodes {
        id identifier title description
        priority estimate
        state { name type }
        labels { nodes { name } }
        project { name }
        cycle { number }
        assignee { name }
        createdAt updatedAt startedAt completedAt canceledAt
        dueDate
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PROJECTS_QUERY = `
  query Projects($first: Int!, $after: String) {
    projects(first: $first, after: $after) {
      nodes {
        id name state progress
        startDate targetDate
        createdAt updatedAt completedAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const LABELS_QUERY = `
  query Labels {
    issueLabels(first: 250) {
      nodes { id name color }
    }
  }
`;

// --- Main Sync ---

export async function runSync(env: Env): Promise<SyncResult> {
  const { LINEAR_API_KEY: apiKey, DATA_LAKE: r2, PARQUET_ENCODER: encoder } = env;

  const synced_at = new Date().toISOString();

  // 1. Fetch & write issues → linear/issues.parquet (snapshot)
  const issues = await fetchAllPages<LinearIssue>(apiKey, ISSUES_QUERY, "issues");
  const issueRows: LinearIssueRow[] = issues.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description_length: issue.description?.length ?? 0,
    priority: issue.priority,
    estimate: issue.estimate,
    state_name: issue.state?.name ?? null,
    state_type: issue.state?.type ?? null,
    label_names: JSON.stringify(issue.labels.nodes.map((l) => l.name)),
    project_name: issue.project?.name ?? null,
    cycle_number: issue.cycle?.number ?? null,
    assignee_name: issue.assignee?.name ?? null,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    started_at: issue.startedAt,
    completed_at: issue.completedAt,
    canceled_at: issue.canceledAt,
    due_date: issue.dueDate,
    synced_at,
  }));
  if (issueRows.length > 0) {
    const parquet = await encodeLinearIssue(encoder, issueRows);
    await r2.put("linear/issues.parquet", parquet);
  }

  // 2. Fetch & write projects → linear/projects.parquet (snapshot)
  const projects = await fetchAllPages<LinearProject>(apiKey, PROJECTS_QUERY, "projects");
  const projectRows: LinearProjectRow[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    state: project.state,
    progress: project.progress,
    start_date: project.startDate,
    target_date: project.targetDate,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    completed_at: project.completedAt,
    synced_at,
  }));
  if (projectRows.length > 0) {
    const parquet = await encodeLinearProject(encoder, projectRows);
    await r2.put("linear/projects.parquet", parquet);
  }

  // 3. Fetch & write labels → linear/labels.parquet (snapshot)
  const labelsData = await fetchLinearGraphQL<{ issueLabels: { nodes: LinearLabel[] } }>(
    LABELS_QUERY,
    {},
    apiKey
  );
  const labels = labelsData.issueLabels.nodes;
  const labelRows: LinearLabelRow[] = labels.map((label) => ({
    id: label.id,
    name: label.name,
    color: label.color,
    synced_at,
  }));
  if (labelRows.length > 0) {
    const parquet = await encodeLinearLabel(encoder, labelRows);
    await r2.put("linear/labels.parquet", parquet);
  }

  // Update sync_state
  await env.DB.prepare(
    "UPDATE sync_state SET last_sync_at = datetime('now') WHERE data_source_id = 'linear'"
  ).run();

  return {
    service: "linear",
    success: true,
    message: `Synced ${issues.length} issues, ${projects.length} projects, ${labels.length} labels to R2 Parquet`,
    count: issues.length,
  };
}

// --- Routes ---

app.post("/sync", async (c) => {
  const result = await runSync(c.env);
  return c.json(result);
});

app.get("/stats", async (c) => {
  const r2 = c.env.DATA_LAKE;
  const files = ["linear/issues.parquet", "linear/projects.parquet", "linear/labels.parquet"];
  const stats: Record<string, string | null> = {};

  for (const file of files) {
    const obj = await r2.head(file);
    const key = file.split("/").pop()?.replace(".parquet", "") ?? file;
    stats[key] = obj ? new Date(obj.uploaded).toISOString() : null;
  }

  const syncState = await c.env.DB.prepare(
    "SELECT last_sync_at FROM sync_state WHERE data_source_id = 'linear'"
  ).first<{ last_sync_at: string | null }>();

  return c.json({ ...stats, last_sync: syncState?.last_sync_at ?? null });
});

export default app;
