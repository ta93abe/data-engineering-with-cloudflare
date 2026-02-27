# MCP Cloudflare D1 Server - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cloudflare D1 を操作できる MCP サーバーを TypeScript/Hono で実装し、Claude Desktop/Code から自然言語でデータベース操作を可能にする。

**Architecture:** Cloudflare Workers 上に Hono + MCP SDK (`@modelcontextprotocol/sdk`) でステートレスな MCP サーバーを構築。`agents` パッケージの `createMcpHandler` で Streamable HTTP トランスポートを提供し、D1 バインディング経由でデータベースを操作する。リクエストごとに McpServer インスタンスを新規作成（SDK 1.26.0+ のセキュリティ要件）。

**Tech Stack:** TypeScript, Hono, @modelcontextprotocol/sdk, agents (createMcpHandler), Zod 4, Vitest + @cloudflare/vitest-pool-workers

**Linear Issue:** [TA-216](https://linear.app/ta93abe/issue/TA-216)

**Branch:** `feat/mcp-cloudflare-d1`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/wrangler.jsonc`
- Create: `mcp-server/tsconfig.json`
- Create: `mcp-server/biome.json`
- Create: `mcp-server/vitest.config.ts`
- Remove: `mcp-server/.gitkeep`

**Step 1: Create package.json**

```json
{
  "name": "mcp-cloudflare",
  "type": "module",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy --minify",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit",
    "cf-typegen": "wrangler types --env-interface CloudflareBindings",
    "lint": "biome lint .",
    "lint:fix": "biome lint --write .",
    "format": "biome format --write .",
    "check": "biome check .",
    "check:fix": "biome check --write ."
  },
  "dependencies": {
    "agents": "^0.5.0",
    "hono": "^4.11.7",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.3.13",
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.20250124.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.67.0"
  }
}
```

**Step 2: Create wrangler.jsonc**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "mcp-cloudflare",
  "main": "src/index.ts",
  "compatibility_date": "2026-02-27",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "raw",
      "database_id": "30fb49b7-8321-4792-8706-06c9205ce026"
    }
  ]
}
```

**Step 3: Create tsconfig.json** (ingestion と同じ、jsx 不要)

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types/experimental", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Step 4: Create biome.json** (ingestion と同一)

**Step 5: Create vitest.config.ts** (ingestion と同一)

**Step 6: Install dependencies**

Run: `cd mcp-server && pnpm install`

**Step 7: Remove .gitkeep and commit**

```
chore: scaffold mcp-server project [TA-216]
```

---

### Task 2: Types + Hono Health Endpoint

**Files:**
- Create: `mcp-server/src/types.ts`
- Create: `mcp-server/src/index.ts`
- Create: `mcp-server/src/__tests__/index.test.ts`

**Step 1: Write the failing test**

```typescript
// src/__tests__/index.test.ts
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("MCP Server", () => {
  it("should return OK on health check", async () => {
    const response = await SELF.fetch("http://localhost/health");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });

  it("should return 404 on unknown routes", async () => {
    const response = await SELF.fetch("http://localhost/unknown");
    expect(response.status).toBe(404);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-server && pnpm test:run`
Expected: FAIL (no src/index.ts)

**Step 3: Write types and implementation**

```typescript
// src/types.ts
export type Bindings = {
  DB: D1Database;
  MCP_AUTH_TOKEN: string;
};
```

```typescript
// src/index.ts
import { Hono } from "hono";
import type { Bindings } from "./types";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.text("OK"));

export default app;
```

**Step 4: Run test to verify it passes**

Run: `cd mcp-server && pnpm test:run`
Expected: PASS

**Step 5: Commit**

```
feat: add types and health endpoint for mcp-server [TA-216]
```

---

### Task 3: D1 list-tables Tool

**Files:**
- Create: `mcp-server/src/tools/d1.ts`
- Create: `mcp-server/src/__tests__/tools/d1.test.ts`

**Step 1: Write the failing test**

```typescript
// src/__tests__/tools/d1.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { listTables } from "../../tools/d1";

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
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-server && pnpm test:run`
Expected: FAIL (module not found)

**Step 3: Write implementation**

```typescript
// src/tools/d1.ts
export async function listTables(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    )
    .all<{ name: string }>();
  return result.results.map((row) => row.name);
}
```

**Step 4: Run test to verify it passes**

Run: `cd mcp-server && pnpm test:run`
Expected: PASS

**Step 5: Commit**

```
feat: add d1-list-tables tool [TA-216]
```

---

### Task 4: D1 describe Tool

**Files:**
- Modify: `mcp-server/src/tools/d1.ts`
- Modify: `mcp-server/src/__tests__/tools/d1.test.ts`

**Step 1: Write the failing test**

```typescript
// Append to src/__tests__/tools/d1.test.ts
import { describeTable } from "../../tools/d1";

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
});
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-server && pnpm test:run`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// Add to src/tools/d1.ts
export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export async function describeTable(db: D1Database, table: string): Promise<ColumnInfo[]> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  const result = await db.prepare(`PRAGMA table_info(${table})`).all<ColumnInfo>();
  if (result.results.length === 0) {
    throw new Error(`Table not found: ${table}`);
  }
  return result.results;
}
```

**Step 4: Run test to verify it passes**

Run: `cd mcp-server && pnpm test:run`
Expected: PASS

**Step 5: Commit**

```
feat: add d1-describe tool [TA-216]
```

---

### Task 5: D1 query Tool

**Files:**
- Modify: `mcp-server/src/tools/d1.ts`
- Modify: `mcp-server/src/__tests__/tools/d1.test.ts`

**Step 1: Write the failing test**

```typescript
// Append to src/__tests__/tools/d1.test.ts
import { queryD1 } from "../../tools/d1";

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
    const result = await queryD1(
      env.DB,
      "INSERT INTO test_users (id, name) VALUES (?, ?)",
      [3, "Charlie"]
    );
    expect(result.meta.changes).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-server && pnpm test:run`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// Add to src/tools/d1.ts
export interface QueryResult {
  results: Record<string, unknown>[];
  meta: {
    changes: number;
    last_row_id: number;
    duration: number;
  };
}

export async function queryD1(
  db: D1Database,
  sql: string,
  params?: unknown[]
): Promise<QueryResult> {
  const stmt = db.prepare(sql);
  const bound = params && params.length > 0 ? stmt.bind(...params) : stmt;
  const result = await bound.all();
  return {
    results: result.results as Record<string, unknown>[],
    meta: {
      changes: result.meta?.changes ?? 0,
      last_row_id: result.meta?.last_row_id ?? 0,
      duration: result.meta?.duration ?? 0,
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd mcp-server && pnpm test:run`
Expected: PASS

**Step 5: Commit**

```
feat: add d1-query tool [TA-216]
```

---

### Task 6: MCP Server Integration

**Files:**
- Create: `mcp-server/src/server.ts`
- Modify: `mcp-server/src/index.ts`

**Step 1: Create MCP server factory**

```typescript
// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Bindings } from "./types";
import { listTables, describeTable, queryD1 } from "./tools/d1";

export function createMcpServer(env: Bindings): McpServer {
  const server = new McpServer({
    name: "mcp-cloudflare",
    version: "1.0.0",
  });

  server.tool("d1-list-tables", "List all tables in the D1 database", async () => ({
    content: [{ type: "text", text: JSON.stringify(await listTables(env.DB), null, 2) }],
  }));

  server.tool(
    "d1-describe",
    "Get schema information for a D1 table",
    { table: z.string().describe("Table name to describe") },
    async ({ table }) => ({
      content: [{ type: "text", text: JSON.stringify(await describeTable(env.DB, table), null, 2) }],
    })
  );

  server.tool(
    "d1-query",
    "Execute a SQL query against the D1 database",
    {
      sql: z.string().describe("SQL query to execute"),
      params: z.array(z.unknown()).optional().describe("Query parameters for prepared statement"),
    },
    async ({ sql, params }) => ({
      content: [{ type: "text", text: JSON.stringify(await queryD1(env.DB, sql, params), null, 2) }],
    })
  );

  return server;
}
```

**Step 2: Wire MCP handler into index.ts**

```typescript
// src/index.ts
import { Hono } from "hono";
import { createMcpHandler } from "agents/mcp";
import type { Bindings } from "./types";
import { createMcpServer } from "./server";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.text("OK"));

app.all("/mcp", async (c) => {
  const server = createMcpServer(c.env);
  const handler = createMcpHandler(server);
  return handler(c.req.raw, c.env, c.executionCtx);
});

export default app;
```

**Step 3: Run existing tests to verify nothing breaks**

Run: `cd mcp-server && pnpm test:run`
Expected: All PASS

**Step 4: Manual test with MCP Inspector**

Run: `cd mcp-server && pnpm dev` (terminal 1)
Run: `npx @modelcontextprotocol/inspector@latest` (terminal 2)
- Connect to `http://localhost:8787/mcp`
- Verify 3 tools appear: d1-list-tables, d1-describe, d1-query
- Test d1-list-tables

**Step 5: Commit**

```
feat: integrate D1 tools with MCP server [TA-216]
```

---

### Task 7: Bearer Token Auth Middleware

**Files:**
- Create: `mcp-server/src/middleware/auth.ts`
- Create: `mcp-server/src/__tests__/middleware/auth.test.ts`
- Modify: `mcp-server/src/index.ts`

**Step 1: Write the failing test**

```typescript
// src/__tests__/middleware/auth.test.ts
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("Auth Middleware", () => {
  it("should allow health check without auth", async () => {
    const response = await SELF.fetch("http://localhost/health");
    expect(response.status).toBe(200);
  });

  it("should reject /mcp without auth header", async () => {
    const response = await SELF.fetch("http://localhost/mcp", { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("should reject /mcp with invalid token", async () => {
    const response = await SELF.fetch("http://localhost/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(response.status).toBe(401);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-server && pnpm test:run`
Expected: FAIL (no auth check)

**Step 3: Write implementation**

```typescript
// src/middleware/auth.ts
import type { Context, Next } from "hono";
import type { Bindings } from "../types";

export async function bearerAuth(c: Context<{ Bindings: Bindings }>, next: Next) {
  if (c.req.path === "/health") {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  if (token !== c.env.MCP_AUTH_TOKEN) {
    return c.json({ error: "Invalid token" }, 401);
  }

  return next();
}
```

Update index.ts:
```typescript
import { bearerAuth } from "./middleware/auth";
app.use("*", bearerAuth);
```

**Step 4: Run test to verify it passes**

Run: `cd mcp-server && pnpm test:run`
Expected: All PASS

**Step 5: Commit**

```
feat: add bearer token auth middleware [TA-216]
```

---

## References

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [createMcpHandler API](https://developers.cloudflare.com/agents/model-context-protocol/mcp-handler-api/)
- [Build a Remote MCP Server](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- [Streamable HTTP Transport](https://blog.cloudflare.com/streamable-http-mcp-servers-python/)
- [MCP Transports Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
