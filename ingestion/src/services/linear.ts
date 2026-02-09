import { Hono } from "hono";
import type { Env, SyncResult } from "../types";

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

// --- Sync Functions ---

async function syncIssues(db: D1Database, apiKey: string): Promise<number> {
  const issues = await fetchAllPages<LinearIssue>(apiKey, ISSUES_QUERY, "issues");

  const statements = issues.map((issue) => {
    const labelNames = JSON.stringify(issue.labels.nodes.map((l) => l.name));
    return db
      .prepare(
        `INSERT INTO linear_issues (id, identifier, title, description_length, priority, estimate,
           state_name, state_type, label_names, project_name, cycle_number, assignee_name,
           created_at, updated_at, started_at, completed_at, canceled_at, due_date, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           identifier = excluded.identifier,
           title = excluded.title,
           description_length = excluded.description_length,
           priority = excluded.priority,
           estimate = excluded.estimate,
           state_name = excluded.state_name,
           state_type = excluded.state_type,
           label_names = excluded.label_names,
           project_name = excluded.project_name,
           cycle_number = excluded.cycle_number,
           assignee_name = excluded.assignee_name,
           updated_at = excluded.updated_at,
           started_at = excluded.started_at,
           completed_at = excluded.completed_at,
           canceled_at = excluded.canceled_at,
           due_date = excluded.due_date,
           synced_at = excluded.synced_at`
      )
      .bind(
        issue.id,
        issue.identifier,
        issue.title,
        issue.description?.length ?? 0,
        issue.priority,
        issue.estimate,
        issue.state?.name ?? null,
        issue.state?.type ?? null,
        labelNames,
        issue.project?.name ?? null,
        issue.cycle?.number ?? null,
        issue.assignee?.name ?? null,
        issue.createdAt,
        issue.updatedAt,
        issue.startedAt,
        issue.completedAt,
        issue.canceledAt,
        issue.dueDate
      );
  });

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return issues.length;
}

async function syncProjects(db: D1Database, apiKey: string): Promise<number> {
  const projects = await fetchAllPages<LinearProject>(apiKey, PROJECTS_QUERY, "projects");

  const statements = projects.map((project) => {
    return db
      .prepare(
        `INSERT INTO linear_projects (id, name, state, progress, start_date, target_date,
           created_at, updated_at, completed_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           state = excluded.state,
           progress = excluded.progress,
           start_date = excluded.start_date,
           target_date = excluded.target_date,
           updated_at = excluded.updated_at,
           completed_at = excluded.completed_at,
           synced_at = excluded.synced_at`
      )
      .bind(
        project.id,
        project.name,
        project.state,
        project.progress,
        project.startDate,
        project.targetDate,
        project.createdAt,
        project.updatedAt,
        project.completedAt
      );
  });

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return projects.length;
}

async function syncLabels(db: D1Database, apiKey: string): Promise<number> {
  const data = await fetchLinearGraphQL<{ issueLabels: { nodes: LinearLabel[] } }>(
    LABELS_QUERY,
    {},
    apiKey
  );
  const labels = data.issueLabels.nodes;

  const statements = labels.map((label) => {
    return db
      .prepare(
        `INSERT INTO linear_labels (id, name, color, synced_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           color = excluded.color,
           synced_at = excluded.synced_at`
      )
      .bind(label.id, label.name, label.color);
  });

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return labels.length;
}

// --- Main Sync ---

export async function runSync(env: Env): Promise<SyncResult> {
  const { DB: db, LINEAR_API_KEY: apiKey } = env;

  const issueCount = await syncIssues(db, apiKey);
  const projectCount = await syncProjects(db, apiKey);
  const labelCount = await syncLabels(db, apiKey);

  await db
    .prepare("UPDATE sync_state SET last_sync_at = datetime('now') WHERE data_source_id = 'linear'")
    .run();

  return {
    service: "linear",
    success: true,
    message: `Synced ${issueCount} issues, ${projectCount} projects, ${labelCount} labels`,
    count: issueCount,
  };
}

// --- Routes ---

app.post("/sync", async (c) => {
  const result = await runSync(c.env);
  return c.json(result);
});

app.get("/stats", async (c) => {
  const stats = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM linear_issues) as issues,
       (SELECT COUNT(*) FROM linear_projects) as projects,
       (SELECT COUNT(*) FROM linear_labels) as labels,
       (SELECT MAX(synced_at) FROM linear_issues) as last_sync`
  ).first();
  return c.json(stats);
});

app.get("/weekly", async (c) => {
  const results = await c.env.DB.prepare("SELECT * FROM v_linear_weekly_completion LIMIT 12").all();
  return c.json(results.results);
});

app.get("/labels", async (c) => {
  const results = await c.env.DB.prepare("SELECT * FROM v_linear_label_summary LIMIT 50").all();
  return c.json(results.results);
});

app.get("/projects", async (c) => {
  const results = await c.env.DB.prepare("SELECT * FROM v_linear_project_progress").all();
  return c.json(results.results);
});

export default app;
