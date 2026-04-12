export interface SecretStoreSecret {
  get(): Promise<string | null>;
}

export interface Env {
  R2_SQL_TOKEN: SecretStoreSecret;
  ASSETS: Fetcher;
}

export interface R2SqlResponse {
  result?: {
    schema?: { name: string; descriptor: { type: { name: string }; nullable: boolean } }[];
    rows?: Record<string, unknown>[];
    metrics?: Record<string, unknown>;
  };
  success: boolean;
  errors: { code: number; message: string }[];
  messages: string[];
}

export const R2_SQL_ACCOUNT_ID = "b0047256d1afc1be1df08289ee3be552";
export const R2_SQL_BUCKET_NAME = "lake";
