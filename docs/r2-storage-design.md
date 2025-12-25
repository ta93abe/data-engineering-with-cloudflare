# Cloudflare R2 ストレージ設計

本ドキュメントでは、Cloudflareデータ基盤におけるR2のバケット戦略とフォルダ構造設計について解説します。

## 目次

- [バケット戦略](#バケット戦略)
- [フォルダ構造設計](#フォルダ構造設計)
- [データライフサイクル](#データライフサイクル)
- [命名規則](#命名規則)
- [アクセス制御](#アクセス制御)
- [コスト最適化](#コスト最適化)
- [運用ガイド](#運用ガイド)

---

## バケット戦略

### 推奨バケット構成（全4バケット）

Cloudflareデータ基盤では、**データレイヤー別に4つのバケット**を作成することを推奨します。

```
┌─────────────────────────────────────────────────────────────┐
│ 1. data-lake-raw                                            │
│    用途: dltによる生データの格納                               │
│    保持期間: 90日                                             │
│    アクセス: dlt Worker (書き込み), dbt (読み取り)              │
├─────────────────────────────────────────────────────────────┤
│ 2. data-lake-processed                                      │
│    用途: dbtで変換後の中間データ（Staging/Intermediate）       │
│    保持期間: 30日                                             │
│    アクセス: dbt (読み書き), Analytics Workers (読み取り)      │
├─────────────────────────────────────────────────────────────┤
│ 3. data-lake-curated                                        │
│    用途: 分析用の最終データ（Marts）、Icebergテーブル           │
│    保持期間: 1年 (アーカイブ後は無期限)                        │
│    アクセス: dbt (書き込み), Evidence/R2 SQL (読み取り)        │
├─────────────────────────────────────────────────────────────┤
│ 4. data-lake-archive                                        │
│    用途: 長期保存、コンプライアンス対応                         │
│    保持期間: 無期限                                            │
│    アクセス: アーカイブツール (書き込み), アドホック (読み取り)  │
└─────────────────────────────────────────────────────────────┘
```

### バケット別詳細

#### 1. `data-lake-raw` - Bronze Layer

**目的:** 外部システムから取り込んだ生データを格納

**特徴:**
- dltパイプラインが書き込み
- Parquet/JSON形式
- パーティション: 日付ベース
- 変換なし、ソースそのまま

**用途:**
- APIからの取り込みデータ
- ファイルアップロード
- イベントログ
- データ再処理用のバックアップ

**アクセスパターン:**
- 書き込み: 頻繁（dlt Workers）
- 読み取り: 中程度（dbt変換時）

---

#### 2. `data-lake-processed` - Silver Layer

**目的:** dbtで1次変換したデータを格納

**特徴:**
- dbtのStaging/Intermediateモデル
- データクレンジング済み
- スキーマ統一
- Parquet形式

**用途:**
- 正規化されたテーブル
- 結合用の中間テーブル
- データ品質検証済みデータ

**アクセスパターン:**
- 書き込み: 定期的（dbt run）
- 読み取り: 頻繁（dbt downstream）

---

#### 3. `data-lake-curated` - Gold Layer

**目的:** 分析・可視化用の最終データを格納

**特徴:**
- dbtのMartsモデル
- Apache Iceberg形式（ACIDトランザクション）
- ビジネスロジック適用済み
- R2 Data Catalog統合

**用途:**
- ダッシュボード用データ
- レポート用集計テーブル
- 機械学習用フィーチャーストア
- 外部システムへのエクスポート

**アクセスパターン:**
- 書き込み: 定期的（dbt run）
- 読み取り: 非常に頻繁（Evidence, R2 SQL, API）

---

#### 4. `data-lake-archive` - Archive Layer

**目的:** 長期保存・コンプライアンス対応

**特徴:**
- 圧縮形式（Parquet + Snappy/ZSTD）
- イミュータブル（書き込み後変更なし）
- メタデータカタログ
- 低頻度アクセス

**用途:**
- 法規制対応（データ保持義務）
- 過去データの再分析
- 監査証跡

**アクセスパターン:**
- 書き込み: 低頻度（月次アーカイブジョブ）
- 読み取り: 極めて低頻度（監査・調査時）

---

## フォルダ構造設計

### 1. data-lake-raw（Bronze）

```
s3://data-lake-raw/
├── sources/                          # データソース別
│   ├── api_jsonplaceholder/          # 外部API
│   │   ├── posts/                    # リソース別
│   │   │   ├── year=2025/
│   │   │   │   ├── month=01/
│   │   │   │   │   ├── day=15/
│   │   │   │   │   │   ├── posts_20250115_120000.parquet
│   │   │   │   │   │   ├── posts_20250115_180000.parquet
│   │   │   │   │   │   └── _dlt_metadata.jsonl
│   │   │   │   │   └── day=16/
│   │   │   │   └── month=02/
│   │   │   └── year=2024/
│   │   ├── users/
│   │   │   └── year=2025/...
│   │   └── comments/
│   │       └── year=2025/...
│   │
│   ├── api_custom_crm/               # カスタムCRM API
│   │   ├── customers/
│   │   ├── orders/
│   │   └── invoices/
│   │
│   ├── events_web/                   # Webイベント
│   │   ├── pageviews/
│   │   │   └── year=2025/month=01/day=15/hour=12/
│   │   │       ├── pageviews_000001.parquet
│   │   │       ├── pageviews_000002.parquet
│   │   │       └── ...
│   │   ├── clicks/
│   │   └── conversions/
│   │
│   ├── database_postgres/            # 外部DBからのCDC
│   │   ├── public_users/
│   │   ├── public_orders/
│   │   └── public_products/
│   │
│   └── files_upload/                 # ファイルアップロード
│       ├── csv/
│       ├── xlsx/
│       └── json/
│
├── _pipeline_state/                  # dlt状態管理
│   ├── api_jsonplaceholder_state.json
│   ├── api_custom_crm_state.json
│   └── events_web_state.json
│
└── _metadata/                        # メタデータ
    ├── schemas/                      # スキーマ定義
    │   ├── api_jsonplaceholder.json
    │   └── api_custom_crm.json
    └── lineage/                      # データリネージュ
        └── 2025-01-15.json
```

**命名規則:**
- ソース名: `{source_type}_{source_name}`
- ファイル名: `{table}_{YYYYMMDD}_{HHMMSS}.parquet`
- パーティション: Hive形式 `year=YYYY/month=MM/day=DD/hour=HH`

---

### 2. data-lake-processed（Silver）

```
s3://data-lake-processed/
├── staging/                          # dbt Stagingレイヤー
│   ├── stg_api__posts/
│   │   └── year=2025/month=01/
│   │       └── stg_api__posts.parquet
│   ├── stg_api__users/
│   ├── stg_api__comments/
│   ├── stg_events__pageviews/
│   ├── stg_events__clicks/
│   └── stg_crm__customers/
│
├── intermediate/                     # dbt Intermediateレイヤー
│   ├── int_user_activity/
│   │   └── year=2025/month=01/
│   │       └── int_user_activity.parquet
│   ├── int_order_enriched/
│   ├── int_session_aggregated/
│   └── int_product_metrics/
│
└── _dbt/                            # dbt管理ファイル
    ├── manifest.json                # dbtマニフェスト
    ├── run_results.json             # 実行結果
    └── catalog.json                 # データカタログ
```

**命名規則:**
- Staging: `stg_{source}__{table}`
- Intermediate: `int_{business_domain}_{description}`

---

### 3. data-lake-curated（Gold）

```
s3://data-lake-curated/
├── analytics/                        # 分析用Marts
│   ├── iceberg/                      # Apache Icebergテーブル
│   │   ├── fct_daily_metrics/
│   │   │   ├── metadata/
│   │   │   │   ├── v1.metadata.json
│   │   │   │   ├── v2.metadata.json
│   │   │   │   └── version-hint.text
│   │   │   └── data/
│   │   │       ├── year=2025/month=01/
│   │   │       │   └── data_00001.parquet
│   │   │       └── year=2024/month=12/
│   │   │
│   │   ├── fct_user_events/
│   │   │   ├── metadata/
│   │   │   └── data/
│   │   │
│   │   ├── dim_users/               # ディメンションテーブル
│   │   ├── dim_products/
│   │   ├── dim_dates/
│   │   │
│   │   └── agg_monthly_summary/     # 集計テーブル
│   │
│   └── parquet/                      # 通常のParquetテーブル
│       ├── rpt_weekly_dashboard/
│       ├── rpt_user_cohorts/
│       └── rpt_revenue_summary/
│
├── ml/                               # 機械学習用
│   ├── features/
│   │   ├── user_features_v1/
│   │   ├── product_features_v1/
│   │   └── session_features_v1/
│   ├── predictions/
│   │   ├── churn_predictions/
│   │   └── ltv_predictions/
│   └── models/
│       └── model_artifacts/
│
├── exports/                          # 外部システムエクスポート用
│   ├── bi_tools/
│   │   ├── tableau/
│   │   └── looker/
│   ├── crm_sync/
│   └── data_warehouse/
│
└── _catalog/                         # R2 Data Catalog
    ├── catalog.db                    # Icebergカタログ
    └── table_registry.json
```

**命名規則:**
- Fact: `fct_{business_event}_{grain}`
- Dimension: `dim_{entity}`
- Aggregate: `agg_{time_grain}_{metric}`
- Report: `rpt_{report_name}`

---

### 4. data-lake-archive（Archive）

```
s3://data-lake-archive/
├── raw/                              # Rawデータアーカイブ
│   ├── 2024/
│   │   ├── Q1/
│   │   │   ├── api_jsonplaceholder.tar.zst
│   │   │   └── events_web.tar.zst
│   │   ├── Q2/
│   │   ├── Q3/
│   │   └── Q4/
│   └── 2025/
│       └── Q1/
│
├── processed/                        # Processedデータアーカイブ
│   └── 2024/
│       └── annual_snapshot.parquet.zst
│
├── curated/                          # Curatedデータアーカイブ
│   └── 2024/
│       ├── annual_reports.parquet.zst
│       └── ml_features_2024.parquet.zst
│
└── _metadata/
    ├── archive_manifest.json         # アーカイブマニフェスト
    └── retention_policy.json         # 保持ポリシー
```

**命名規則:**
- アーカイブファイル: `{source}_{YYYY}_{period}.tar.zst`
- 圧縮: `.zst` (Zstandard) または `.gz` (Gzip)

---

## データライフサイクル

```
┌─────────────────────────────────────────────────────────────┐
│                    データライフサイクル                        │
└─────────────────────────────────────────────────────────────┘

[外部API/イベント]
        ↓
   dlt Pipeline
        ↓
┌─────────────────┐
│ data-lake-raw   │ ← 生データ保存
│ (90日保持)      │
└─────────────────┘
        ↓
   dbt Staging
        ↓
┌─────────────────┐
│ data-lake-      │ ← 変換後データ
│ processed       │
│ (30日保持)      │
└─────────────────┘
        ↓
   dbt Marts
        ↓
┌─────────────────┐
│ data-lake-      │ ← 分析用データ
│ curated         │
│ (1年保持)       │
└─────────────────┘
        ↓
   Archive Job
        ↓
┌─────────────────┐
│ data-lake-      │ ← 長期保存
│ archive         │
│ (無期限)        │
└─────────────────┘
```

### 自動ライフサイクル管理

```javascript
// workers/lifecycle/archive_old_data.js
// Cron Trigger: 月次実行

export default {
  async scheduled(event, env) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // 1. Processed (30日経過) → 削除
    await deleteOldObjects(env.PROCESSED_BUCKET, thirtyDaysAgo);

    // 2. Raw (90日経過) → Archive
    await archiveOldObjects(env.RAW_BUCKET, env.ARCHIVE_BUCKET, ninetyDaysAgo);

    // 3. Curated (1年経過) → Archive
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    await archiveOldObjects(env.CURATED_BUCKET, env.ARCHIVE_BUCKET, oneYearAgo);
  }
}
```

---

## 命名規則

### バケット命名規則

```
{organization}-{project}-{environment}-{layer}

例:
- mycompany-dataplatform-prod-raw
- mycompany-dataplatform-prod-processed
- mycompany-dataplatform-prod-curated
- mycompany-dataplatform-prod-archive

開発環境:
- mycompany-dataplatform-dev-raw
- mycompany-dataplatform-staging-raw
```

### フォルダ命名規則

| レベル | 形式 | 例 |
|--------|------|-----|
| ソース | `{source_type}_{source_name}` | `api_jsonplaceholder`, `events_web` |
| テーブル | `{table_name}` | `posts`, `users`, `pageviews` |
| パーティション | `{key}={value}` | `year=2025`, `month=01`, `day=15` |
| ファイル | `{table}_{timestamp}.{ext}` | `posts_20250115_120000.parquet` |

### dbtモデル命名規則

| レイヤー | プレフィックス | 例 |
|----------|----------------|-----|
| Staging | `stg_` | `stg_api__posts` |
| Intermediate | `int_` | `int_user_activity` |
| Fact | `fct_` | `fct_daily_metrics` |
| Dimension | `dim_` | `dim_users` |
| Aggregate | `agg_` | `agg_monthly_summary` |
| Report | `rpt_` | `rpt_weekly_dashboard` |

---

## アクセス制御

### バケット別権限設定

```toml
# wrangler.toml

# dlt Worker - Raw書き込み専用
[[workers]]
name = "dlt-pipeline"
[[workers.r2_buckets]]
binding = "RAW_BUCKET"
bucket_name = "data-lake-raw"
# 権限: PutObject, ListBucket

# dbt Worker - Raw読み取り、Processed/Curated書き込み
[[workers]]
name = "dbt-transformer"
[[workers.r2_buckets]]
binding = "RAW_BUCKET"
bucket_name = "data-lake-raw"
# 権限: GetObject, ListBucket

[[workers.r2_buckets]]
binding = "PROCESSED_BUCKET"
bucket_name = "data-lake-processed"
# 権限: PutObject, GetObject, ListBucket

[[workers.r2_buckets]]
binding = "CURATED_BUCKET"
bucket_name = "data-lake-curated"
# 権限: PutObject, GetObject, ListBucket

# Analytics API - Curated読み取り専用
[[workers]]
name = "analytics-api"
[[workers.r2_buckets]]
binding = "CURATED_BUCKET"
bucket_name = "data-lake-curated"
# 権限: GetObject, ListBucket
```

### R2 API Tokenスコープ

```bash
# dlt用トークン（Raw書き込み）
# スコープ: Object Read & Write (data-lake-raw のみ)

# dbt用トークン（全体アクセス）
# スコープ: Object Read & Write (data-lake-*)

# 分析用トークン（Curated読み取り）
# スコープ: Object Read (data-lake-curated のみ)
```

---

## コスト最適化

### 1. ストレージクラスの活用

R2は単一ストレージクラスですが、バケット分離でコスト可視化:

```javascript
// 月次コストレポート
const costs = {
  raw: await calculateBucketCost('data-lake-raw'),
  processed: await calculateBucketCost('data-lake-processed'),
  curated: await calculateBucketCost('data-lake-curated'),
  archive: await calculateBucketCost('data-lake-archive')
};
```

### 2. 圧縮戦略

| レイヤー | 圧縮形式 | 圧縮率 | 理由 |
|---------|---------|--------|------|
| Raw | Snappy | 2-3x | 高速書き込み優先 |
| Processed | ZSTD | 3-5x | バランス型 |
| Curated | ZSTD | 3-5x | 読み取り性能重視 |
| Archive | ZSTD (高圧縮) | 5-10x | ストレージコスト削減 |

### 3. パーティション最適化

```python
# dltパイプライン - 日次パーティション
pipeline = dlt.pipeline(
    destination=filesystem(
        bucket_url="s3://data-lake-raw",
        layout="{table_name}/year={year}/month={month}/day={day}/{file_id}.{ext}"
    )
)

# dbt - 月次パーティション（集計済みデータ）
# models/marts/fct_daily_metrics.sql
{{ config(
    materialized='incremental',
    partition_by=['year', 'month'],
    file_format='iceberg'
) }}
```

### 4. データ削減

```sql
-- dbt incremental: 重複排除
{{ config(materialized='incremental', unique_key='id') }}

SELECT DISTINCT
  id,
  user_id,
  event_timestamp,
  -- 不要なカラムは除外
FROM {{ source('raw', 'events') }}
{% if is_incremental() %}
WHERE event_timestamp > (SELECT MAX(event_timestamp) FROM {{ this }})
{% endif %}
```

---

## 運用ガイド

### バケット作成

```bash
# 本番環境
wrangler r2 bucket create data-lake-raw
wrangler r2 bucket create data-lake-processed
wrangler r2 bucket create data-lake-curated
wrangler r2 bucket create data-lake-archive

# 開発環境
wrangler r2 bucket create data-lake-dev-raw
wrangler r2 bucket create data-lake-dev-processed
wrangler r2 bucket create data-lake-dev-curated
```

### データ確認

```bash
# バケット一覧
wrangler r2 bucket list

# オブジェクト一覧（特定プレフィックス）
wrangler r2 object list data-lake-raw --prefix "sources/api_jsonplaceholder/posts/year=2025"

# オブジェクトダウンロード
wrangler r2 object get data-lake-raw/sources/api_jsonplaceholder/posts/year=2025/month=01/day=15/posts_20250115_120000.parquet --file posts.parquet
```

### モニタリング

```javascript
// workers/monitoring/bucket_metrics.js
export default {
  async scheduled(event, env) {
    const buckets = ['raw', 'processed', 'curated', 'archive'];

    for (const bucket of buckets) {
      const stats = await getBucketStats(env[`${bucket.toUpperCase()}_BUCKET`]);

      await env.ANALYTICS.writeDataPoint({
        blobs: ['bucket_metrics', bucket],
        doubles: [stats.objectCount, stats.totalSize],
        indexes: ['bucket_name']
      });

      // Slack通知（閾値超過時）
      if (stats.totalSize > THRESHOLD) {
        await notifySlack(`⚠️ Bucket ${bucket} size: ${stats.totalSize} GB`);
      }
    }
  }
}
```

### バックアップ

```bash
# 重要データのクロスリージョンレプリケーション
# R2 Event Notificationsを使用してバックアップトリガー

# wrangler.toml
[[r2_buckets]]
bucket_name = "data-lake-curated"
event_notifications = [
  {
    queue = "backup-queue",
    events = ["object-create"]
  }
]
```

---

## まとめ

### 推奨構成

| バケット | 用途 | サイズ想定 | 保持期間 | 主要アクセス |
|---------|------|-----------|----------|-------------|
| **data-lake-raw** | 生データ | 100-500 GB | 90日 | dlt, dbt |
| **data-lake-processed** | 中間データ | 50-200 GB | 30日 | dbt |
| **data-lake-curated** | 分析データ | 200-1 TB | 1年 | Evidence, R2 SQL, API |
| **data-lake-archive** | アーカイブ | 1-10 TB | 無期限 | アドホック |

### 次のステップ

1. **バケット作成**: 4つのバケットを作成
2. **dlt更新**: フォルダ構造に合わせてdltパイプライン更新
3. **dbt設定**: プロジェクト構造をバケット構成に合わせる
4. **ライフサイクル自動化**: Workersでアーカイブジョブ実装
5. **モニタリング**: Analytics Engineでメトリクス収集

---

## 参考リンク

- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [R2 Data Catalog (Iceberg)](https://developers.cloudflare.com/r2/data-catalog/)
- [R2 Event Notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/)
- [dlt Filesystem Destination](https://dlthub.com/docs/dlt-ecosystem/destinations/filesystem)
- [dbt Best Practices](https://docs.getdbt.com/guides/best-practices)

---

最終更新: 2025年12月25日
