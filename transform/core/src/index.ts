import { Container, ContainerProxy, getContainer } from "@cloudflare/containers";

// Outbound Workers requires ContainerProxy export
export { ContainerProxy };

interface Env {
  DBT_CONTAINER: DurableObjectNamespace<DbtContainer>;
  DBT_ARTIFACTS: R2Bucket;
  DATABRICKS_HOST: string;
  DATABRICKS_HTTP_PATH: string;
  DATABRICKS_TOKEN: string;
  API_KEY: string;
}

export class DbtContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";

  envVars = {
    DATABRICKS_HOST: this.env.DATABRICKS_HOST,
    DATABRICKS_HTTP_PATH: this.env.DATABRICKS_HTTP_PATH,
    DATABRICKS_TOKEN: this.env.DATABRICKS_TOKEN,
  };

  override onStart() {
    console.log("dbt-runner container started");
  }

  override onStop() {
    console.log("dbt-runner container stopped");
  }

  override onError(error: unknown) {
    console.error("dbt-runner container error:", error);
  }
}

// Outbound Workers: Container → http://r2.worker/{key} → R2 binding
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
  // GET /health, /docs, /artifacts は認証不要
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

    if (path === "/health") {
      return Response.json({ status: "ok" });
    }

    // POST エンドポイントは認証必須
    const authError = authenticate(request, env);
    if (authError) return authError;

    const container = getContainer(env.DBT_CONTAINER, "dbt-runner-main");

    // dbt commands: POST /run, /seed, /test, /build, /docs
    if (
      request.method === "POST" &&
      ["/run", "/seed", "/test", "/build", "/docs"].includes(path)
    ) {
      const body = await request.json().catch(() => ({}));
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

    // dbt docs 配信 (R2 バケット直下から)
    if (
      request.method === "GET" &&
      (path === "/docs" || path === "/docs/")
    ) {
      const object = await env.DBT_ARTIFACTS.get("index.html");
      if (!object) {
        return Response.json(
          { error: "docs not generated yet. POST /docs first." },
          { status: 404 }
        );
      }
      return new Response(object.body, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // アーティファクト取得 (R2 バケット直下)
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
