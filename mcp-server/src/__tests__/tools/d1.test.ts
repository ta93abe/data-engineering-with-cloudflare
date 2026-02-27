import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { describeTable, listTables } from "../../tools/d1";

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

describe("d1-describe", () => {
  beforeEach(async () => {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS test_users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT)"
    );
  });

  it("should return column info for a table", async () => {
    const columns = await describeTable(env.DB, "test_users");
    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", type: "INTEGER" }),
        expect.objectContaining({ name: "name", type: "TEXT", notnull: 1 }),
        expect.objectContaining({ name: "email", type: "TEXT", notnull: 0 }),
      ])
    );
  });

  it("should throw for non-existent table", async () => {
    await expect(describeTable(env.DB, "nonexistent")).rejects.toThrow();
  });

  it("should throw for invalid table name", async () => {
    await expect(describeTable(env.DB, "'; DROP TABLE--")).rejects.toThrow("Invalid table name");
  });
});
