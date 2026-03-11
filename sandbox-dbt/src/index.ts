import { Hono } from "hono";
import { runDbt } from "./services/dbt-runner";
import { getRunResult, listRuns, saveRunResult } from "./services/r2-artifacts";
import type { DbtCommand, Env, RunRequest } from "./types";

export { Sandbox } from "@cloudflare/sandbox";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.text("OK"));

app.post("/run", async (c) => {
  const body = await c.req.json<RunRequest>().catch(() => ({}) as Partial<RunRequest>);

  const ref = body.ref ?? c.req.query("ref") ?? "main";
  const dbtDir = body.dbtDir ?? c.req.query("dbtDir") ?? "transform/core";

  const validCommands: DbtCommand[] = ["seed", "run", "test", "build"];
  let commands: DbtCommand[];

  if (body.commands?.length) {
    const invalid = body.commands.find((cmd) => !validCommands.includes(cmd));
    if (invalid) {
      return c.json({ error: `Invalid command: ${invalid}` }, 400);
    }
    commands = body.commands;
  } else {
    const cmdParam = c.req.query("command");
    if (cmdParam) {
      if (!validCommands.includes(cmdParam as DbtCommand)) {
        return c.json({ error: `Invalid command: ${cmdParam}` }, 400);
      }
      commands = [cmdParam as DbtCommand];
    } else {
      commands = ["seed", "run", "test"];
    }
  }

  console.log(`Starting dbt run: ref=${ref}, commands=${commands.join(",")}, dbtDir=${dbtDir}`);

  const { result, artifacts } = await runDbt(c.env, { ref, commands, dbtDir });
  await saveRunResult(c.env.R2_ARTIFACTS, result, artifacts);

  console.log(
    `dbt run ${result.runId} completed: success=${result.success}, sha=${result.commitSha}`
  );

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

const scheduled: ExportedHandlerScheduledHandler<Env> = async (_event, env, _ctx) => {
  console.log(`Scheduled dbt run triggered at ${new Date().toISOString()}`);

  const { result, artifacts } = await runDbt(env);
  await saveRunResult(env.R2_ARTIFACTS, result, artifacts);

  console.log(`Scheduled run ${result.runId}: success=${result.success}, sha=${result.commitSha}`);
};

export default {
  fetch: app.fetch,
  scheduled,
};
