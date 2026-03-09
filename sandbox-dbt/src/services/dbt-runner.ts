import { getSandbox } from "@cloudflare/sandbox";
import type { DbtCommand, DbtCommandResult, DbtRunResult, Env } from "../types";

const DBT_DIR = "/workspace/dbt";

// Allowed dbt commands (whitelist for safety)
const ALLOWED_COMMANDS: ReadonlySet<string> = new Set(["seed", "run", "test"]);

function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${date}-${time}-${rand}`;
}

function buildDbtCommand(command: DbtCommand): string {
  // Validate command against whitelist to prevent injection
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Invalid dbt command: ${command}`);
  }
  return [
    `cd ${DBT_DIR}`,
    `set -a && source ${DBT_DIR}/.env && set +a`,
    `uv run dbt ${command} --profiles-dir . --target ci`,
  ].join(" && ");
}

export async function runDbt(
  env: Env,
  commands: DbtCommand[] = ["seed", "run", "test"]
): Promise<{ result: DbtRunResult; artifacts: Record<string, string> }> {
  const runId = generateRunId();
  const startedAt = new Date().toISOString();

  const sandbox = getSandbox(env.SANDBOX, `dbt-run-${runId}`);

  // Write R2 credentials as .env file for dbt's env_var() Jinja
  const envContent = [
    `R2_ENDPOINT=${env.R2_ENDPOINT}`,
    `R2_ACCESS_KEY_ID=${env.R2_ACCESS_KEY_ID}`,
    `R2_SECRET_ACCESS_KEY=${env.R2_SECRET_ACCESS_KEY}`,
  ].join("\n");

  await sandbox.writeFile(`${DBT_DIR}/.env`, envContent);

  // Run each dbt command sequentially
  const commandResults: DbtCommandResult[] = [];
  let allSuccess = true;

  for (const command of commands) {
    const fullCmd = buildDbtCommand(command);
    const start = Date.now();

    // sandbox.exec runs inside an isolated container - not the host shell
    const sandboxResult = await sandbox.exec(fullCmd);

    const cmdResult: DbtCommandResult = {
      command,
      success: sandboxResult.success,
      output:
        sandboxResult.stdout +
        (sandboxResult.stderr ? `\n--- stderr ---\n${sandboxResult.stderr}` : ""),
      durationMs: Date.now() - start,
    };

    commandResults.push(cmdResult);

    if (!sandboxResult.success) {
      allSuccess = false;
      break;
    }
  }

  // Collect artifacts from the sandbox
  const artifacts: Record<string, string> = {};
  const artifactPaths = [
    { key: "manifest.json", path: `${DBT_DIR}/target/manifest.json` },
    { key: "run_results.json", path: `${DBT_DIR}/target/run_results.json` },
    { key: "dbt.log", path: `${DBT_DIR}/logs/dbt.log` },
  ];

  for (const { key, path } of artifactPaths) {
    try {
      const file = await sandbox.readFile(path);
      artifacts[key] = file.content;
    } catch {
      // Artifact may not exist if dbt didn't reach that stage
    }
  }

  // Clean up the sandbox
  await sandbox.destroy();

  const result: DbtRunResult = {
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    success: allSuccess,
    commands: commandResults,
  };

  return { result, artifacts };
}
