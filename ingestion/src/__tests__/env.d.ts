declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    GITHUB_TOKEN: string;
    GITHUB_USERNAME: string;
  }
}
