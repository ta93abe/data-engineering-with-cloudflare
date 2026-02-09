export interface Env {
  DB: D1Database;
  GITHUB_TOKEN: string;
  GITHUB_USERNAME: string;
  OURA_CLIENT_ID: string;
  OURA_CLIENT_SECRET: string;
  OURA_REDIRECT_URI: string;
  LINEAR_API_KEY: string;
}

export interface SyncResult {
  service: string;
  success: boolean;
  message: string;
  count?: number;
}
