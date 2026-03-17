import { Container, getContainer } from "@cloudflare/containers";

type Env = {
  DBT_CONTAINER: DurableObjectNamespace<DbtContainer>;
  GITHUB_REPO: string;
  GITHUB_TOKEN: string;
  R2_ENDPOINT: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  RUN_SECRET: string;
};

export class DbtContainer extends Container {
  sleepAfter = "30s";

  override onStart() {
    console.log("dbt container started");
  }

  override onStop() {
    console.log("dbt container stopped");
  }
}

async function runDbt(env: Env, ref = "main", envPrefix = "prod") {
  const container = getContainer(env.DBT_CONTAINER);
  await container.start({
    envVars: {
      GITHUB_REPO: env.GITHUB_REPO,
      GITHUB_TOKEN: env.GITHUB_TOKEN,
      R2_ENDPOINT: env.R2_ENDPOINT,
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
      GIT_REF: ref,
      DBT_ENV_PREFIX: envPrefix,
    },
  });
  return { started: true, ref, envPrefix };
}

function checkAuth(request: Request, secret: string): Response | null {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (token !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK");
    }

    if (url.pathname === "/run" && request.method === "POST") {
      const authError = checkAuth(request, env.RUN_SECRET);
      if (authError) return authError;

      const ref = url.searchParams.get("ref") ?? "main";
      const envPrefix = url.searchParams.get("env") ?? "dev";
      const result = await runDbt(env, ref, envPrefix);
      return Response.json(result);
    }

    return Response.json({
      endpoints: {
        "GET /health": "Health check",
        "POST /run": "Run dbt (Authorization: Bearer <secret>)",
      },
    });
  },

  async scheduled(_controller: ScheduledController, env: Env) {
    console.log("Scheduled dbt run (prod)");
    await runDbt(env, "main", "prod");
  },
};
