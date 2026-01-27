import { Hono } from "hono";
import type { Env, SyncResult } from "./types";
import github, { runSync as runGitHubSync } from "./services/github";

const app = new Hono<{ Bindings: Env }>();

// Service routes
app.route("/github", github);

// Root
app.get("/", (c) => {
  return c.json({
    name: "ingestion",
    services: ["github"],
    endpoints: {
      "POST /sync": "Sync all services",
      "GET /health": "Health check",
      github: {
        "POST /github/sync": "Sync GitHub data",
        "GET /github/stats": "Get sync stats",
        "GET /github/daily": "Daily commit counts",
        "GET /github/repos": "Repository stats",
      },
    },
  });
});

// Sync all services
app.post("/sync", async (c) => {
  const results: SyncResult[] = [];

  try {
    results.push(await runGitHubSync(c.env));
  } catch (e) {
    results.push({
      service: "github",
      success: false,
      message: e instanceof Error ? e.message : "Unknown error",
    });
  }

  return c.json({
    results,
    success: results.every((r) => r.success),
  });
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Scheduled handler (Cron)
const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env) => {
  console.log("Scheduled sync started:", event.cron);

  try {
    const result = await runGitHubSync(env);
    console.log("GitHub sync completed:", result);
  } catch (e) {
    console.error("GitHub sync failed:", e);
  }
};

export default {
  fetch: app.fetch,
  scheduled,
};
