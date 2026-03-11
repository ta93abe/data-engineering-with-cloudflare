import type { Pipeline } from "cloudflare:pipelines";

export type Env = {
  DB: D1Database;
  PIPELINE_SLEEP: Pipeline;
  PIPELINE_ACTIVITY: Pipeline;
  PIPELINE_READINESS: Pipeline;
  PIPELINE_HEART_RATE: Pipeline;
};
