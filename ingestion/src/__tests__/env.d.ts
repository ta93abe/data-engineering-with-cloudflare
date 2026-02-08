declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    GITHUB_TOKEN: string;
    GITHUB_USERNAME: string;
    OURA_CLIENT_ID: string;
    OURA_CLIENT_SECRET: string;
    OURA_REDIRECT_URI: string;
  }
}
