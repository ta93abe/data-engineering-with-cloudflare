import { getSandbox } from "@cloudflare/sandbox";
import type { DbtCommand, DbtCommandResult, DbtRunResult, Env, RunRequest } from "../types";

const WORKSPACE = "/workspace";
const ALLOWED_COMMANDS: ReadonlySet<string> = new Set(["seed", "run", "test", "build"]);

// Validates ref to prevent shell injection — only allows safe git ref characters
const SAFE_REF_PATTERN = /^[a-zA-Z0-9._\-/]+$/;

function validateRef(ref: string): void {
  if (!SAFE_REF_PATTERN.test(ref) || ref.length > 256) {
    throw new Error(`Invalid git ref: ${ref}`);
  }
}

// Validates dbtDir to prevent path traversal
function validateDbtDir(dbtDir: string): void {
  if (dbtDir.includes("..") || dbtDir.startsWith("/") || dbtDir.length > 256) {
    throw new Error(`Invalid dbtDir: ${dbtDir}`);
  }
}

function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${date}-${time}-${rand}`;
}

function cloneCommand(repo: string, ref: string, token: string): string {
  const url = `https://x-access-token:${token}@github.com/${repo}.git`;
  return `git clone --depth 1 --branch ${ref} ${url} ${WORKSPACE}/repo`;
}

function dbtCommand(dbtDir: string, command: DbtCommand): string {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Invalid dbt command: ${command}`);
  }
  const fullPath = `${WORKSPACE}/repo/${dbtDir}`;
  return [
    `cd ${fullPath}`,
    `set -a && source ${fullPath}/.env && set +a`,
    `uv run dbt ${command} --profiles-dir . --target ci`,
  ].join(" && ");
}

async function cloneRepo(
  sandbox: ReturnType<typeof getSandbox>,
  env: Env,
  ref: string
): Promise<{ success: boolean; commitSha: string; output: string }> {
  const result = await sandbox.exec(cloneCommand(env.GITHUB_REPO, ref, env.GITHUB_TOKEN));
  if (!result.success) {
    return { success: false, commitSha: "", output: `${result.stdout}\n${result.stderr}` };
  }

  const shaResult = await sandbox.exec(`cd ${WORKSPACE}/repo && git rev-parse HEAD`);
  if (!shaResult.success) {
    return { success: false, commitSha: "", output: `git rev-parse failed: ${shaResult.stderr}` };
  }
  const commitSha = shaResult.stdout.trim();

  return { success: true, commitSha, output: result.stdout };
}

async function setupEnv(
  sandbox: ReturnType<typeof getSandbox>,
  env: Env,
  dbtDir: string
): Promise<void> {
  const envContent = [
    `R2_ENDPOINT=${env.R2_ENDPOINT}`,
    `R2_ACCESS_KEY_ID=${env.R2_ACCESS_KEY_ID}`,
    `R2_SECRET_ACCESS_KEY=${env.R2_SECRET_ACCESS_KEY}`,
  ].join("\n");

  await sandbox.writeFile(`${WORKSPACE}/repo/${dbtDir}/.env`, envContent);
}

async function installDeps(
  sandbox: ReturnType<typeof getSandbox>,
  dbtDir: string
): Promise<{ success: boolean; output: string; durationMs: number }> {
  const fullPath = `${WORKSPACE}/repo/${dbtDir}`;
  const start = Date.now();
  const result = await sandbox.exec(
    `cd ${fullPath} && uv sync --frozen --no-dev && uv run dbt deps --profiles-dir . --target ci`
  );
  return {
    success: result.success,
    output: result.stdout + (result.stderr ? `\n--- stderr ---\n${result.stderr}` : ""),
    durationMs: Date.now() - start,
  };
}

export async function runDbt(
  env: Env,
  request: RunRequest = {}
): Promise<{ result: DbtRunResult; artifacts: Record<string, string> }> {
  const ref = request.ref ?? "main";
  const commands = request.commands ?? ["seed", "run", "test"];
  const dbtDir = request.dbtDir ?? "transform/core";

  validateRef(ref);
  validateDbtDir(dbtDir);

  const runId = generateRunId();
  const startedAt = new Date().toISOString();
  const sandbox = getSandbox(env.SANDBOX, `dbt-run-${runId}`);

  // 1. Clone repo
  const clone = await cloneRepo(sandbox, env, ref);
  if (!clone.success) {
    await sandbox.destroy();
    return {
      result: {
        runId,
        ref,
        commitSha: "",
        startedAt,
        completedAt: new Date().toISOString(),
        success: false,
        commands: [],
        error: `git clone failed: ${clone.output}`,
      },
      artifacts: {},
    };
  }

  // 2. Write .env and install dependencies
  await setupEnv(sandbox, env, dbtDir);
  const deps = await installDeps(sandbox, dbtDir);
  if (!deps.success) {
    await sandbox.destroy();
    return {
      result: {
        runId,
        ref,
        commitSha: clone.commitSha,
        startedAt,
        completedAt: new Date().toISOString(),
        success: false,
        commands: [],
        error: `dependency install failed: ${deps.output}`,
      },
      artifacts: {},
    };
  }

  // 3. Run dbt commands
  const commandResults: DbtCommandResult[] = [];
  let allSuccess = true;

  for (const cmd of commands) {
    const fullCmd = dbtCommand(dbtDir, cmd);
    const start = Date.now();
    const sandboxResult = await sandbox.exec(fullCmd);

    const cmdResult: DbtCommandResult = {
      command: cmd,
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

  // 4. Collect artifacts
  const artifacts: Record<string, string> = {};
  const dbtPath = `${WORKSPACE}/repo/${dbtDir}`;
  const artifactPaths = [
    { key: "manifest.json", path: `${dbtPath}/target/manifest.json` },
    { key: "run_results.json", path: `${dbtPath}/target/run_results.json` },
    { key: "dbt.log", path: `${dbtPath}/logs/dbt.log` },
  ];

  for (const { key, path } of artifactPaths) {
    try {
      const file = await sandbox.readFile(path);
      artifacts[key] = file.content;
    } catch {
      // Artifact may not exist if dbt didn't reach that stage
    }
  }

  await sandbox.destroy();

  const result: DbtRunResult = {
    runId,
    ref,
    commitSha: clone.commitSha,
    startedAt,
    completedAt: new Date().toISOString(),
    success: allSuccess,
    commands: commandResults,
  };

  return { result, artifacts };
}
