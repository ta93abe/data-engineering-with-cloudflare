declare module "cloudflare:test" {
  interface ProvidedEnv {
    STREAM: import("cloudflare:pipelines").Pipeline;
    LINEAR_WEBHOOK_SECRET: string;
  }
}
