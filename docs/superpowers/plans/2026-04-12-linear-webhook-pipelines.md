# Linear Webhook → Pipelines → R2 Iceberg 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linear Webhook をリアルタイムで受信し、Cloudflare Pipelines 経由で R2 Data Catalog に Apache Iceberg テーブルとして書き込む streaming Worker を構築する。

**Architecture:** 新規 `streaming/` Worker（Hono）が Linear Webhook を受信し、HMAC-SHA256 署名検証後、ペイロードを正規化して `env.STREAM.send()` で Pipelines に送信する Thin Proxy パターン。Pipelines（Stream → Pipeline → Sink）が R2 バケット `lake` に Iceberg 形式で書き込む。

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Cloudflare Pipelines, R2 Data Catalog, Vitest + @cloudflare/vitest-pool-workers, Biome, Pulumi (Go)

**Design Spec:** `docs/superpowers/specs/2026-04-12-linear-webhook-pipelines-design.md`

---

## File Structure

### 新規作成

| ファイル | 責務 |
|---------|------|
| `streaming/src/index.ts` | Hono アプリ + エントリポイント |
| `streaming/src/types.ts` | 型定義（Env, LinearWebhookPayload 等） |
| `streaming/src/webhooks/linear.ts` | Linear Webhook ハンドラ（正規化 + send） |
| `streaming/src/lib/signature.ts` | HMAC-SHA256 署名検証ユーティリティ |
| `streaming/src/__tests__/env.d.ts` | テスト用の環境型定義 |
| `streaming/src/__tests__/signature.test.ts` | 署名検証のテスト |
| `streaming/src/__tests__/linear.test.ts` | Linear Webhook ハンドラのテスト |
| `streaming/src/__tests__/index.test.ts` | エンドポイント統合テスト |
| `streaming/schema/linear-events.json` | Stream スキーマ定義 |
| `streaming/sql/linear-pipeline.sql` | Pipeline SQL |
| `streaming/wrangler.jsonc` | Wrangler 設定 |
| `streaming/package.json` | 依存関係 |
| `streaming/tsconfig.json` | TypeScript 設定 |
| `streaming/biome.json` | Biome 設定 |
| `streaming/vitest.config.ts` | Vitest 設定 |

### 変更

| ファイル | 変更内容 |
|---------|---------|
| `infrastructure/pulumi/cloudflare.go` | R2 バケット `lake` の追加 + Outputs 更新 |
| `infrastructure/pulumi/main.go` | `lake` の Export 追加 |

---

## Task 1: プロジェクトスキャフォールド

**Files:**
- Create: `streaming/package.json`
- Create: `streaming/tsconfig.json`
- Create: `streaming/biome.json`
- Create: `streaming/wrangler.jsonc`

- [ ] **Step 1: `streaming/package.json` を作成**

```json
{
  "name": "streaming",
  "type": "module",
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
    "hono": "^4.11.7"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.3.13",
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.20250124.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.4.0"
  }
}
```

- [ ] **Step 2: `streaming/tsconfig.json` を作成**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ESNext"],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "types": ["@cloudflare/workers-types/experimental", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: `streaming/biome.json` を作成**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.13/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true,
    "includes": ["**", "!**/node_modules", "!**/dist", "!**/.wrangler", "!**/wrangler-env.d.ts"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "warn"
      },
      "complexity": {
        "noForEach": "off"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "es5"
    }
  },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

- [ ] **Step 4: `streaming/wrangler.jsonc` を作成**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "streaming",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "compatibility_flags": ["nodejs_compat"],

  "preview_urls": true,
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },
  "pipelines": [
    {
      "pipeline": "REPLACE_WITH_STREAM_ID",
      "binding": "STREAM"
    }
  ]
  // シークレット:
  //   wrangler secret put LINEAR_WEBHOOK_SECRET
}
```

- [ ] **Step 5: 依存関係をインストール**

Run: `cd streaming && pnpm install`
Expected: `node_modules/` が作成され、`pnpm-lock.yaml` が生成される

- [ ] **Step 6: コミット**

```bash
git add streaming/package.json streaming/pnpm-lock.yaml streaming/tsconfig.json streaming/biome.json streaming/wrangler.jsonc
git commit -m "chore: scaffold streaming worker project"
```

---

## Task 2: 型定義

**Files:**
- Create: `streaming/src/types.ts`

- [ ] **Step 1: `streaming/src/types.ts` を作成**

```typescript
import type { Pipeline } from "cloudflare:pipelines";

export interface Env {
  STREAM: Pipeline;
  LINEAR_WEBHOOK_SECRET: string;
}

// Linear Webhook の生ペイロード（camelCase）
export interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: string;
  createdAt: string;
  webhookId: string;
  webhookTimestamp: number;
  organizationId: string;
  url?: string;
  actor?: Record<string, unknown>;
  data: Record<string, unknown>;
  updatedFrom?: Record<string, unknown>;
}

// Stream に送信する正規化済みイベント（snake_case）
export interface LinearStreamEvent {
  action: string;
  type: string;
  created_at: string;
  webhook_id: string;
  webhook_timestamp: number;
  organization_id: string;
  url: string | null;
  actor: Record<string, unknown> | null;
  data: Record<string, unknown>;
  updated_from: Record<string, unknown> | null;
}
```

- [ ] **Step 2: コミット**

```bash
git add streaming/src/types.ts
git commit -m "feat: add type definitions for streaming worker"
```

---

## Task 3: 署名検証ユーティリティ（TDD）

**Files:**
- Create: `streaming/src/lib/signature.ts`
- Test: `streaming/src/__tests__/signature.test.ts`

- [ ] **Step 1: テスト用の型定義ファイルを作成**

Create `streaming/src/__tests__/env.d.ts`:

```typescript
declare module "cloudflare:test" {
  interface ProvidedEnv {
    STREAM: import("cloudflare:pipelines").Pipeline;
    LINEAR_WEBHOOK_SECRET: string;
  }
}
```

- [ ] **Step 2: vitest.config.ts を作成**

Create `streaming/vitest.config.ts`:

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

- [ ] **Step 3: 失敗するテストを書く**

Create `streaming/src/__tests__/signature.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { timingSafeEqual, verifySignature } from "../lib/signature";

describe("timingSafeEqual", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(timingSafeEqual("abc", "def")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("verifySignature", () => {
  const secret = "test-webhook-secret";

  it("returns true for valid signature", async () => {
    const body = '{"action":"create","type":"Issue"}';
    // Pre-computed HMAC-SHA256 of the body with the secret
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await verifySignature(body, hex, secret);
    expect(result).toBe(true);
  });

  it("returns false for invalid signature", async () => {
    const body = '{"action":"create","type":"Issue"}';
    const result = await verifySignature(body, "invalid-signature", secret);
    expect(result).toBe(false);
  });

  it("returns false for tampered body", async () => {
    const body = '{"action":"create","type":"Issue"}';
    const tamperedBody = '{"action":"remove","type":"Issue"}';
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await verifySignature(tamperedBody, hex, secret);
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `cd streaming && pnpm test:run`
Expected: FAIL — `Cannot find module '../lib/signature'`

- [ ] **Step 5: 最小限の実装を書く**

Create `streaming/src/lib/signature.ts`:

```typescript
/**
 * 定数時間での文字列比較（タイミング攻撃防止）
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Linear Webhook の HMAC-SHA256 署名を検証する
 *
 * @param body - リクエストの生ボディ文字列
 * @param signature - Linear-Signature ヘッダーの値（hex エンコード）
 * @param secret - Webhook signing secret
 * @returns 署名が有効なら true
 */
export async function verifySignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(computed, signature);
}
```

- [ ] **Step 6: テストがパスすることを確認**

Run: `cd streaming && pnpm test:run`
Expected: All 6 tests PASS

- [ ] **Step 7: コミット**

```bash
git add streaming/src/lib/signature.ts streaming/src/__tests__/signature.test.ts streaming/src/__tests__/env.d.ts streaming/vitest.config.ts
git commit -m "feat: add HMAC-SHA256 signature verification for webhook"
```

---

## Task 4: Linear Webhook ハンドラ（TDD）

**Files:**
- Create: `streaming/src/webhooks/linear.ts`
- Test: `streaming/src/__tests__/linear.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `streaming/src/__tests__/linear.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { normalizePayload, validateTimestamp } from "../webhooks/linear";
import type { LinearWebhookPayload } from "../types";

describe("normalizePayload", () => {
  it("converts camelCase keys to snake_case", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Issue",
      createdAt: "2026-04-12T10:00:00.000Z",
      webhookId: "wh-123",
      webhookTimestamp: 1744444800000,
      organizationId: "org-456",
      url: "https://linear.app/team/issue/ID-1",
      actor: { id: "user-1", name: "Test User" },
      data: { id: "issue-1", title: "Test Issue" },
      updatedFrom: { title: "Old Title" },
    };

    const result = normalizePayload(payload);

    expect(result).toEqual({
      action: "create",
      type: "Issue",
      created_at: "2026-04-12T10:00:00.000Z",
      webhook_id: "wh-123",
      webhook_timestamp: 1744444800000,
      organization_id: "org-456",
      url: "https://linear.app/team/issue/ID-1",
      actor: { id: "user-1", name: "Test User" },
      data: { id: "issue-1", title: "Test Issue" },
      updated_from: { title: "Old Title" },
    });
  });

  it("sets optional fields to null when absent", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Issue",
      createdAt: "2026-04-12T10:00:00.000Z",
      webhookId: "wh-123",
      webhookTimestamp: 1744444800000,
      organizationId: "org-456",
      data: { id: "issue-1" },
    };

    const result = normalizePayload(payload);

    expect(result.url).toBeNull();
    expect(result.actor).toBeNull();
    expect(result.updated_from).toBeNull();
  });
});

describe("validateTimestamp", () => {
  it("returns true for timestamp within 60 seconds", () => {
    const now = Date.now();
    expect(validateTimestamp(now)).toBe(true);
  });

  it("returns true for timestamp 30 seconds ago", () => {
    const thirtySecondsAgo = Date.now() - 30_000;
    expect(validateTimestamp(thirtySecondsAgo)).toBe(true);
  });

  it("returns false for timestamp older than 60 seconds", () => {
    const twoMinutesAgo = Date.now() - 120_000;
    expect(validateTimestamp(twoMinutesAgo)).toBe(false);
  });

  it("returns false for timestamp in the far future", () => {
    const fiveMinutesFromNow = Date.now() + 300_000;
    expect(validateTimestamp(fiveMinutesFromNow)).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd streaming && pnpm test:run`
Expected: FAIL — `Cannot find module '../webhooks/linear'`

- [ ] **Step 3: 最小限の実装を書く**

Create `streaming/src/webhooks/linear.ts`:

```typescript
import { Hono } from "hono";
import { verifySignature } from "../lib/signature";
import type { Env, LinearStreamEvent, LinearWebhookPayload } from "../types";

const TIMESTAMP_TOLERANCE_MS = 60_000;

/**
 * Linear Webhook ペイロードを Stream スキーマに正規化する
 */
export function normalizePayload(payload: LinearWebhookPayload): LinearStreamEvent {
  return {
    action: payload.action,
    type: payload.type,
    created_at: payload.createdAt,
    webhook_id: payload.webhookId,
    webhook_timestamp: payload.webhookTimestamp,
    organization_id: payload.organizationId,
    url: payload.url ?? null,
    actor: payload.actor ?? null,
    data: payload.data,
    updated_from: payload.updatedFrom ?? null,
  };
}

/**
 * Webhook タイムスタンプが許容範囲内か検証する（リプレイ攻撃防止）
 */
export function validateTimestamp(webhookTimestamp: number): boolean {
  const now = Date.now();
  const diff = Math.abs(now - webhookTimestamp);
  return diff <= TIMESTAMP_TOLERANCE_MS;
}

const linear = new Hono<{ Bindings: Env }>();

linear.post("/", async (c) => {
  const signature = c.req.header("Linear-Signature");
  if (!signature) {
    return c.json({ error: "Missing signature" }, 401);
  }

  const rawBody = await c.req.text();

  const isValid = await verifySignature(rawBody, signature, c.env.LINEAR_WEBHOOK_SECRET);
  if (!isValid) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const payload: LinearWebhookPayload = JSON.parse(rawBody);

  if (!validateTimestamp(payload.webhookTimestamp)) {
    return c.json({ error: "Timestamp out of range" }, 401);
  }

  const event = normalizePayload(payload);

  await c.env.STREAM.send([event]);

  return c.json({ success: true }, 200);
});

export default linear;
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `cd streaming && pnpm test:run`
Expected: All tests PASS（signature tests + linear tests）

- [ ] **Step 5: コミット**

```bash
git add streaming/src/webhooks/linear.ts streaming/src/__tests__/linear.test.ts
git commit -m "feat: add Linear webhook handler with normalization"
```

---

## Task 5: Hono アプリ + エントリポイント（TDD）

**Files:**
- Create: `streaming/src/index.ts`
- Test: `streaming/src/__tests__/index.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `streaming/src/__tests__/index.test.ts`:

```typescript
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("streaming worker", () => {
  it("returns health check on GET /health", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({ status: "ok" });
  });

  it("returns service info on GET /", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty("name", "streaming");
    expect(json).toHaveProperty("endpoints");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await SELF.fetch("https://example.com/unknown");
    expect(res.status).toBe(404);
  });

  it("returns 401 when Linear webhook has no signature", async () => {
    const res = await SELF.fetch("https://example.com/webhooks/linear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", type: "Issue" }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd streaming && pnpm test:run`
Expected: FAIL — module not found

- [ ] **Step 3: エントリポイントを実装する**

Create `streaming/src/index.ts`:

```typescript
import { Hono } from "hono";
import type { Env } from "./types";
import linear from "./webhooks/linear";

const app = new Hono<{ Bindings: Env }>();

// Webhook routes
app.route("/webhooks/linear", linear);

// Root
app.get("/", (c) => {
  return c.json({
    name: "streaming",
    endpoints: {
      "POST /webhooks/linear": "Receive Linear webhook events",
      "GET /health": "Health check",
    },
  });
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `cd streaming && pnpm test:run`
Expected: All tests PASS

- [ ] **Step 5: lint + typecheck**

Run: `cd streaming && pnpm check && pnpm typecheck`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add streaming/src/index.ts streaming/src/__tests__/index.test.ts
git commit -m "feat: add streaming worker entry point with Hono"
```

---

## Task 6: Pipelines スキーマ + SQL 定義

**Files:**
- Create: `streaming/schema/linear-events.json`
- Create: `streaming/sql/linear-pipeline.sql`

- [ ] **Step 1: Stream スキーマ定義を作成**

Create `streaming/schema/linear-events.json`:

```json
{
  "fields": [
    { "name": "action",            "type": "string",    "required": true },
    { "name": "type",              "type": "string",    "required": true },
    { "name": "created_at",        "type": "timestamp", "required": true },
    { "name": "webhook_id",        "type": "string",    "required": true },
    { "name": "webhook_timestamp", "type": "int64",     "required": true },
    { "name": "organization_id",   "type": "string",    "required": true },
    { "name": "url",               "type": "string",    "required": false },
    { "name": "actor",             "type": "json",      "required": false },
    { "name": "data",              "type": "json",      "required": true },
    { "name": "updated_from",      "type": "json",      "required": false }
  ]
}
```

- [ ] **Step 2: Pipeline SQL を作成**

Create `streaming/sql/linear-pipeline.sql`:

```sql
INSERT INTO linear_events_sink
SELECT
  action,
  type,
  created_at,
  webhook_id,
  webhook_timestamp,
  organization_id,
  url,
  actor,
  data,
  updated_from
FROM linear_events
```

- [ ] **Step 3: コミット**

```bash
git add streaming/schema/linear-events.json streaming/sql/linear-pipeline.sql
git commit -m "feat: add Pipelines stream schema and pipeline SQL"
```

---

## Task 7: Pulumi — R2 バケット `lake` 追加

**Files:**
- Modify: `infrastructure/pulumi/cloudflare.go`
- Modify: `infrastructure/pulumi/main.go`

- [ ] **Step 1: `cloudflare.go` に `lake` バケットを追加**

`infrastructure/pulumi/cloudflare.go` の `CloudflareOutputs` struct に `LakeR2BucketName` を追加:

```go
type CloudflareOutputs struct {
	D1DatabaseId       pulumi.IDOutput
	D1DatabaseName     pulumi.StringOutput
	R2BucketName       pulumi.StringOutput
	LakeR2BucketName   pulumi.StringOutput
	KvNamespaceId      pulumi.IDOutput
}
```

`createCloudflareResources` 関数内、Workers KV Namespace の前に追加:

```go
	// ===========================================
	// R2 Bucket (for Iceberg data lake)
	// ===========================================
	lake, err := cloudflare.NewR2Bucket(ctx, "lake", &cloudflare.R2BucketArgs{
		AccountId: pulumi.String(accountId),
		Name:      pulumi.String("lake"),
		Location:  pulumi.String("APAC"),
	}, pulumi.Protect(true))
	if err != nil {
		return nil, err
	}
```

return 文の `CloudflareOutputs` に追加:

```go
	return &CloudflareOutputs{
		D1DatabaseId:       rawDb.ID(),
		D1DatabaseName:     rawDb.Name,
		R2BucketName:       dataLake.Name,
		LakeR2BucketName:   lake.Name,
		KvNamespaceId:      cacheKv.ID(),
	}, nil
```

- [ ] **Step 2: `main.go` に Export を追加**

`infrastructure/pulumi/main.go` の Cloudflare Outputs セクションに追加:

```go
		ctx.Export("lakeR2BucketName", cf.LakeR2BucketName)
```

- [ ] **Step 3: Pulumi preview で確認**

Run: `cd infrastructure/pulumi && pulumi preview`
Expected: `+ cloudflare:index:R2Bucket lake create` が表示される

- [ ] **Step 4: コミット**

```bash
git add infrastructure/pulumi/cloudflare.go infrastructure/pulumi/main.go
git commit -m "feat: add R2 bucket 'lake' for Iceberg data lake"
```

---

## Task 8: Pipelines リソース作成（手動 CLI）

これは Wrangler CLI での手動操作タスク。コードの変更はない。

- [ ] **Step 1: R2 Data Catalog を有効化**

Run: `npx wrangler r2 bucket catalog enable lake`
Expected: Data Catalog が有効化され、warehouse name と catalog URI が返される

- [ ] **Step 2: Stream を作成**

Run:
```bash
cd streaming
npx wrangler pipelines streams create linear-events \
  --schema-file schema/linear-events.json \
  --http-enabled false
```
Expected: Stream が作成され、Stream ID が返される

- [ ] **Step 3: Sink を作成**

Run:
```bash
npx wrangler pipelines sinks create linear-events-sink \
  --type r2-data-catalog \
  --bucket lake \
  --namespace streaming \
  --table linear_events \
  --compression zstd \
  --roll-interval 300 \
  --catalog-token $R2_CATALOG_TOKEN
```
Expected: Sink が作成される

- [ ] **Step 4: Pipeline を作成**

Run:
```bash
npx wrangler pipelines create linear-events-pipeline \
  --sql-file sql/linear-pipeline.sql
```
Expected: Pipeline が作成される

- [ ] **Step 5: `wrangler.jsonc` の Stream ID を更新**

`streaming/wrangler.jsonc` の `REPLACE_WITH_STREAM_ID` を Step 2 で取得した Stream ID に置き換える。

- [ ] **Step 6: 型生成**

Run: `cd streaming && pnpm cf-typegen`
Expected: Pipeline バインディングの型が生成される

- [ ] **Step 7: コミット**

```bash
git add streaming/wrangler.jsonc
git commit -m "chore: set Pipelines stream ID in wrangler config"
```

---

## Task 9: E2E 動作確認

- [ ] **Step 1: Worker をローカルで起動**

Run: `cd streaming && pnpm dev`
Expected: Worker がローカルで起動する

- [ ] **Step 2: ヘルスチェックを確認**

Run: `curl http://localhost:8787/health`
Expected: `{"status":"ok"}`

- [ ] **Step 3: 署名なしリクエストが 401 を返すことを確認**

Run:
```bash
curl -X POST http://localhost:8787/webhooks/linear \
  -H "Content-Type: application/json" \
  -d '{"action":"create","type":"Issue"}'
```
Expected: `{"error":"Missing signature"}` with status 401

- [ ] **Step 4: Worker をデプロイ**

Run: `cd streaming && pnpm deploy`
Expected: Worker がデプロイされ URL が返される

- [ ] **Step 5: シークレットを設定**

Run: `cd streaming && wrangler secret put LINEAR_WEBHOOK_SECRET`
Expected: プロンプトで signing secret を入力し、設定完了

- [ ] **Step 6: Linear Webhook を設定**

Linear Settings > Administration > API > Webhooks:
- URL: `https://streaming.<subdomain>.workers.dev/webhooks/linear`
- Resource types: All
- Signing secret をコピーしておく（Step 5 で使用済み）

- [ ] **Step 7: Linear で Issue を作成してイベント確認**

Linear で新しい Issue を作成し、Workers Observability ログで Webhook 受信と `STREAM.send()` 成功を確認する。

- [ ] **Step 8: R2 SQL でデータ着信を確認**

Run:
```bash
npx wrangler r2 sql query "lake" "
  SELECT action, type, created_at, data
  FROM streaming.linear_events
  LIMIT 5
"
```
Expected: 作成した Issue のイベントが表示される（roll-interval 300 秒後）
