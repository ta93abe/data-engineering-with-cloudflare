import type { Sandbox } from "@cloudflare/sandbox";

export type Env = {
  SANDBOX: DurableObjectNamespace<Sandbox>;
  R2_ARTIFACTS: R2Bucket;
  R2_ENDPOINT: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  GITHUB_REPO: string; // e.g. "ta93abe/data-engineering-with-cloudflare"
  GITHUB_TOKEN: string;
};

export type DbtCommand = "seed" | "run" | "test" | "build";

export type RunRequest = {
  ref?: string; // branch or SHA (defaults to "main")
  commands?: DbtCommand[];
  dbtDir?: string; // path to dbt project within repo (defaults to "transform/core")
};

export type DbtCommandResult = {
  command: DbtCommand;
  success: boolean;
  output: string;
  durationMs: number;
};

export type DbtRunResult = {
  runId: string;
  ref: string;
  commitSha: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  commands: DbtCommandResult[];
  error?: string;
};

export type DbtRunSummary = {
  runId: string;
  ref: string;
  commitSha: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
};
