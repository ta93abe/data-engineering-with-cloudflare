import { Container, ContainerProxy, getContainer } from "@cloudflare/containers";

// Outbound Workers requires ContainerProxy export
export { ContainerProxy };

interface Env {
  DBT_CONTAINER: DurableObjectNamespace<DbtContainer>;
  DBT_ARTIFACTS: R2Bucket;
  SNOWFLAKE_ACCOUNT: string;
  SNOWFLAKE_USER: string;
  SNOWFLAKE_PRIVATE_KEY: string;
  SNOWFLAKE_PRIVATE_KEY_PASSPHRASE: string;
  SNOWFLAKE_ROLE: string;
  SNOWFLAKE_WAREHOUSE: string;
  SNOWFLAKE_DATABASE: string;
  SNOWFLAKE_SCHEMA: string;
  API_KEY: string;
}

export class DbtContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";

  envVars = {
    SNOWFLAKE_ACCOUNT: this.env.SNOWFLAKE_ACCOUNT,
    SNOWFLAKE_USER: this.env.SNOWFLAKE_USER,
    SNOWFLAKE_PRIVATE_KEY: this.env.SNOWFLAKE_PRIVATE_KEY,
    SNOWFLAKE_PRIVATE_KEY_PASSPHRASE: this.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE,
    SNOWFLAKE_ROLE: this.env.SNOWFLAKE_ROLE,
    SNOWFLAKE_WAREHOUSE: this.env.SNOWFLAKE_WAREHOUSE,
    SNOWFLAKE_DATABASE: this.env.SNOWFLAKE_DATABASE,
    SNOWFLAKE_SCHEMA: this.env.SNOWFLAKE_SCHEMA,
  };

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
    const key = url.pathname.slice(1); // strip leading /

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

    // /health reflects container state
    if (path === "/health") {
      const container = getContainer(env.DBT_CONTAINER, "dbt-runner-main");
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

    // POST endpoints require authentication
    const authError = authenticate(request, env);
    if (authError) return authError;

    const container = getContainer(env.DBT_CONTAINER, "dbt-runner-main");

    // dbt commands: POST /run, /seed, /test, /build, /docs
    if (
      request.method === "POST" &&
      ["/run", "/seed", "/test", "/build", "/docs"].includes(path)
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
      const containerContentType =
        response.headers.get("Content-Type") || "application/json";
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": containerContentType },
      });
    }

    // dbt docs serving: /docs/ files from R2
    if (
      request.method === "GET" &&
      (path === "/docs" || path.startsWith("/docs/"))
    ) {
      const key =
        path === "/docs" || path === "/docs/"
          ? "index.html"
          : path.replace(/^\/docs\//, "");
      if (!key) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      const object = await env.DBT_ARTIFACTS.get(key);
      if (!object) {
        if (key === "index.html") {
          return Response.json(
            { error: "docs not generated yet. POST /docs first." },
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

    // Artifact fetch (R2 bucket root)
    if (request.method === "GET" && path.startsWith("/artifacts/")) {
      const key = path.replace("/artifacts/", "");
      if (!key) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      const object = await env.DBT_ARTIFACTS.get(key);
      if (!object) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      const contentType =
        object.httpMetadata?.contentType || "application/octet-stream";
      return new Response(object.body, {
        headers: { "Content-Type": contentType },
      });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
};
