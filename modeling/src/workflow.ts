import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";

/**
 * DbtBuildWorkflow
 * ----------------
 * Orchestrates a dbt build end-to-end against a Cloudflare Sandbox
 * container. The sandbox gives us:
 *
 *   - `gitCheckout()` to pull a fresh copy of this repository at
 *     runtime so model changes don't require a container image
 *     rebuild.
 *   - `writeFile()` to drop a fully-resolved `profiles.yml` on
 *     disk built from Worker secrets, so no Snowflake credentials
 *     are ever baked into the image or committed to Git.
 *   - `startProcess()` + process polling for long-running dbt
 *     commands that would otherwise blow the Worker subrequest
 *     wall clock.
 *
 * Workflow steps use `step.do` for retriable units of work and
 * `step.sleep` for durable polling waits so the Workflow runtime
 * can hibernate across the entire dbt build duration without
 * holding CPU or memory.
 */

export interface DbtBuildWorkflowParams {
  command?: "build" | "build-docs" | "run" | "test" | "seed" | "docs";
  target?: "dev" | "prod";
  select?: string;
  full_refresh?: boolean;
  source?: string; // 'cron' | 'webhook' | 'manual'
  ref?: string; // git ref to build, defaults to main
}

interface WorkflowEnv {
  Sandbox: DurableObjectNamespace<Sandbox>;
  API_KEY: string;
  SNOWFLAKE_ACCOUNT: string;
  SNOWFLAKE_USER: string;
  SNOWFLAKE_PRIVATE_KEY: string;
  SNOWFLAKE_ROLE?: string;
  SNOWFLAKE_WAREHOUSE?: string;
  SNOWFLAKE_DATABASE?: string;
  SNOWFLAKE_SCHEMA?: string;
  SLACK_WEBHOOK_URL?: string;
  REPO_URL?: string;
}

const SANDBOX_ID = "dbt-runner-main";
const WORKSPACE_ROOT = "/workspace/repo";
const MODELING_DIR = `${WORKSPACE_ROOT}/modeling`;
const DEFAULT_REPO_URL =
  "https://github.com/ta93abe/data-engineering-with-cloudflare";
const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_SECONDS = 30;
const MAX_POLL_ITERATIONS = 240; // 240 * 30s = 2 hours per attempt
const RETRY_BACKOFF_SECONDS = 60;

interface DbtResult {
  exitCode: number;
  stdout_tail: string;
  stderr_tail: string;
  duration_ms: number;
}

export class DbtBuildWorkflow extends WorkflowEntrypoint<
  WorkflowEnv,
  DbtBuildWorkflowParams
> {
  async run(
    event: WorkflowEvent<DbtBuildWorkflowParams>,
    step: WorkflowStep
  ): Promise<DbtResult> {
    const payload = event.payload ?? {};
    const command = payload.command ?? "build-docs";
    const target = payload.target ?? "prod";
    const select = payload.select;
    const full_refresh = payload.full_refresh ?? false;
    const ref = payload.ref ?? "main";
    const source = payload.source ?? "manual";
    const repoUrl = this.env.REPO_URL ?? DEFAULT_REPO_URL;

    // Step 1: prepare the workspace via git clone
    await step.do(
      "workspace-prepare",
      { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" } },
      async () => {
        const sandbox = getSandbox(this.env.Sandbox, SANDBOX_ID);
        await sandbox.exec(`rm -rf ${WORKSPACE_ROOT}`);
        await sandbox.gitCheckout(repoUrl, {
          branch: ref,
          targetDir: WORKSPACE_ROOT,
        });
      }
    );

    // Step 2: materialize profiles.yml from worker secrets
    await step.do(
      "write-profiles",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        const sandbox = getSandbox(this.env.Sandbox, SANDBOX_ID);
        const profiles = buildProfilesYaml({
          account: this.env.SNOWFLAKE_ACCOUNT,
          user: this.env.SNOWFLAKE_USER,
          privateKeyPem: this.env.SNOWFLAKE_PRIVATE_KEY,
          role: this.env.SNOWFLAKE_ROLE ?? "ACCOUNTADMIN",
          warehouse: this.env.SNOWFLAKE_WAREHOUSE ?? "COMPUTE_WH",
          database: this.env.SNOWFLAKE_DATABASE ?? "DEVELOPMENT",
          schema: this.env.SNOWFLAKE_SCHEMA ?? "PUBLIC",
        });
        await sandbox.writeFile(`${MODELING_DIR}/profiles.yml`, profiles);
      }
    );

    // Step 3: install python + dbt dependencies (uses uv cache warmed in image)
    await step.do(
      "install-deps",
      { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" } },
      async () => {
        const sandbox = getSandbox(this.env.Sandbox, SANDBOX_ID);
        const sync = await sandbox.exec("uv sync --no-dev --frozen", {
          cwd: MODELING_DIR,
          timeout: 600_000,
        });
        if (sync.exitCode !== 0) {
          throw new Error(`uv sync failed: ${sync.stderr}`);
        }
        const deps = await sandbox.exec("uv run dbt deps", {
          cwd: MODELING_DIR,
          timeout: 600_000,
        });
        if (deps.exitCode !== 0) {
          throw new Error(`dbt deps failed: ${deps.stderr}`);
        }
      }
    );

    // Step 4: run dbt with 3-attempt retry loop
    let lastResult: DbtResult | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const processId = `dbt-${command}-${event.instanceId}-${attempt}`;

      const started = await step.do(
        `dbt-start-attempt-${attempt}`,
        { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" } },
        async () => {
          const sandbox = getSandbox(this.env.Sandbox, SANDBOX_ID);
          const args = ["dbt", command, "--target", target, "--profiles-dir", "."];
          if (select) args.push("--select", select);
          if (full_refresh) args.push("--full-refresh");
          const cmdLine = `uv run ${args.map(shellQuote).join(" ")}`;
          await sandbox.startProcess(cmdLine, {
            cwd: MODELING_DIR,
            processId,
            autoCleanup: true,
          });
          return { processId };
        }
      );

      let finalExitCode: number | null = null;
      let finalLogs = "";
      let polls = 0;
      while (polls < MAX_POLL_ITERATIONS) {
        await step.sleep(
          `poll-sleep-${attempt}-${polls}`,
          `${POLL_INTERVAL_SECONDS} seconds`
        );
        const snapshot = await step.do(
          `poll-check-${attempt}-${polls}`,
          { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" } },
          async () => {
            const sandbox = getSandbox(this.env.Sandbox, SANDBOX_ID);
            const proc = await sandbox.getProcess(started.processId);
            if (proc === null) {
              // Process already reaped by the sandbox; treat as done.
              return { status: "completed" as const, exitCode: null as number | null };
            }
            const status = await proc.getStatus();
            const terminal = new Set([
              "completed",
              "failed",
              "killed",
              "error",
            ]);
            const exitCode = terminal.has(status)
              ? ((proc as unknown as { exitCode?: number }).exitCode ?? null)
              : null;
            return { status, exitCode };
          }
        );
        if (
          snapshot.status === "completed" ||
          snapshot.status === "failed" ||
          snapshot.status === "killed" ||
          snapshot.status === "error"
        ) {
          const final = await step.do(
            `collect-${attempt}-${polls}`,
            { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
            async () => {
              const sandbox = getSandbox(this.env.Sandbox, SANDBOX_ID);
              const logs = await sandbox.getProcessLogs(started.processId);
              return {
                stdout: logs.stdout,
                stderr: logs.stderr,
              };
            }
          );
          finalExitCode =
            snapshot.exitCode ??
            (snapshot.status === "completed" ? 0 : 1);
          finalLogs = `${final.stdout}\n${final.stderr}`;
          break;
        }
        polls++;
      }

      if (finalExitCode === null) {
        await step.do(
          `kill-stalled-${attempt}`,
          { retries: { limit: 1, delay: "5 seconds" } },
          async () => {
            const sandbox = getSandbox(this.env.Sandbox, SANDBOX_ID);
            await sandbox.killProcess(started.processId);
          }
        );
        finalExitCode = 124;
        finalLogs = "timed out waiting for dbt process";
      }

      lastResult = {
        exitCode: finalExitCode,
        stdout_tail: tail(finalLogs, 1500),
        stderr_tail: "",
        duration_ms: polls * POLL_INTERVAL_SECONDS * 1000,
      };

      if (finalExitCode === 0) {
        await step.do(
          "notify-success",
          { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" } },
          async () =>
            this.notifySlack(
              `:white_check_mark: dbt *${command}* succeeded on \`${target}\`` +
                (select ? ` (\`${select}\`)` : "") +
                `\nattempt: ${attempt}/${MAX_ATTEMPTS}` +
                `\nsource: ${source}` +
                `\nref: ${ref}`
            )
        );
        return lastResult;
      }

      if (attempt < MAX_ATTEMPTS) {
        await step.do(
          `notify-retry-${attempt}`,
          { retries: { limit: 1, delay: "5 seconds" } },
          async () =>
            this.notifySlack(
              `:repeat: dbt *${command}* on \`${target}\` failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying\n\`\`\`\n${tail(finalLogs, 800)}\n\`\`\``
            )
        );
        await step.sleep(
          `retry-backoff-${attempt}`,
          `${RETRY_BACKOFF_SECONDS} seconds`
        );
      }
    }

    await step.do(
      "notify-failure",
      { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" } },
      async () =>
        this.notifySlack(
          `:x: dbt *${command}* on \`${target}\` *failed* after ${MAX_ATTEMPTS} attempts` +
            `\nexit: ${lastResult?.exitCode ?? "n/a"}` +
            `\n\`\`\`\n${(lastResult?.stdout_tail ?? "").slice(-1500)}\n\`\`\``
        )
    );

    throw new Error(
      `dbt ${command} on ${target} failed after ${MAX_ATTEMPTS} attempts`
    );
  }

  private async notifySlack(text: string): Promise<void> {
    if (!this.env.SLACK_WEBHOOK_URL) return;
    try {
      await fetch(this.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } catch (e) {
      console.warn("slack notify failed", e);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProfilesInput {
  account: string;
  user: string;
  privateKeyPem: string;
  role: string;
  warehouse: string;
  database: string;
  schema: string;
}

function buildProfilesYaml(input: ProfilesInput): string {
  const keyLines = input.privateKeyPem
    .split("\n")
    .map((line) => `        ${line}`)
    .join("\n");

  return `modeling:
  target: prod
  outputs:
    prod:
      type: snowflake
      account: ${input.account}
      user: ${input.user}
      private_key: |
${keyLines}
      role: ${input.role}
      warehouse: ${input.warehouse}
      database: ${input.database}
      schema: ${input.schema}
      threads: 8
      client_session_keep_alive: false
`;
}

function shellQuote(arg: string): string {
  if (/^[a-zA-Z0-9._\-+/=:@,]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function tail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}
