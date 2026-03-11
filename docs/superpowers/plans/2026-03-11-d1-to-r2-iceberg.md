# D1 → R2 Iceberg Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D1 の Oura Ring データを Cloudflare Pipelines 経由で R2 Data Catalog (Iceberg) にエクスポートする Worker を構築する。

**Architecture:** Cron Trigger で毎日動く Worker が D1 から差分データを SELECT し、4本の Pipelines binding に送信。Pipelines が Parquet 変換 + Iceberg メタデータ管理を担当。DuckDB から Iceberg REST Catalog 経由でクエリ。

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Pipelines, R2 Data Catalog, pnpm, Biome

**Spec:** `docs/superpowers/specs/2026-03-11-d1-to-r2-iceberg-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `d1-to-iceberg/package.json` | Create | 依存関係 (wrangler, biome, typescript) |
| `d1-to-iceberg/tsconfig.json` | Create | TypeScript 設定 |
| `d1-to-iceberg/biome.json` | Create | Lint & Format 設定 |
| `d1-to-iceberg/wrangler.jsonc` | Create | Worker 設定 (D1, Pipelines, Cron) |
| `d1-to-iceberg/src/types.ts` | Create | Env 型定義 |
| `d1-to-iceberg/src/export.ts` | Create | テーブルごとのエクスポートロジック |
| `d1-to-iceberg/src/index.ts` | Create | Cron handler エントリポイント |
| `infrastructure/d1/migrations/0005_export_sync_state.sql` | Create | sync_state に oura-export 行を追加 |

---

## Chunk 1: インフラセットアップ

### Task 1: R2 Data Catalog の有効化

**Files:** なし (CLI 操作のみ)

- [ ] **Step 1: R2 Data Catalog を有効化**

```bash
npx wrangler r2 bucket catalog enable data-lake
```

出力される **Catalog URI** と **Warehouse name** を控える。

- [ ] **Step 2: 出力を確認**

Catalog URI と Warehouse name が表示されることを確認。

### Task 2: Pipelines の作成

**Files:** なし (CLI 操作のみ)

4本の Pipeline を作成する。各 Pipeline は R2 Data Catalog sink を持つ。

まず R2 API トークンを Cloudflare ダッシュボードで作成する:
- R2 > **Manage R2 API Tokens** > **Create API Token**
- Permission: **Admin Read & Write** (R2 Data Catalog + R2 Storage の両方を含む)
- トークン値を控える → `CATALOG_TOKEN` として使用

- [ ] **Step 1: oura-daily-sleep Pipeline を作成**

```bash
npx wrangler pipelines create oura-daily-sleep \
  --r2-data-catalog \
  --bucket data-lake \
  --namespace oura \
  --table daily_sleep \
  --catalog-token <CATALOG_TOKEN> \
  --compression zstd
```

入力スキーマの設定が対話的に求められる場合は、spec の daily_sleep スキーマに従って設定する。

- [ ] **Step 2: oura-daily-activity Pipeline を作成**

```bash
npx wrangler pipelines create oura-daily-activity \
  --r2-data-catalog \
  --bucket data-lake \
  --namespace oura \
  --table daily_activity \
  --catalog-token <CATALOG_TOKEN> \
  --compression zstd
```

- [ ] **Step 3: oura-daily-readiness Pipeline を作成**

```bash
npx wrangler pipelines create oura-daily-readiness \
  --r2-data-catalog \
  --bucket data-lake \
  --namespace oura \
  --table daily_readiness \
  --catalog-token <CATALOG_TOKEN> \
  --compression zstd
```

- [ ] **Step 4: oura-heart-rate Pipeline を作成**

```bash
npx wrangler pipelines create oura-heart-rate \
  --r2-data-catalog \
  --bucket data-lake \
  --namespace oura \
  --table heart_rate \
  --catalog-token <CATALOG_TOKEN> \
  --compression zstd
```

- [ ] **Step 5: Pipeline 一覧を確認**

```bash
npx wrangler pipelines list
```

4本の Pipeline が表示されることを確認。

### Task 3: D1 マイグレーション

**Files:**
- Create: `infrastructure/d1/migrations/0005_export_sync_state.sql`

- [ ] **Step 1: マイグレーションファイルを作成**

```sql
-- oura-export: D1 → R2 Iceberg エクスポートの最終実行日を管理
-- 既存の id='oura' (API 取り込み日) とは別の用途
INSERT OR IGNORE INTO sync_state (id, data_source_id, last_sync_at)
VALUES ('oura-export', 'oura', NULL);
```

- [ ] **Step 2: リモート D1 にマイグレーションを適用**

```bash
cd ingestion
npx wrangler d1 migrations apply raw --remote
```

- [ ] **Step 3: マイグレーションを確認**

```bash
cd ingestion
npx wrangler d1 execute raw --remote --command "SELECT * FROM sync_state WHERE id = 'oura-export'"
```

`id='oura-export'`, `last_sync_at=NULL` の行が存在することを確認。

- [ ] **Step 4: コミット**

```bash
git add infrastructure/d1/migrations/0005_export_sync_state.sql
git commit -m "feat: Add D1 migration for oura-export sync state"
```

---

## Chunk 2: Worker プロジェクトのスキャフォールディング

### Task 4: プロジェクト初期化

**Files:**
- Create: `d1-to-iceberg/package.json`
- Create: `d1-to-iceberg/tsconfig.json`
- Create: `d1-to-iceberg/biome.json`
- Create: `d1-to-iceberg/wrangler.jsonc`
- Create: `d1-to-iceberg/src/types.ts`

- [ ] **Step 1: ディレクトリ作成**

```bash
mkdir -p d1-to-iceberg/src
```

- [ ] **Step 2: package.json を作成**

```json
{
  "name": "d1-to-iceberg",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy --minify",
    "typecheck": "tsc --noEmit",
    "lint": "biome lint .",
    "lint:fix": "biome lint --write .",
    "format": "biome format --write .",
    "check": "biome check .",
    "check:fix": "biome check --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^2.3.13",
    "@cloudflare/workers-types": "^4.20250124.0",
    "typescript": "^5.7.0",
    "wrangler": "^4.4.0"
  }
}
```

- [ ] **Step 3: tsconfig.json を作成**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types/experimental"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: biome.json を作成**

ingestion プロジェクトの biome.json をコピー。biome のバージョンは `pnpm install` 時に実際にインストールされるバージョンに合わせて `$schema` を調整する:

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

- [ ] **Step 5: wrangler.jsonc を作成**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "d1-to-iceberg",
  "main": "src/index.ts",
  "compatibility_date": "2026-03-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },

  // Cron: 毎日 UTC 01:00 (JST 10:00)
  "triggers": {
    "crons": ["0 1 * * *"]
  },

  // D1 — 既存の raw データベースに接続
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "raw",
      "database_id": "30fb49b7-8321-4792-8706-06c9205ce026"
    }
  ],

  // Pipelines — 4本の Pipeline binding
  "pipelines": [
    { "pipeline": "oura-daily-sleep", "binding": "PIPELINE_SLEEP" },
    { "pipeline": "oura-daily-activity", "binding": "PIPELINE_ACTIVITY" },
    { "pipeline": "oura-daily-readiness", "binding": "PIPELINE_READINESS" },
    { "pipeline": "oura-heart-rate", "binding": "PIPELINE_HEART_RATE" }
  ]
}
```

- [ ] **Step 6: src/types.ts を作成**

```typescript
export type Env = {
  DB: D1Database;
  PIPELINE_SLEEP: Pipeline;
  PIPELINE_ACTIVITY: Pipeline;
  PIPELINE_READINESS: Pipeline;
  PIPELINE_HEART_RATE: Pipeline;
};
```

注意: `Pipeline` 型は `@cloudflare/workers-types` に含まれている。もし型が見つからない場合は Pipelines のドキュメントを確認して調整する。

- [ ] **Step 7: 依存関係をインストール**

```bash
cd d1-to-iceberg
pnpm install
```

- [ ] **Step 8: 型チェック**

```bash
pnpm typecheck
```

`types.ts` のみなのでエラーなしで通るはず。`Pipeline` 型がない場合は `any` で仮置きし、後で修正。

- [ ] **Step 9: コミット**

```bash
git add d1-to-iceberg/
git commit -m "feat: Scaffold d1-to-iceberg Worker project"
```

---

## Chunk 3: エクスポートロジックの実装

### Task 5: エクスポート関数の実装

**Files:**
- Create: `d1-to-iceberg/src/export.ts`

- [ ] **Step 1: export.ts を作成**

エクスポートロジック。各テーブルの差分データを D1 から取得し、Pipeline に送信する。

```typescript
import type { Env } from "./types";

const PAGE_SIZE = 10000;

// テーブル名の allowlist（SQL injection 防止）
const ALLOWED_TABLES = [
  "oura_daily_sleep",
  "oura_daily_activity",
  "oura_daily_readiness",
] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

function isAllowedTable(table: string): table is AllowedTable {
  return (ALLOWED_TABLES as readonly string[]).includes(table);
}

async function getLastExportDate(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT last_sync_at FROM sync_state WHERE id = 'oura-export'")
    .first<{ last_sync_at: string | null }>();
  return row?.last_sync_at ?? null;
}

async function updateLastExportDate(db: D1Database, date: string): Promise<void> {
  await db
    .prepare("UPDATE sync_state SET last_sync_at = ? WHERE id = 'oura-export'")
    .bind(date)
    .run();
}

async function exportTable(
  db: D1Database,
  pipeline: Pipeline,
  table: string,
  lastExportDate: string | null
): Promise<number> {
  if (!isAllowedTable(table)) {
    throw new Error(`Table not allowed: ${table}`);
  }

  // table 名は allowlist で検証済み、day は .bind() でパラメータ化
  const sql = lastExportDate
    ? `SELECT * FROM ${table} WHERE day > ? ORDER BY day ASC`
    : `SELECT * FROM ${table} ORDER BY day ASC`;
  const result = lastExportDate
    ? await db.prepare(sql).bind(lastExportDate).all()
    : await db.prepare(sql).all();
  const rows = result.results;

  if (rows.length === 0) return 0;

  await pipeline.send(rows);
  return rows.length;
}

async function exportHeartRate(
  db: D1Database,
  pipeline: Pipeline,
  lastExportDate: string | null
): Promise<number> {
  let totalSent = 0;
  let cursorDay = lastExportDate ?? "";
  let cursorTimestamp = "";

  while (true) {
    let result: D1Result<Record<string, unknown>>;

    if (cursorDay === "" && cursorTimestamp === "") {
      // 初回エクスポート: 全データ
      result = await db
        .prepare(
          `SELECT * FROM oura_heart_rate ORDER BY day ASC, timestamp ASC LIMIT ${PAGE_SIZE}`
        )
        .all();
    } else if (cursorTimestamp === "") {
      // 差分エクスポート: 最初のページ（day のみでフィルタ）
      result = await db
        .prepare(
          `SELECT * FROM oura_heart_rate WHERE day > ? ORDER BY day ASC, timestamp ASC LIMIT ${PAGE_SIZE}`
        )
        .bind(cursorDay)
        .all();
    } else {
      // 2ページ目以降: day + timestamp でカーソル
      result = await db
        .prepare(
          `SELECT * FROM oura_heart_rate WHERE (day > ?) OR (day = ? AND timestamp > ?) ORDER BY day ASC, timestamp ASC LIMIT ${PAGE_SIZE}`
        )
        .bind(cursorDay, cursorDay, cursorTimestamp)
        .all();
    }

    const rows = result.results;
    if (rows.length === 0) break;

    await pipeline.send(rows);
    totalSent += rows.length;

    const lastRow = rows[rows.length - 1] as { day: string; timestamp: string };
    cursorDay = lastRow.day;
    cursorTimestamp = lastRow.timestamp;

    if (rows.length < PAGE_SIZE) break;
  }

  return totalSent;
}

export async function runExport(env: Env): Promise<string> {
  const lastExportDate = await getLastExportDate(env.DB);
  const logs: string[] = [];

  const sleepCount = await exportTable(
    env.DB,
    env.PIPELINE_SLEEP,
    "oura_daily_sleep",
    lastExportDate
  );
  logs.push(`daily_sleep: ${sleepCount} rows`);

  const activityCount = await exportTable(
    env.DB,
    env.PIPELINE_ACTIVITY,
    "oura_daily_activity",
    lastExportDate
  );
  logs.push(`daily_activity: ${activityCount} rows`);

  const readinessCount = await exportTable(
    env.DB,
    env.PIPELINE_READINESS,
    "oura_daily_readiness",
    lastExportDate
  );
  logs.push(`daily_readiness: ${readinessCount} rows`);

  const heartRateCount = await exportHeartRate(
    env.DB,
    env.PIPELINE_HEART_RATE,
    lastExportDate
  );
  logs.push(`heart_rate: ${heartRateCount} rows`);

  // 今日の日付でエクスポート日を更新
  const today = new Date().toISOString().split("T")[0];
  await updateLastExportDate(env.DB, today);

  const summary = `Export complete: ${logs.join(", ")}`;
  console.log(summary);
  return summary;
}
```

- [ ] **Step 2: 型チェック**

```bash
cd d1-to-iceberg
pnpm typecheck
```

`Pipeline` 型の `send()` メソッドの引数型を確認。エラーがあれば修正。

- [ ] **Step 3: コミット**

```bash
git add d1-to-iceberg/src/export.ts
git commit -m "feat: Implement D1 to Pipelines export logic"
```

### Task 6: Cron ハンドラーの実装

**Files:**
- Create: `d1-to-iceberg/src/index.ts`

- [ ] **Step 1: index.ts を作成**

```typescript
import { runExport } from "./export";
import type { Env } from "./types";

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runExport(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK");
    }

    // 手動トリガー用 (デバッグ)
    if (url.pathname === "/export" && request.method === "POST") {
      const result = await runExport(env);
      return new Response(result);
    }

    return new Response("Not Found", { status: 404 });
  },
};
```

- [ ] **Step 2: Biome チェック**

```bash
cd d1-to-iceberg
pnpm check
```

エラーがあれば `pnpm check:fix` で修正。

- [ ] **Step 3: 型チェック**

```bash
pnpm typecheck
```

- [ ] **Step 4: コミット**

```bash
git add d1-to-iceberg/src/index.ts
git commit -m "feat: Add Cron handler and manual trigger endpoint"
```

---

## Chunk 4: デプロイとテスト

### Task 7: デプロイ

**Files:** なし

- [ ] **Step 1: デプロイ**

```bash
cd d1-to-iceberg
npx wrangler deploy
```

デプロイ成功を確認。Pipeline binding のエラーが出る場合は、Pipeline 名が `wrangler.jsonc` と一致しているか確認。

- [ ] **Step 2: ヘルスチェック**

```bash
curl https://d1-to-iceberg.ta93abe.workers.dev/health
```

`OK` が返ることを確認。

### Task 8: 手動エクスポートテスト

**Files:** なし

- [ ] **Step 1: 手動エクスポートを実行**

```bash
curl -X POST https://d1-to-iceberg.ta93abe.workers.dev/export
```

レスポンスに各テーブルの送信行数が含まれることを確認:
```
Export complete: daily_sleep: N rows, daily_activity: N rows, daily_readiness: N rows, heart_rate: N rows
```

- [ ] **Step 2: sync_state が更新されたことを確認**

```bash
cd /Users/ta93abe/Developer/github.com/ta93abe/data-engineering-with-cloudflare/ingestion
npx wrangler d1 execute raw --remote --command "SELECT * FROM sync_state WHERE id = 'oura-export'"
```

`last_sync_at` に今日の日付が入っていることを確認。

- [ ] **Step 3: R2 Data Catalog にデータが書き込まれたことを確認**

```bash
npx wrangler r2 object list data-lake --prefix oura/
```

Parquet ファイルが生成されていることを確認。

- [ ] **Step 4: コミット**

```bash
git add d1-to-iceberg/
git commit -m "feat: Complete d1-to-iceberg Worker with Pipelines export"
```

### Task 9: DuckDB での確認

**Files:** なし

- [ ] **Step 1: DuckDB で Iceberg テーブルにクエリ**

ローカルの DuckDB で実行:

```sql
INSTALL iceberg;
LOAD iceberg;

CREATE SECRET r2_catalog (
  TYPE ICEBERG,
  TOKEN '<R2_API_TOKEN>'
);

ATTACH 'data-lake' AS oura_lake (
  TYPE ICEBERG,
  ENDPOINT '<CATALOG_URI>'
);

SELECT * FROM oura_lake.oura.daily_sleep ORDER BY day DESC LIMIT 5;
```

データが返ることを確認。

### Task 10: テーブルメンテナンスの有効化

**Files:** なし

- [ ] **Step 1: compaction を有効化**

```bash
npx wrangler r2 bucket catalog compaction enable data-lake oura daily_sleep --target-size 128
npx wrangler r2 bucket catalog compaction enable data-lake oura daily_activity --target-size 128
npx wrangler r2 bucket catalog compaction enable data-lake oura daily_readiness --target-size 128
npx wrangler r2 bucket catalog compaction enable data-lake oura heart_rate --target-size 128
```

- [ ] **Step 2: snapshot expiration を有効化**

```bash
npx wrangler r2 bucket catalog snapshot-expiration enable data-lake \
  --token <CATALOG_TOKEN> \
  --older-than-days 30 \
  --retain-last 10
```

---

## Summary

| Task | 内容 | 所要時間目安 |
|---|---|---|
| 1 | R2 Data Catalog 有効化 | 2 min |
| 2 | Pipelines 作成 (4本) | 5 min |
| 3 | D1 マイグレーション | 3 min |
| 4 | Worker スキャフォールディング | 5 min |
| 5 | エクスポートロジック実装 | 5 min |
| 6 | Cron ハンドラー実装 | 3 min |
| 7 | デプロイ | 2 min |
| 8 | 手動エクスポートテスト | 5 min |
| 9 | DuckDB 確認 | 5 min |
| 10 | テーブルメンテナンス有効化 | 3 min |
