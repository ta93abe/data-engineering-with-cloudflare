import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from "cloudflare:workers";
import type { JobRecord, JobState } from "./index";

/**
 * Parameters accepted by the DbtBuildWorkflow.
 *
 * These can come from cron trigger (source="cron"), webhook
 * (source="webhook"), or a manual invocation via the Worker API.
 */
export interface DbtBuildWorkflowParams {
  command?: "build" | "build-docs" | "run" | "test" | "seed" | "docs";
  target?: "dev" | "prod";
  select?: string;
  full_refresh?: boolean;
  source?: string;
}

interface WorkflowEnv {
  JOB_REGISTRY: DurableObjectNamespace;
  API_KEY: string;
  SLACK_WEBHOOK_URL?: string;
  WORKER_BASE_URL?: string;
}

const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_SECONDS = 30;
const MAX_POLL_ITERATIONS = 240; // 240 * 30s = 2 hours per attempt
const TERMINAL_STATES = new Set<JobState>([
  "complete",
  "failed",
  "cancelled",
  "error",
]);

export class DbtBuildWorkflow extends WorkflowEntrypoint<
  WorkflowEnv,
  DbtBuildWorkflowParams
> {
  async run(
    event: WorkflowEvent<DbtBuildWorkflowParams>,
    step: WorkflowStep
  ): Promise<JobRecord> {
    const payload = event.payload ?? {};
    const command = payload.command ?? "build-docs";
    const target = payload.target ?? "prod";
    const select = payload.select;
    const full_refresh = payload.full_refresh ?? false;
    const source = payload.source ?? "manual";

    let lastResult: JobRecord | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Step 1: submit the job via JobRegistry.
      const submitted = await step.do(
        `submit-attempt-${attempt}`,
        { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" } },
        async () => {
          return await this._submitJob({
            command,
            target,
            select,
            full_refresh,
            source,
          });
        }
      );

      const jobId = submitted.id;

      // Step 2: poll until the job reaches a terminal state. Use
      // step.sleep between poll attempts so the workflow can hibernate
      // across the entire build duration without holding a CPU.
      let latest: JobRecord = submitted;
      let pollIndex = 0;
      while (pollIndex < MAX_POLL_ITERATIONS) {
        await step.sleep(
          `poll-sleep-${attempt}-${pollIndex}`,
          `${POLL_INTERVAL_SECONDS} seconds`
        );
        latest = await step.do(
          `poll-${attempt}-${pollIndex}`,
          { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" } },
          async () => this._fetchJob(jobId)
        );
        if (TERMINAL_STATES.has(latest.state)) break;
        pollIndex++;
      }

      lastResult = latest;

      // Success: notify Slack and return.
      if (latest.state === "complete" && latest.returncode === 0) {
        await step.do("notify-success", { retries: { limit: 3, delay: "15 seconds" } }, async () =>
          this._notifySlack(
            `:white_check_mark: dbt *${command}* succeeded on \`${target}\`` +
              (select ? ` (\`${select}\`)` : "") +
              `\njob_id: \`${jobId}\`` +
              `\nattempt: ${attempt}/${MAX_ATTEMPTS}` +
              (source ? `\nsource: ${source}` : "")
          )
        );
        return latest;
      }

      // Superseded by a newer job (latest-wins) — stop retrying.
      if (latest.state === "cancelled") {
        await step.do("notify-cancelled", { retries: { limit: 1, delay: "5 seconds" } }, async () =>
          this._notifySlack(
            `:warning: dbt *${command}* on \`${target}\` was cancelled (superseded)` +
              `\njob_id: \`${jobId}\``
          )
        );
        return latest;
      }

      // Failed / error — fall through to retry, unless exhausted.
      if (attempt < MAX_ATTEMPTS) {
        await step.do(
          `notify-retry-${attempt}`,
          { retries: { limit: 1, delay: "5 seconds" } },
          async () =>
            this._notifySlack(
              `:repeat: dbt *${command}* on \`${target}\` failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying` +
                `\nreturncode: ${latest.returncode ?? "n/a"}` +
                (latest.error ? `\nerror: ${latest.error}` : "") +
                `\njob_id: \`${jobId}\``
            )
        );
        await step.sleep(`retry-backoff-${attempt}`, "60 seconds");
      }
    }

    // All attempts exhausted.
    await step.do("notify-failure", { retries: { limit: 3, delay: "15 seconds" } }, async () =>
      this._notifySlack(
        `:x: dbt *${payload.command ?? "build-docs"}* on \`${target}\` *failed* after ${MAX_ATTEMPTS} attempts` +
          `\nreturncode: ${lastResult?.returncode ?? "n/a"}` +
          (lastResult?.error ? `\nerror: ${lastResult.error}` : "") +
          `\nstdout tail:\n\`\`\`\n${(lastResult?.stdout_tail ?? "").slice(-1500)}\n\`\`\``
      )
    );

    throw new Error(
      `dbt ${command} on ${target} failed after ${MAX_ATTEMPTS} attempts`
    );
  }

  // --- helpers -----------------------------------------------------

  private async _submitJob(params: {
    command: string;
    target: string;
    select?: string;
    full_refresh: boolean;
    source: string;
  }): Promise<JobRecord> {
    const base = this.env.WORKER_BASE_URL ?? "https://modeling.ta93abe.workers.dev";
    const res = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.env.API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      throw new Error(`submit failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as JobRecord;
  }

  private async _fetchJob(jobId: string): Promise<JobRecord> {
    const base = this.env.WORKER_BASE_URL ?? "https://modeling.ta93abe.workers.dev";
    const res = await fetch(`${base}/jobs/${jobId}`, {
      headers: { "Authorization": `Bearer ${this.env.API_KEY}` },
    });
    if (!res.ok) {
      throw new Error(`poll failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as JobRecord;
  }

  private async _notifySlack(text: string): Promise<void> {
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
