import { defineConfig } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL;

if (!BASE_URL) {
  throw new Error(
    "E2E_BASE_URL must be set. Example: E2E_BASE_URL=https://sql-editor.ta93abe.workers.dev pnpm test:e2e"
  );
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
  },
});
