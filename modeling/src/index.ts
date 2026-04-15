import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import { DbtBuildWorkflow, type DbtBuildWorkflowParams } from "./workflow";

// Re-exports required by Cloudflare's runtime bindings:
//  - Sandbox is the Durable Object class backing the sandbox container.
//  - DbtBuildWorkflow is the workflow entrypoint referenced by
//    wrangler.jsonc `workflows[].class_name`.
export { Sandbox } from "@cloudflare/sandbox";
export { DbtBuildWorkflow };

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  DBT_BUILD_WORKFLOW: Workflow;
  DBT_ARTIFACTS: R2Bucket;
  // Required secrets
  SNOWFLAKE_ACCOUNT: string;
  SNOWFLAKE_USER: string;
  SNOWFLAKE_PRIVATE_KEY: string;
  API_KEY: string;
  // Optional secrets
  SNOWFLAKE_ROLE?: string;
  SNOWFLAKE_WAREHOUSE?: string;
  SNOWFLAKE_DATABASE?: string;
  SNOWFLAKE_SCHEMA?: string;
  SLACK_WEBHOOK_URL?: string;
  REPO_URL?: string;
}

const SANDBOX_ID = "dbt-runner-main";

function requireBearerToken(request: Request, env: Env): Response | null {
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

    // --- public liveness probe ----------------------------------------
    if (path === "/health") {
      return Response.json({ status: "ok" });
    }

    // Everything below this line is authenticated.
    if (request.method === "POST" || request.method === "GET") {
      if (
        path === "/health/deep" ||
        path === "/restart" ||
        path === "/workflows/build" ||
        path.startsWith("/workflows/build/instances/")
      ) {
        const authError = requireBearerToken(request, env);
        if (authError) return authError;
      }
    }

    // --- readiness probe: lightweight Snowflake round-trip ------------
    if (request.method === "GET" && path === "/health/deep") {
      try {
        const sandbox = getSandbox(env.Sandbox, SANDBOX_ID);
        // Use the snowflake-connector that's already in the image's
        // uv cache. No warehouse is attached so the query stays on
        // Snowflake's cloud services layer (effectively free).
        const script = `
import os, sys
import snowflake.connector
try:
    conn = snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        private_key=os.environ["SNOWFLAKE_PRIVATE_KEY"].encode(),
    )
    cur = conn.cursor()
    cur.execute("SELECT CURRENT_ACCOUNT(), CURRENT_USER(), CURRENT_VERSION()")
    row = cur.fetchone()
    cur.close()
    conn.close()
    print(f"account={row[0]} user={row[1]} version={row[2]}")
except Exception as e:
    print(f"error: {e}", file=sys.stderr)
    sys.exit(1)
`;
        const result = await sandbox.runCode(script, {
          language: "python",
          envVars: {
            SNOWFLAKE_ACCOUNT: env.SNOWFLAKE_ACCOUNT,
            SNOWFLAKE_USER: env.SNOWFLAKE_USER,
            SNOWFLAKE_PRIVATE_KEY: env.SNOWFLAKE_PRIVATE_KEY,
          },
        });
        const ok =
          result.results.length > 0 &&
          (result.results[0].text ?? "").startsWith("account=");
        return Response.json(
          {
            status: ok ? "ok" : "degraded",
            detail: result.results[0]?.text ?? result.logs?.stderr,
          },
          { status: ok ? 200 : 503 }
        );
      } catch (e) {
        return Response.json(
          { status: "error", error: (e as Error).message },
          { status: 503 }
        );
      }
    }

    // --- force restart (ops recovery) ---------------------------------
    if (request.method === "POST" && path === "/restart") {
      try {
        const sandbox = getSandbox(env.Sandbox, SANDBOX_ID);
        await sandbox.destroy();
        return Response.json({ status: "restarted" });
      } catch (e) {
        return Response.json(
          { error: `restart failed: ${(e as Error).message}` },
          { status: 500 }
        );
      }
    }

    // --- kick off a DbtBuildWorkflow instance (webhook) ---------------
    if (request.method === "POST" && path === "/workflows/build") {
      let body: DbtBuildWorkflowParams;
      try {
        body = (await request
          .json()
          .catch(() => ({}))) as DbtBuildWorkflowParams;
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
      const instanceId = path.substring(
        "/workflows/build/instances/".length
      );
      try {
        const instance = await env.DBT_BUILD_WORKFLOW.get(instanceId);
        return Response.json({
          id: instanceId,
          status: await instance.status(),
        });
      } catch (e) {
        return Response.json(
          { error: `workflow not found: ${(e as Error).message}` },
          { status: 404 }
        );
      }
    }

    // --- dbt docs static serving from R2 ------------------------------
    if (
      request.method === "GET" &&
      (path === "/docs" || path.startsWith("/docs/"))
    ) {
      const key =
        path === "/docs" || path === "/docs/"
          ? "index.html"
          : path.replace(/^\/docs\//, "");
      const object = await env.DBT_ARTIFACTS.get(key);
      if (!object) {
        if (key === "index.html") {
          return Response.json(
            {
              error:
                "docs not generated yet. submit a build-docs job first.",
            },
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
      const object = await env.DBT_ARTIFACTS.get(key);
      if (!object)
        return Response.json({ error: "not found" }, { status: 404 });
      const contentType =
        object.httpMetadata?.contentType || "application/octet-stream";
      return new Response(object.body, {
        headers: { "Content-Type": contentType },
      });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    // Each cron tick creates a new workflow instance. JobRegistry-style
    // latest-wins is not necessary here because the workflow itself
    // runs against a singleton sandbox -- overlapping runs naturally
    // contend for the same workspace and the more recent one wins via
    // gitCheckout + file overwrite.
    await env.DBT_BUILD_WORKFLOW.create({
      id: `cron-${event.scheduledTime}`,
      params: {
        command: "build-docs",
        target: "prod",
        source: "cron",
      },
    });
  },
};
