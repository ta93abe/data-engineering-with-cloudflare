export interface SecretStoreSecret {
  get(): Promise<string | null>;
}

export interface Env {
  R2_SQL_TOKEN: SecretStoreSecret;
  ASSETS: Fetcher;
}

export interface R2SqlResponse {
  data?: Record<string, unknown>[];
  columns?: string[];
  [key: string]: unknown;
}

export const R2_SQL_ACCOUNT_ID = "b0047256d1afc1be1df08289ee3be552";
export const R2_SQL_WAREHOUSE = "b0047256d1afc1be1df08289ee3be552_lake";
