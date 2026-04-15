import { Container, ContainerProxy, getContainer } from "@cloudflare/containers";
import { DurableObject } from "cloudflare:workers";
import { DbtBuildWorkflow, type DbtBuildWorkflowParams } from "./workflow";

// Outbound Workers requires ContainerProxy export
export { ContainerProxy };
// Workflows binding requires the class to be exported from the entrypoint
export { DbtBuildWorkflow };

interface Env {
  DBT_CONTAINER: DurableObjectNamespace<DbtContainer>;
  JOB_REGISTRY: DurableObjectNamespace<JobRegistry>;
  DBT_BUILD_WORKFLOW: Workflow;
  DBT_ARTIFACTS: R2Bucket;
  // Required secrets
  SNOWFLAKE_ACCOUNT: string;
  SNOWFLAKE_USER: string;
  SNOWFLAKE_PRIVATE_KEY: string;
  API_KEY: string;
  // Optional: Slack webhook for notifications
  SLACK_WEBHOOK_URL?: string;
  WORKER_BASE_URL?: string;
}

// ---------------------------------------------------------------------------
// DbtContainer — Durable Object wrapping the dbt-runner container.
// ---------------------------------------------------------------------------

export class DbtContainer extends Container<Env> {
  defaultPort = 8080;
  // Stay alive for an hour after the last request so daily cron +
  // ad-hoc webhook triggers don't pay the 1-7 minute cold start
  // each time. Build invocations themselves keep the container
  // active.
  sleepAfter = "60m";

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    // Populate envVars in the constructor rather than as a class
    // field. The Container base class initializes `envVars = {}`
    // which can race with subclass field initializers, so we
    // assign after super() to be sure our values stick.
    this.envVars = {
      SNOWFLAKE_ACCOUNT: env.SNOWFLAKE_ACCOUNT,
      SNOWFLAKE_USER: env.SNOWFLAKE_USER,
      SNOWFLAKE_PRIVATE_KEY: env.SNOWFLAKE_PRIVATE_KEY,
    };
  }

  override onStart() {
    console.log("dbt-runner container started (modeling / Snowflake)");
  }

  override onStop() {
    console.log("dbt-runner container stopped");
  }

  override onError(error: unknown) {
    console.error("dbt-runner container error:", error);
  }
}

// Outbound Workers: Container -> http://r2.worker/{key} -> R2 binding
DbtContainer.outboundByHost = {
  "r2.worker": async (request: Request, env: Env) => {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);

    if (request.method === "PUT") {
      const body = await request.arrayBuffer();
      const contentType =
        request.headers.get("Content-Type") || "application/json";
      await env.DBT_ARTIFACTS.put(key, body, {
        httpMetadata: { contentType },
      });
      return new Response("OK", { status: 200 });
    }

    if (request.method === "GET") {
      const object = await env.DBT_ARTIFACTS.get(key);
      if (!object) {
        return new Response("Not Found", { status: 404 });
      }
      const contentType =
        object.httpMetadata?.contentType || "application/octet-stream";
      return new Response(object.body, {
        headers: { "Content-Type": contentType },
      });
    }

    return new Response("Method Not Allowed", { status: 405 });
  },
};

// ---------------------------------------------------------------------------
// JobRegistry — Singleton Durable Object enforcing latest-wins job scheduling.
//
// Only one dbt job is allowed to run at a time. When a new submission comes
// in, any currently-running job is cancelled (SIGTERM inside the container
// via POST /jobs/<id>/cancel) and marked as "cancelled", then the new job
// is started. The DO storage keeps the history of jobs so Workflows (and
// the operator) can read back state long after the container itself has
// forgotten.
// ---------------------------------------------------------------------------

export type JobState =
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "cancelled"
  | "error";

export interface JobRecord {
  id: string;
  state: JobState;
  command: string;
  target: "dev" | "prod";
  select?: string;
  full_refresh: boolean;
  started_at: string;
  finished_at?: string;
  returncode?: number;
  stdout_tail?: string;
  artifacts_saved?: string[];
  error?: string;
  source?: string; // 'cron' | 'webhook' | 'manual'
}

export interface JobSubmitParams {
  command?: string;
  target?: "dev" | "prod";
  select?: string;
  full_refresh?: boolean;
  source?: string;
}

const CURRENT_KEY = "current_job_id";
const JOB_PREFIX = "job:";
const MAX_JOB_HISTORY = 50;

export class JobRegistry extends DurableObject<Env> {
  async submit(params: JobSubmitParams): Promise<JobRecord> {
    const currentId = await this.ctx.storage.get<string>(CURRENT_KEY);
    if (currentId) {
      await this._cancelJob(currentId, "superseded by newer submission");
    }

    const containerRes = await this._containerFetch("/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: params.command ?? "build",
        target: params.target ?? "dev",
        select: params.select,
        full_refresh: params.full_refresh ?? false,
      }),
    });

    if (!containerRes.ok) {
      const errText = await containerRes.text();
      throw new Error(`container /jobs failed: ${containerRes.status} ${errText}`);
    }

    const containerJob = (await containerRes.json()) as Partial<JobRecord>;
    const record: JobRecord = {
      id: containerJob.id!,
      state: (containerJob.state as JobState) ?? "queued",
      command: containerJob.command ?? params.command ?? "build",
      target: (containerJob.target as "dev" | "prod") ?? params.target ?? "dev",
      select: containerJob.select ?? params.select,
      full_refresh: containerJob.full_refresh ?? params.full_refresh ?? false,
      started_at: containerJob.started_at ?? new Date().toISOString(),
      finished_at: containerJob.finished_at,
      returncode: containerJob.returncode,
      stdout_tail: containerJob.stdout_tail,
      artifacts_saved: containerJob.artifacts_saved,
      error: containerJob.error,
      source: params.source,
    };

    await this.ctx.storage.put(CURRENT_KEY, record.id);
    await this._putJob(record);
    await this._evictHistory();

    return record;
  }

  async get(jobId: string): Promise<JobRecord | null> {
    // Try to refresh from the container first — the container keeps
    // the most up-to-date status while running.
    try {
      const res = await this._containerFetch(`/jobs/${jobId}`, { method: "GET" });
      if (res.ok) {
        const fresh = (await res.json()) as Partial<JobRecord>;
        const stored = await this._getJob(jobId);
        const merged: JobRecord = {
          ...(stored ?? ({} as JobRecord)),
          ...fresh,
          id: jobId,
          source: stored?.source,
        } as JobRecord;
        await this._putJob(merged);
        if (
          merged.state === "complete" ||
          merged.state === "failed" ||
          merged.state === "error"
        ) {
          const current = await this.ctx.storage.get<string>(CURRENT_KEY);
          if (current === jobId) {
            await this.ctx.storage.delete(CURRENT_KEY);
          }
        }
        return merged;
      }
    } catch (e) {
      console.warn("container /jobs fetch failed; falling back to storage", e);
    }
    return this._getJob(jobId);
  }

  async cancel(jobId: string): Promise<boolean> {
    return this._cancelJob(jobId, "cancelled via API");
  }

  async list(): Promise<JobRecord[]> {
    const entries = await this.ctx.storage.list<JobRecord>({ prefix: JOB_PREFIX });
    return Array.from(entries.values()).sort((a, b) =>
      (b.started_at ?? "").localeCompare(a.started_at ?? "")
    );
  }

  async current(): Promise<string | null> {
    return (await this.ctx.storage.get<string>(CURRENT_KEY)) ?? null;
  }

  // --- internals -------------------------------------------------------

  private async _cancelJob(jobId: string, reason: string): Promise<boolean> {
    try {
      await this._containerFetch(`/jobs/${jobId}/cancel`, { method: "POST" });
    } catch (e) {
      console.warn(`container cancel ${jobId} failed`, e);
    }
    const stored = await this._getJob(jobId);
    if (stored) {
      stored.state = "cancelled";
      stored.finished_at = new Date().toISOString();
      stored.error = reason;
      await this._putJob(stored);
    }
    const current = await this.ctx.storage.get<string>(CURRENT_KEY);
    if (current === jobId) {
      await this.ctx.storage.delete(CURRENT_KEY);
    }
    return stored !== null;
  }

  private async _containerFetch(path: string, init: RequestInit): Promise<Response> {
    const container = getContainer(this.env.DBT_CONTAINER, "dbt-runner-main");
    return container.fetch(`http://container${path}`, init);
  }

  private async _putJob(record: JobRecord): Promise<void> {
    await this.ctx.storage.put(`${JOB_PREFIX}${record.id}`, record);
  }

  private async _getJob(jobId: string): Promise<JobRecord | null> {
    return (await this.ctx.storage.get<JobRecord>(`${JOB_PREFIX}${jobId}`)) ?? null;
  }

  private async _evictHistory(): Promise<void> {
    const entries = await this.ctx.storage.list<JobRecord>({ prefix: JOB_PREFIX });
    if (entries.size <= MAX_JOB_HISTORY) return;
    const sorted = Array.from(entries.entries()).sort((a, b) =>
      (a[1].started_at ?? "").localeCompare(b[1].started_at ?? "")
    );
    const toDelete = sorted.slice(0, entries.size - MAX_JOB_HISTORY);
    for (const [key] of toDelete) {
      await this.ctx.storage.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Worker fetch handler
// ---------------------------------------------------------------------------

function getRegistry(env: Env): DurableObjectStub<JobRegistry> {
  const id = env.JOB_REGISTRY.idFromName("singleton");
  return env.JOB_REGISTRY.get(id);
}

function authenticate(request: Request, env: Env): Response | null {
  if (request.method === "GET") return null;
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${env.API_KEY}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const container = getContainer(env.DBT_CONTAINER, "dbt-runner-main");

    // --- unauthenticated health probes --------------------------------
    if (path === "/health") {
      try {
        const res = await container.fetch("http://container/health");
        return new Response(res.body, {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        return Response.json(
          { status: "error", error: "container unavailable" },
          { status: 503 }
        );
      }
    }

    if (path === "/debug-env") {
      try {
        const res = await container.fetch("http://container/debug-env");
        return new Response(res.body, {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        return Response.json(
          { error: `debug-env failed: ${(e as Error).message}` },
          { status: 503 }
        );
      }
    }

    // --- authenticated paths ------------------------------------------
    const authError = authenticate(request, env);
    if (authError) return authError;

    // Force-restart the container (for operational recovery)
    if (request.method === "POST" && path === "/restart") {
      try {
        await container.destroy();
        return Response.json({ status: "restarted" });
      } catch (e) {
        return Response.json(
          { error: `restart failed: ${(e as Error).message}` },
          { status: 500 }
        );
      }
    }

    // Workflow trigger -- primary entry for external schedulers / webhooks.
    if (request.method === "POST" && path === "/workflows/build") {
      let body: DbtBuildWorkflowParams;
      try {
        body = (await request.json().catch(() => ({}))) as DbtBuildWorkflowParams;
      } catch {
        return Response.json({ error: "invalid JSON" }, { status: 400 });
      }
      const instance = await env.DBT_BUILD_WORKFLOW.create({
        params: { ...body, source: body.source ?? "webhook" },
      });
      return Response.json(
        { workflow_id: instance.id, status: await instance.status() },
        { status: 202 }
      );
    }

    if (
      request.method === "GET" &&
      path.startsWith("/workflows/build/instances/")
    ) {
      const instanceId = path.substring("/workflows/build/instances/".length);
      try {
        const instance = await env.DBT_BUILD_WORKFLOW.get(instanceId);
        return Response.json({ id: instanceId, status: await instance.status() });
      } catch (e) {
        return Response.json(
          { error: `workflow not found: ${(e as Error).message}` },
          { status: 404 }
        );
      }
    }

    // Async job lifecycle -- the primary API for Workflows / ops.
    if (request.method === "POST" && path === "/jobs") {
      let body: JobSubmitParams;
      try {
        body = (await request.json()) as JobSubmitParams;
      } catch {
        return Response.json({ error: "invalid JSON" }, { status: 400 });
      }
      const registry = getRegistry(env);
      try {
        const record = await registry.submit(body);
        return Response.json(record, { status: 202 });
      } catch (e) {
        return Response.json(
          { error: (e as Error).message },
          { status: 500 }
        );
      }
    }

    if (request.method === "GET" && path === "/jobs") {
      const registry = getRegistry(env);
      const jobs = await registry.list();
      const current = await registry.current();
      return Response.json({ current, jobs });
    }

    if (request.method === "GET" && path.startsWith("/jobs/")) {
      const jobId = path.substring("/jobs/".length);
      const registry = getRegistry(env);
      const record = await registry.get(jobId);
      if (!record) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json(record);
    }

    if (
      request.method === "POST" &&
      path.startsWith("/jobs/") &&
      path.endsWith("/cancel")
    ) {
      const jobId = path.substring("/jobs/".length, path.length - "/cancel".length);
      const registry = getRegistry(env);
      const ok = await registry.cancel(jobId);
      if (!ok) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json({ id: jobId, state: "cancelled" });
    }

    // Legacy sync endpoints kept for local testing -------------------
    if (
      request.method === "POST" &&
      ["/run", "/seed", "/test", "/build", "/docs", "/build-docs"].includes(path)
    ) {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return Response.json({ error: "invalid JSON" }, { status: 400 });
      }
      const response = await container.fetch(`http://container${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
      });
    }

    // dbt docs static serving from R2 --------------------------------
    if (request.method === "GET" && (path === "/docs" || path.startsWith("/docs/"))) {
      const key =
        path === "/docs" || path === "/docs/"
          ? "index.html"
          : path.replace(/^\/docs\//, "");
      if (!key) return Response.json({ error: "not found" }, { status: 404 });
      const object = await env.DBT_ARTIFACTS.get(key);
      if (!object) {
        if (key === "index.html") {
          return Response.json(
            { error: "docs not generated yet. submit a build-docs job first." },
            { status: 404 }
          );
        }
        return Response.json({ error: "not found" }, { status: 404 });
      }
      const contentType =
        object.httpMetadata?.contentType || "application/octet-stream";
      return new Response(object.body, {
        headers: { "Content-Type": contentType },
      });
    }

    if (request.method === "GET" && path.startsWith("/artifacts/")) {
      const key = path.replace("/artifacts/", "");
      if (!key) return Response.json({ error: "not found" }, { status: 404 });
      const object = await env.DBT_ARTIFACTS.get(key);
      if (!object) return Response.json({ error: "not found" }, { status: 404 });
      const contentType =
        object.httpMetadata?.contentType || "application/octet-stream";
      return new Response(object.body, {
        headers: { "Content-Type": contentType },
      });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    // Each cron tick fires a new workflow instance. JobRegistry enforces
    // latest-wins so overlapping instances cancel earlier ones.
    const id = `cron-${event.scheduledTime}`;
    await env.DBT_BUILD_WORKFLOW.create({
      id,
      params: {
        command: "build-docs",
        target: "prod",
        source: "cron",
      },
    });
  },
};
