import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    exclude: ["src/__tests__/parquet.test.ts", "node_modules/**"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          workers: [
            {
              name: "parquet-encoder",
              modules: true,
              scriptPath: "./src/__tests__/mock-parquet-encoder.mjs",
            },
          ],
        },
      },
    },
  },
});
