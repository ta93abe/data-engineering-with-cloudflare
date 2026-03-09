import type { Sandbox } from "@cloudflare/sandbox";

export type Env = {
  SANDBOX: DurableObjectNamespace<Sandbox>;
  R2_ARTIFACTS: R2Bucket;
  R2_ENDPOINT: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
};

export type DbtCommand = "seed" | "run" | "test";

export type DbtCommandResult = {
  command: DbtCommand;
  success: boolean;
  output: string;
  durationMs: number;
};

export type DbtRunResult = {
  runId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  commands: DbtCommandResult[];
  error?: string;
};

export type DbtRunSummary = {
  runId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
};
