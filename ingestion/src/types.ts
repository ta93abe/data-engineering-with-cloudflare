export interface Env {
  DB: D1Database;
  DATA_LAKE: R2Bucket;
  GITHUB_TOKEN: string;
  GITHUB_USERNAME: string;
  OURA_CLIENT_ID: string;
  OURA_CLIENT_SECRET: string;
  OURA_REDIRECT_URI: string;
  OURA_BACKFILL_START_DATE: string;
  LINEAR_API_KEY: string;
  WITHINGS_CLIENT_ID: string;
  WITHINGS_CLIENT_SECRET: string;
  WITHINGS_REDIRECT_URI: string;
}

export interface SyncResult {
  service: string;
  success: boolean;
  message: string;
  count?: number;
}
