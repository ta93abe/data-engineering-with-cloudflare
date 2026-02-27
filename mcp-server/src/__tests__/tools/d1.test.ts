import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { listTables } from "../../tools/d1";

describe("d1-list-tables", () => {
  beforeEach(async () => {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS test_users (id INTEGER PRIMARY KEY, name TEXT)");
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS test_events (id INTEGER PRIMARY KEY, type TEXT)"
    );
  });

  it("should return table names", async () => {
    const result = await listTables(env.DB);
    expect(result).toContain("test_users");
    expect(result).toContain("test_events");
  });

  it("should exclude internal sqlite tables", async () => {
    const result = await listTables(env.DB);
    const internalTables = result.filter(
      (t) => t.startsWith("sqlite_") || t.startsWith("_cf_")
    );
    expect(internalTables).toHaveLength(0);
  });
});
