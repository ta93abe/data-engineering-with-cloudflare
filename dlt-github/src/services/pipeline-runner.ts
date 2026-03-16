import { getSandbox } from "@cloudflare/sandbox";
import type { Env, PipelineRunResult } from "../types";

const WORKSPACE = "/workspace";
const PIPELINE_DIR = "dlt/github";

const SAFE_REF_PATTERN = /^[a-zA-Z0-9._\-/]+$/;

function validateRef(ref: string): void {
  if (!SAFE_REF_PATTERN.test(ref) || ref.length > 256) {
    throw new Error(`Invalid git ref: ${ref}`);
  }
}

function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${date}-${time}-${rand}`;
}

// Note: sandbox.exec runs commands inside an isolated container, not on the host.
// Input validation via SAFE_REF_PATTERN prevents shell injection.
function cloneCommand(repo: string, ref: string, token: string): string {
  const url = `https://x-access-token:${token}@github.com/${repo}.git`;
  return `git clone --depth 1 --branch ${ref} ${url} ${WORKSPACE}/repo`;
}

function writeSecretsToml(env: Env): string {
  return [
    "[destination.filesystem.credentials]",
    `aws_access_key_id = "${env.R2_ACCESS_KEY_ID}"`,
    `aws_secret_access_key = "${env.R2_SECRET_ACCESS_KEY}"`,
    "",
    "[iceberg_catalog.iceberg_catalog_config]",
    'type = "rest"',
    `uri = "${env.R2_CATALOG_URI}"`,
    `warehouse = "${env.R2_CATALOG_WAREHOUSE}"`,
    `token = "${env.R2_CATALOG_TOKEN}"`,
    "",
    "[sources.github]",
    `access_token = "${env.GITHUB_TOKEN}"`,
  ].join("\n");
}

export async function runPipeline(env: Env, ref = "main"): Promise<PipelineRunResult> {
  validateRef(ref);

  const runId = generateRunId();
  const startedAt = new Date().toISOString();
  const sandbox = getSandbox(env.SANDBOX, `dlt-run-${runId}`);

  try {
    // 1. Clone repo
    const clone = await sandbox.exec(cloneCommand(env.GITHUB_REPO, ref, env.GITHUB_TOKEN));
    if (!clone.success) {
      return {
        runId,
        startedAt,
        completedAt: new Date().toISOString(),
        success: false,
        output: `${clone.stdout}\n${clone.stderr}`,
        error: "git clone failed",
      };
    }

    const pipelinePath = `${WORKSPACE}/repo/${PIPELINE_DIR}`;

    // 2. Write secrets.toml
    await sandbox.writeFile(`${pipelinePath}/.dlt/secrets.toml`, writeSecretsToml(env));

    // 3. Install dependencies
    const deps = await sandbox.exec(`cd ${pipelinePath} && uv sync --frozen --no-dev`);
    if (!deps.success) {
      return {
        runId,
        startedAt,
        completedAt: new Date().toISOString(),
        success: false,
        output: `${deps.stdout}\n${deps.stderr}`,
        error: "dependency install failed",
      };
    }

    // 4. Run pipeline
    const run = await sandbox.exec(`cd ${pipelinePath} && uv run python pipeline.py`);

    return {
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      success: run.success,
      output: run.stdout + (run.stderr ? `\n--- stderr ---\n${run.stderr}` : ""),
      error: run.success ? undefined : "pipeline execution failed",
    };
  } finally {
    await sandbox.destroy();
  }
}
