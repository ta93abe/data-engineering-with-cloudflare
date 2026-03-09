import { Hono } from "hono";
import { runDbt } from "./services/dbt-runner";
import { getRunResult, listRuns, saveRunResult } from "./services/r2-artifacts";
import type { DbtCommand, Env } from "./types";

export { Sandbox } from "@cloudflare/sandbox";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.text("OK"));

app.post("/run", async (c) => {
  const commandParam = c.req.query("command");
  let commands: DbtCommand[];

  if (commandParam) {
    const valid: DbtCommand[] = ["seed", "run", "test"];
    if (!valid.includes(commandParam as DbtCommand)) {
      return c.json({ error: `Invalid command: ${commandParam}. Use seed, run, or test.` }, 400);
    }
    commands = [commandParam as DbtCommand];
  } else {
    commands = ["seed", "run", "test"];
  }

  console.log(`Starting dbt run with commands: ${commands.join(", ")}`);

  const { result, artifacts } = await runDbt(c.env, commands);
  await saveRunResult(c.env.R2_ARTIFACTS, result, artifacts);

  console.log(`dbt run ${result.runId} completed: success=${result.success}`);

  return c.json(result);
});

app.get("/runs", async (c) => {
  const limit = Number(c.req.query("limit") ?? "20");
  const runs = await listRuns(c.env.R2_ARTIFACTS, limit);
  return c.json({ runs });
});

app.get("/runs/:runId", async (c) => {
  const runId = c.req.param("runId");
  const result = await getRunResult(c.env.R2_ARTIFACTS, runId);

  if (!result) {
    return c.json({ error: "Run not found" }, 404);
  }

  return c.json(result);
});

// Scheduled handler for cron triggers
const scheduled: ExportedHandlerScheduledHandler<Env> = async (_event, env, _ctx) => {
  console.log(`Scheduled dbt run triggered at ${new Date().toISOString()}`);

  const { result, artifacts } = await runDbt(env);
  await saveRunResult(env.R2_ARTIFACTS, result, artifacts);

  console.log(`Scheduled dbt run ${result.runId} completed: success=${result.success}`);
};

export default {
  fetch: app.fetch,
  scheduled,
};
