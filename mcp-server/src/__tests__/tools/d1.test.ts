import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { describeTable, listTables, queryD1 } from "../../tools/d1";

describe("d1-list-tables", () => {
  beforeEach(async () => {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS test_users (id INTEGER PRIMARY KEY, name TEXT)");
    await env.DB.exec("CREATE TABLE IF NOT EXISTS test_events (id INTEGER PRIMARY KEY, type TEXT)");
  });

  it("should return table names", async () => {
    const result = await listTables(env.DB);
    expect(result).toContain("test_users");
    expect(result).toContain("test_events");
  });

  it("should exclude internal sqlite tables", async () => {
    const result = await listTables(env.DB);
    const internalTables = result.filter((t) => t.startsWith("sqlite_") || t.startsWith("_cf_"));
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

describe("d1-query", () => {
  beforeEach(async () => {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS test_users (id INTEGER PRIMARY KEY, name TEXT)");
    await env.DB.exec("DELETE FROM test_users");
    await env.DB.exec("INSERT INTO test_users (id, name) VALUES (1, 'Alice'), (2, 'Bob')");
  });

  it("should execute SELECT query", async () => {
    const result = await queryD1(env.DB, "SELECT * FROM test_users ORDER BY id");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({ id: 1, name: "Alice" });
  });

  it("should execute parameterized query", async () => {
    const result = await queryD1(env.DB, "SELECT * FROM test_users WHERE name = ?", ["Bob"]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({ id: 2, name: "Bob" });
  });

  it("should execute INSERT and return changes", async () => {
    const result = await queryD1(env.DB, "INSERT INTO test_users (id, name) VALUES (?, ?)", [
      3,
      "Charlie",
    ]);
    expect(result.meta.changes).toBe(1);
  });
});
