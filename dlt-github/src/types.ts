import type { Sandbox } from "@cloudflare/sandbox";

export type Env = {
  SANDBOX: DurableObjectNamespace<Sandbox>;
  GITHUB_REPO: string; // e.g. "ta93abe/data-engineering-with-cloudflare"
  GITHUB_TOKEN: string;
  R2_CATALOG_TOKEN: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
  R2_CATALOG_URI: string;
  R2_CATALOG_WAREHOUSE: string;
};

export type PipelineRunResult = {
  runId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  output: string;
  error?: string;
};
