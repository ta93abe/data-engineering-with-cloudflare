export interface Env {
  DB: D1Database;
  GITHUB_TOKEN: string;
  GITHUB_USERNAME: string;
}

export interface SyncResult {
  service: string;
  success: boolean;
  message: string;
  count?: number;
}
