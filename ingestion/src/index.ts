import { Hono } from "hono";
import github, { runSync as runGitHubSync } from "./services/github";
import oura, { runSync as runOuraSync } from "./services/oura";
import type { Env, SyncResult } from "./types";

const app = new Hono<{ Bindings: Env }>();

// Service routes
app.route("/github", github);
app.route("/oura", oura);

// Root
app.get("/", (c) => {
  return c.json({
    name: "ingestion",
    services: ["github", "oura"],
    endpoints: {
      "POST /sync": "Sync all services",
      "GET /health": "Health check",
      github: {
        "POST /github/sync": "Sync GitHub data",
        "GET /github/stats": "Get sync stats",
        "GET /github/daily": "Daily commit counts",
        "GET /github/repos": "Repository stats",
      },
      oura: {
        "GET /oura/auth": "Start OAuth2 authorization",
        "GET /oura/callback": "OAuth2 callback",
        "POST /oura/sync": "Sync Oura data (?start_date&end_date=YYYY-MM-DD)",
        "GET /oura/stats": "Get sync stats",
        "GET /oura/daily-summary": "Daily health summary",
        "GET /oura/sleep": "Sleep data",
        "GET /oura/activity": "Activity data",
        "GET /oura/readiness": "Readiness data",
        "GET /oura/heart-rate": "Heart rate data",
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

  try {
    results.push(await runOuraSync(c.env));
  } catch (e) {
    results.push({
      service: "oura",
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
// "0 0 * * *"    → GitHub (1日1回 UTC 0:00 / JST 9:00)
// "0 */12 * * *" → Oura   (12時間毎 UTC 0:00,12:00 / JST 9:00,21:00)
const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env) => {
  console.log("Scheduled sync started:", event.cron);

  if (event.cron === "0 0 * * *") {
    try {
      const result = await runGitHubSync(env);
      console.log("GitHub sync completed:", result);
    } catch (e) {
      console.error("GitHub sync failed:", e);
    }
  }

  if (event.cron === "0 */12 * * *") {
    try {
      const result = await runOuraSync(env);
      console.log("Oura sync completed:", result);
    } catch (e) {
      console.error("Oura sync failed:", e);
    }
  }
};

export default {
  fetch: app.fetch,
  scheduled,
};
