# D1 → R2 Data Catalog (Iceberg) パイプライン設計

## 概要

D1 の Oura Ring データを Cloudflare Pipelines 経由で R2 Data Catalog に Iceberg テーブルとしてエクスポートする。Cron Trigger で毎日差分を自動送信し、DuckDB からクエリ可能にする。

## アーキテクチャ

```
D1 (raw)
  ↓  Cron Trigger (毎日 01:00 UTC)
Worker (d1-to-iceberg)
  ↓  Pipelines binding で JSON イベント送信
Cloudflare Pipelines (4本)
  ↓  Parquet 変換 + Iceberg テーブル書き込み
R2 Data Catalog (data-lake バケット)
  ↓  Iceberg REST Catalog
DuckDB (ローカル分析)
```

## コンポーネント

### 1. Worker (`d1-to-iceberg`)

新しい Worker プロジェクト。D1 から Oura データを読み取り、Pipelines に送信する。

**ディレクトリ**: `d1-to-iceberg/`

**環境変数・バインディング**:
- `DB`: D1 Database (raw)
- `PIPELINE_SLEEP`: Pipeline binding (oura-daily-sleep)
- `PIPELINE_ACTIVITY`: Pipeline binding (oura-daily-activity)
- `PIPELINE_READINESS`: Pipeline binding (oura-daily-readiness)
- `PIPELINE_HEART_RATE`: Pipeline binding (oura-heart-rate)

**wrangler.jsonc の Pipeline バインディング設定**:
```jsonc
{
  "pipelines": [
    { "pipeline": "oura-daily-sleep", "binding": "PIPELINE_SLEEP" },
    { "pipeline": "oura-daily-activity", "binding": "PIPELINE_ACTIVITY" },
    { "pipeline": "oura-daily-readiness", "binding": "PIPELINE_READINESS" },
    { "pipeline": "oura-heart-rate", "binding": "PIPELINE_HEART_RATE" }
  ]
}
```

**トリガー**: Cron `0 1 * * *` (毎日 UTC 01:00 = JST 10:00)

**処理フロー**:
1. D1 の `sync_state` テーブルから最終エクスポート日を取得（`id = 'oura-export'`）
2. 最終エクスポート日以降のレコードを各テーブルから SELECT
3. 各レコードを対応する Pipeline binding に送信
4. `sync_state` テーブルの `last_sync_at` を更新

**差分管理**:
- 既存の `sync_state` テーブルに `oura-export` 行を追加（D1 マイグレーション）
- `last_sync_at` カラムを「最終エクスポート日」として使用（既存の `id='oura'` 行は「最終 API 取り込み日」であり、用途が異なる）
- 初回実行時（`last_sync_at = NULL`）は全データをエクスポート

**心拍数テーブルのバッチ処理とページング**:
- `oura_heart_rate` は1日約288レコード（5分間隔）
- 初回エクスポート時は全履歴で 100,000+ レコードの可能性がある
- Workers Paid の CPU 制限（30秒）に対応するため、1回のクエリにつき `LIMIT 10000` でページングする
- 各ページを Pipeline の `send()` で送信し、次のページを取得
- `day` + `timestamp` でカーソルベースのページネーションを行う

### 2. R2 Data Catalog

既存の `data-lake` バケットで Data Catalog を有効化する。

**セットアップ手順**:
```bash
npx wrangler r2 bucket catalog enable data-lake
```
実行後に表示される **Catalog URI** と **Warehouse name** を控えておく（DuckDB 接続時に使用）。

**namespace**: `oura`

**テーブル**: Pipelines の sink 作成時に自動作成される
- `oura.daily_sleep`
- `oura.daily_activity`
- `oura.daily_readiness`
- `oura.heart_rate`

**メンテナンス**: compaction と snapshot expiration を有効化
```bash
# compaction（テーブルごとに有効化）
npx wrangler r2 bucket catalog compaction enable data-lake oura daily_sleep --target-size 128
npx wrangler r2 bucket catalog compaction enable data-lake oura daily_activity --target-size 128
npx wrangler r2 bucket catalog compaction enable data-lake oura daily_readiness --target-size 128
npx wrangler r2 bucket catalog compaction enable data-lake oura heart_rate --target-size 128

# snapshot expiration（カタログレベル）
npx wrangler r2 bucket catalog snapshot-expiration enable data-lake \
  --token <CATALOG_API_TOKEN> \
  --older-than-days 30 \
  --retain-last 10
```

### 3. Pipelines (4本)

テーブルごとに1本の Pipeline を作成。Worker binding 経由でデータを受け取り、R2 Data Catalog に Iceberg テーブルとして書き込む。

**Pipeline 一覧**:

| Pipeline 名 | Stream | Sink (R2 Data Catalog) | 圧縮 |
|---|---|---|---|
| `oura-daily-sleep` | Worker binding | `oura.daily_sleep` | zstd |
| `oura-daily-activity` | Worker binding | `oura.daily_activity` | zstd |
| `oura-daily-readiness` | Worker binding | `oura.daily_readiness` | zstd |
| `oura-heart-rate` | Worker binding | `oura.heart_rate` | zstd |

**入力スキーマ (daily_sleep)**:
```json
{
  "fields": [
    { "name": "id", "type": "string", "required": true },
    { "name": "day", "type": "string", "required": true },
    { "name": "score", "type": "int32", "required": false },
    { "name": "timestamp", "type": "string", "required": false },
    { "name": "deep_sleep", "type": "int32", "required": false },
    { "name": "efficiency", "type": "int32", "required": false },
    { "name": "latency", "type": "int32", "required": false },
    { "name": "rem_sleep", "type": "int32", "required": false },
    { "name": "restfulness", "type": "int32", "required": false },
    { "name": "timing", "type": "int32", "required": false },
    { "name": "total_sleep", "type": "int32", "required": false },
    { "name": "synced_at", "type": "string", "required": false }
  ]
}
```

**入力スキーマ (heart_rate)**:

D1 の全カラムをそのまま保存する。`id` は `INTEGER PRIMARY KEY AUTOINCREMENT`（内部キー）だが、元データの忠実な再現のために含める。

```json
{
  "fields": [
    { "name": "id", "type": "int32", "required": true },
    { "name": "bpm", "type": "int32", "required": true },
    { "name": "source", "type": "string", "required": false },
    { "name": "timestamp", "type": "string", "required": true },
    { "name": "day", "type": "string", "required": true },
    { "name": "synced_at", "type": "string", "required": false }
  ]
}
```

### 4. DuckDB クエリ

R2 Data Catalog の Iceberg REST Catalog エンドポイントに接続してクエリ。

API トークンは R2 Admin Read & Write 権限で作成（R2 Data Catalog + R2 Storage の両方の権限を含む）。

```sql
INSTALL iceberg;
LOAD iceberg;

-- R2 Data Catalog 用の SECRET を作成（TYPE は ICEBERG、TOKEN は R2 API トークン）
CREATE SECRET r2_catalog (
  TYPE ICEBERG,
  TOKEN '<R2_API_TOKEN>'
);

-- Catalog URI は `wrangler r2 bucket catalog enable` の出力値を使用
-- （R2 ストレージ URL とは異なる）
ATTACH 'data-lake' AS oura_lake (
  TYPE ICEBERG,
  ENDPOINT '<CATALOG_URI>'
);

SELECT * FROM oura_lake.oura.daily_sleep WHERE day >= '2026-03-01';
```

### 5. D1 マイグレーション

```sql
-- 0005_export_sync_state.sql
-- oura-export: D1 → R2 Iceberg エクスポートの最終実行日を管理
-- 既存の id='oura' (API 取り込み日) とは別の用途
INSERT OR IGNORE INTO sync_state (id, data_source_id, last_sync_at)
VALUES ('oura-export', 'oura', NULL);
```

`sync_state` テーブルの `last_sync_at` カラムを再利用する。`id='oura'` は「Oura API からの最終取り込み日」、`id='oura-export'` は「R2 への最終エクスポート日」を表す。

## インフラ変更

### Pulumi

変更なし。`data-lake` バケットは既に Pulumi で管理されている。R2 Data Catalog の有効化と Pipelines の作成は Wrangler CLI で行う（Pulumi の Cloudflare provider にはまだ Pipelines/Data Catalog リソースがない）。

## ファイル構成

```
d1-to-iceberg/
├── src/
│   ├── index.ts          # Cron handler + エクスポートロジック
│   └── types.ts          # Env 型定義
├── biome.json
├── package.json
├── tsconfig.json
└── wrangler.jsonc
infrastructure/d1/migrations/
└── 0005_export_sync_state.sql
```

## 制限事項・考慮事項

- **Pipelines は beta**: 本番ワークロードには注意が必要
- **Pipelines は Workers Paid プラン必須**: 既にプロジェクトで使用中なので問題なし
- **心拍数データの量**: 1日288レコード × 365日 ≈ 105,000レコード/年。初回エクスポートは `LIMIT 10000` でページングして CPU 制限に対応
- **冪等性**: 同じ日のデータが二重送信されても Iceberg の append になる。重複排除が必要な場合は後でクエリ側で対応
- **エラーハンドリング**: Pipeline 送信失敗時は `sync_state` を更新しない → 次回のCronで再送信

## 対象外

- Snowflake 連携（将来のフェーズ）
- Linear / Withings データのエクスポート（将来拡張）
- 重複排除ロジック（まずは append-only）
