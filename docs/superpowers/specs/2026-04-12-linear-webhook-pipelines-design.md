# Linear Webhook → Pipelines → R2 Iceberg 設計

**Issue**: [TA-443](https://linear.app/ta93abe/issue/TA-443) (P1: Pipelines ストリーミング取り込み — Linear Webhook 部分)
**Date**: 2026-04-12
**Status**: Approved

## 概要

Linear Webhook でリアルタイムイベント（Issue 作成/更新/コメント等）を受信し、Cloudflare Pipelines 経由で R2 Data Catalog に Apache Iceberg 形式で書き込む。

既存の ingestion Worker（6時間ごとの Cron スナップショット）は維持し、Webhook はイベントストリーム（CDC）として併用する。

## アーキテクチャ

```
Linear Webhook (HTTP POST)
    │
    │  Headers: Linear-Signature, Linear-Event, Linear-Delivery
    │
    ▼
┌─────────────────────────────┐
│  streaming/ Worker (Hono)   │
│                             │
│  POST /webhooks/linear      │
│  1. 署名検証 (HMAC-SHA256)  │
│  2. ペイロード正規化         │
│  3. env.STREAM.send()       │
│                             │
│  GET /health                │
└──────────┬──────────────────┘
           │ Pipeline binding
           ▼
┌─────────────────────────────┐
│  Pipelines                  │
│                             │
│  Stream: linear-events      │
│    ↓                        │
│  Pipeline: linear-events-   │
│            pipeline         │
│  SQL: パススルー（初期）      │
│    ↓                        │
│  Sink: linear-events-sink   │
│    → R2 Data Catalog        │
│      namespace: streaming   │
│      table: linear_events   │
│      format: Parquet/zstd   │
└─────────────────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  R2 Bucket: lake (新規)      │
│  APAC region                │
│  Data Catalog 有効化         │
│                             │
│  Iceberg table:             │
│  streaming.linear_events    │
└─────────────────────────────┘
```

### 設計方針: Thin Proxy パターン

Worker は署名検証 + 最小限の正規化 + `env.STREAM.send()` のみ。変換ロジックは Pipelines の SQL に寄せる。

**理由:**
- Worker の責務が最小限で CPU 時間が短い
- SQL 変換の変更は Pipeline の再作成のみで済む（Worker の再デプロイ不要）
- 将来 GitHub/Stripe/Slack Webhook を追加するときもシンプルに拡張できる

### 既存 ingestion との関係

| 方式 | 用途 | 出力先 |
|------|------|--------|
| Cron スナップショット（既存） | 現在の状態のスナップショット | `data-lake` (Parquet) |
| Webhook ストリーミング（今回） | リアルタイムのイベントログ（CDC） | `lake` (Iceberg) |

将来的に ingestion も `lake` バケットに移行予定。

## Stream スキーマ

全 Linear Webhook リソースを1つの Structured Stream で受け取る。

### スキーマ定義 (`streaming/schema/linear-events.json`)

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

### フィールド設計判断

| フィールド | 型 | 理由 |
|-----------|------|------|
| `action` | `string` | `create`/`update`/`remove` でフィルタ。top-level でクエリ性能向上 |
| `type` | `string` | `Issue`/`Comment`/`Project` 等でフィルタ |
| `created_at` | `timestamp` | イベント発生時刻。時系列分析の軸 |
| `webhook_id` | `string` | 重複排除に使用 |
| `webhook_timestamp` | `int64` | UNIX ms。リプレイ攻撃検出にも使用 |
| `organization_id` | `string` | マルチワークスペース対応の余地 |
| `actor` | `json` | 誰が操作したか。構造がリソースにより異なる |
| `data` | `json` | エンティティ本体。リソースタイプごとに構造が異なる |
| `updated_from` | `json` | update 時のみ存在。変更前の値 |

### 対応リソースタイプ

Issues, Comments, Issue attachments, Issue labels, Comment reactions, Projects, Project updates, Documents, Initiatives, Initiative Updates, Cycles, Customers, Customer Requests, Users

## Worker 実装設計

### ディレクトリ構成

```
streaming/
├── src/
│   ├── index.ts              # Hono アプリ + エントリポイント
│   ├── types.ts              # 型定義（Bindings, Webhook ペイロード等）
│   ├── webhooks/
│   │   └── linear.ts         # Linear Webhook ハンドラ
│   └── lib/
│       └── signature.ts      # HMAC-SHA256 署名検証ユーティリティ
├── schema/
│   └── linear-events.json    # Stream スキーマ定義
├── sql/
│   └── linear-pipeline.sql   # Pipeline SQL
├── wrangler.jsonc
├── package.json
├── biome.json
└── tsconfig.json
```

### エンドポイント

| メソッド | パス | 処理 |
|---------|------|------|
| `POST` | `/webhooks/linear` | Webhook 受信・署名検証・正規化・Stream send |
| `GET` | `/health` | ヘルスチェック |

### Webhook 受信フロー

1. `Linear-Signature` ヘッダーで HMAC-SHA256 署名検証（Web Crypto API）
2. `webhookTimestamp` が 60 秒以内か検証（リプレイ攻撃防止）
3. ペイロードを Stream スキーマに正規化（camelCase → snake_case）
4. `env.STREAM.send([normalizedEvent])` で Pipelines に送信
5. 成功時 `200 OK`、署名不正時 `401`、エラー時 `500`

### 署名検証

```typescript
// Web Crypto API（Workers ネイティブ）
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);
const signature = await crypto.subtle.sign("HMAC", key, rawBody);
// hex エンコードして Linear-Signature ヘッダーと定数時間比較
```

### 正規化処理

Linear ペイロードのキーを snake_case に変換：
- `createdAt` → `created_at`
- `webhookTimestamp` → `webhook_timestamp`
- `webhookId` → `webhook_id`
- `organizationId` → `organization_id`
- `updatedFrom` → `updated_from`

`data`、`actor`、`updatedFrom` の中身はそのまま `json` として格納。

### Wrangler 設定 (`wrangler.jsonc`)

```jsonc
{
  "name": "streaming",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "pipelines": [
    {
      "pipeline": "<STREAM_ID>",
      "binding": "STREAM"
    }
  ]
}
```

### シークレット

- `LINEAR_WEBHOOK_SECRET` — `wrangler secret put` で設定

## Pipelines 構成

### Stream 作成

```bash
npx wrangler pipelines streams create linear-events \
  --schema-file streaming/schema/linear-events.json \
  --http-enabled false
```

- HTTP エンドポイント無効（Worker バインディングのみ）

### Sink 作成

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

- **namespace**: `streaming`（将来 `streaming.github_events` 等を追加する命名体系）
- **roll-interval**: 300 秒（5分）。Linear Webhook の頻度では十分
- **compression**: zstd（デフォルト、最良の圧縮率）

### Pipeline 作成

```sql
-- streaming/sql/linear-pipeline.sql
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

```bash
npx wrangler pipelines create linear-events-pipeline \
  --sql-file streaming/sql/linear-pipeline.sql
```

初期はパススルー。将来的に追加可能な変換：
- `WHERE action != 'remove'` でソフトデリートフィルタ
- PII マスキング
- タイムスタンプ正規化

## インフラ（Pulumi）

### R2 バケット `lake` 追加

`infrastructure/pulumi/cloudflare.go` に追加：

```go
lake, err := cloudflare.NewR2Bucket(ctx, "lake", &cloudflare.R2BucketArgs{
    AccountId: pulumi.String(accountId),
    Name:      pulumi.String("lake"),
    Location:  pulumi.String("APAC"),
}, pulumi.Protect(true))
```

- APAC リージョン、`Protect: true`
- Data Catalog の有効化: `npx wrangler r2 bucket catalog enable lake`（Pulumi 未サポート）

### Pipelines リソース

Wrangler CLI で手動作成（Pulumi の Cloudflare プロバイダに Pipelines リソースが未実装）。

作成後の Stream ID を `wrangler.jsonc` に設定。

## デプロイ

### streaming Worker

Cloudflare Dashboard の GitHub 連携で自動デプロイ：
- `main` → 本番デプロイ
- PR → プレビュー URL

### Linear Webhook 設定

Linear Settings > Administration > API > Webhooks:
- **URL**: `https://streaming.<subdomain>.workers.dev/webhooks/linear`
- **Resource types**: All
- **Signing secret**: コピーして `wrangler secret put LINEAR_WEBHOOK_SECRET`

## クエリ例

### R2 SQL（Wrangler CLI）

```bash
# Issue の作成イベント
npx wrangler r2 sql query "lake" "
  SELECT
    created_at,
    action,
    data['title'] AS title,
    data['identifier'] AS identifier,
    actor['name'] AS actor_name
  FROM streaming.linear_events
  WHERE type = 'Issue' AND action = 'create'
  ORDER BY created_at DESC
  LIMIT 20
"

# アクター別 Issue 更新回数
npx wrangler r2 sql query "lake" "
  SELECT
    actor['name'] AS actor_name,
    COUNT(*) AS update_count
  FROM streaming.linear_events
  WHERE type = 'Issue' AND action = 'update'
  GROUP BY actor['name']
  ORDER BY update_count DESC
"
```

### DuckDB

```sql
INSTALL iceberg; LOAD iceberg;
INSTALL httpfs;  LOAD httpfs;
CREATE SECRET r2_secret (TYPE ICEBERG, TOKEN '<token>');
ATTACH '<warehouse_name>' AS lake (TYPE ICEBERG, ENDPOINT '<catalog_uri>');

SELECT type, action, COUNT(*) AS cnt
FROM lake.streaming.linear_events
GROUP BY type, action
ORDER BY cnt DESC;
```

## テスト戦略

1. **署名検証テスト**: 正しい署名 → 200、不正な署名 → 401、期限切れタイムスタンプ → 401
2. **正規化テスト**: Linear ペイロード → Stream スキーマへの変換が正しいか
3. **E2E テスト**: Linear Webhook をトリガーし、R2 SQL でデータを確認
