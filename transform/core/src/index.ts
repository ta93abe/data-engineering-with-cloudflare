import { Container, ContainerProxy, getContainer } from "@cloudflare/containers";

// Outbound Workers requires ContainerProxy export
export { ContainerProxy };

interface Env {
  DBT_CONTAINER: DurableObjectNamespace<DbtContainer>;
  DBT_ARTIFACTS: R2Bucket;
  DATABRICKS_HOST: string;
  DATABRICKS_HTTP_PATH: string;
  DATABRICKS_TOKEN: string;
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
      await env.DBT_ARTIFACTS.put(key, body, {
        httpMetadata: { contentType: "application/json" },
      });
      return new Response("OK", { status: 200 });
    }

    if (request.method === "GET") {
      const object = await env.DBT_ARTIFACTS.get(key);
      if (!object) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(object.body, {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Method Not Allowed", { status: 405 });
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      return Response.json({ status: "ok" });
    }

    const container = getContainer(env.DBT_CONTAINER, "dbt-runner-main");

    // dbt commands: POST /run, /seed, /test, /build
    if (
      request.method === "POST" &&
      ["/run", "/seed", "/test", "/build"].includes(path)
    ) {
      const body = await request.json().catch(() => ({}));
      const response = await container.fetch(`http://container${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // アーティファクト取得 (R2 binding 経由)
    if (path.startsWith("/artifacts/")) {
      const key = `dbt-core/${path.replace("/artifacts/", "")}`;
      const object = await env.DBT_ARTIFACTS.get(key);
      if (!object) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      return new Response(object.body, {
        headers: { "Content-Type": "application/json" },
      });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
};
