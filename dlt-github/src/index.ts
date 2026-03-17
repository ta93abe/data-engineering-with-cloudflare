import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { runPipeline } from "./services/pipeline-runner";
import type { Env } from "./types";

export { Sandbox } from "@cloudflare/sandbox";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.text("OK"));

app.post("/run", (c, next) => bearerAuth({ token: c.env.RUN_SECRET })(c, next), async (c) => {
  const ref = c.req.query("ref") ?? "main";

  console.log(`Starting dlt GitHub pipeline: ref=${ref}`);

  const result = await runPipeline(c.env, ref);

  console.log(`Pipeline ${result.runId}: success=${result.success}`);

  return c.json(result);
});

const scheduled: ExportedHandlerScheduledHandler<Env> = async (_event, env, _ctx) => {
  console.log(`Scheduled dlt GitHub pipeline at ${new Date().toISOString()}`);

  try {
    const result = await runPipeline(env);
    console.log(`Scheduled run ${result.runId}: success=${result.success}`);
  } catch (error) {
    console.error("Scheduled pipeline failed:", error);
  }
};

export default {
  fetch: app.fetch,
  scheduled,
};
