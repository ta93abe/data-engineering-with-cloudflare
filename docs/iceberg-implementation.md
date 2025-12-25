# Apache Iceberg on Cloudflare 実装ガイド

本ドキュメントでは、Cloudflare Workers上でApache Icebergテーブルを使用したデータ基盤の構築方法を解説します。

## 目次

- [概要](#概要)
- [実装アプローチ](#実装アプローチ)
- [セットアップ](#セットアップ)
- [実装パターン](#実装パターン)
- [運用ガイド](#運用ガイド)
- [トラブルシューティング](#トラブルシューティング)

---

## 概要

### Apache Icebergとは

Apache Icebergは、大規模分析用のオープンテーブルフォーマットで、以下の特徴があります:

- **ACIDトランザクション**: データの一貫性保証
- **タイムトラベル**: 過去のデータバージョンへのアクセス
- **スキーマ進化**: 後方互換性のあるスキーマ変更
- **パーティション進化**: パーティション構造の変更が可能
- **高速クエリ**: メタデータベースのクエリ最適化

### Cloudflare R2 Data Catalog

Cloudflare R2 Data Catalogは、Apache Icebergテーブルのマネージドカタログサービスです:

- R2上でIcebergテーブルを管理
- REST Catalog API対応
- R2 SQLから直接クエリ可能
- PyIcebergと完全互換

---

## 実装アプローチ

Icebergベースのデータパイプラインには3つのアプローチがあります:

### アプローチ1: dlt → Parquet → Iceberg（推奨）

```
[外部API]
    ↓
[dlt Worker] → [R2 Bronze: Parquet]
    ↓
[Iceberg Converter Worker] → [R2 Gold: Iceberg]
    ↓
[R2 SQL / Evidence / DuckDB]
```

**メリット:**
- dltの機能をフル活用（スキーマ推論、状態管理）
- Parquetでバックアップを保持
- 段階的な処理で障害分離

**デメリット:**
- 2ステップ処理（遅延がわずかに増加）

**推奨ケース:**
- バッチETLパイプライン
- 複雑なデータソース
- スキーマ変更が頻繁

---

### アプローチ2: dlt + PyIceberg統合

```
[外部API]
    ↓
[dlt + PyIceberg Worker]
    ├→ [R2 Bronze: Parquet]（バックアップ）
    └→ [R2 Gold: Iceberg]（メイン）
```

**メリット:**
- 1ステップで完結
- dltとIcebergの両方のメリット
- リアルタイム性が高い

**デメリット:**
- 実装が複雑
- Workers CPU時間制限に注意

**推奨ケース:**
- 頻繁な更新が必要
- リアルタイム性重視
- スキーマが安定している

---

### アプローチ3: Cloudflare Pipelines

```
[イベント]
    ↓
[Cloudflare Pipelines]（SQL変換）
    ↓
[R2 Gold: Iceberg]
```

**メリット:**
- ストリーミング処理
- SQL変換がネイティブ
- 最もシンプル

**デメリット:**
- dltの機能が使えない
- イベント駆動のみ

**推奨ケース:**
- リアルタイムイベント処理
- ストリーミングパイプライン
- シンプルな変換のみ

---

## セットアップ

### 1. R2バケットとData Catalogの設定

```bash
# Curatedバケット作成
wrangler r2 bucket create data-lake-curated

# R2 Data Catalogを有効化（Cloudflare Dashboard）
# R2 > Buckets > data-lake-curated > Data Catalog > Enable
```

### 2. API Token作成

```bash
# Cloudflare Dashboard > My Profile > API Tokens > Create Token
# Permission: R2 Read/Write

# Secretsに設定
wrangler secret put CLOUDFLARE_API_TOKEN --name iceberg-converter
```

### 3. wrangler.toml設定

```toml
# Iceberg Converter Worker
[[workers]]
name = "iceberg-converter"
main = "workers/transformation/iceberg_converter.py"
compatibility_date = "2024-12-01"

[workers.python]
requirements = "workers/transformation/requirements.txt"

[workers.vars]
R2_ACCOUNT_ID = "your-account-id"
R2_BUCKET_CURATED = "data-lake-curated"

# dlt + Iceberg統合Worker
[[workers]]
name = "dlt-iceberg-pipeline"
main = "workers/ingestion/dlt_iceberg_pipeline.py"
compatibility_date = "2024-12-01"

[workers.python]
requirements = "workers/ingestion/requirements-iceberg.txt"

[workers.vars]
R2_ACCOUNT_ID = "your-account-id"
R2_BUCKET_RAW = "data-lake-raw"
R2_BUCKET_CURATED = "data-lake-curated"
```

---

## 実装パターン

### パターン1: PyIcebergでテーブル作成

```python
from pyiceberg.catalog import load_catalog
from pyiceberg.schema import Schema
from pyiceberg.types import NestedField, StringType, IntegerType, TimestampType
from pyiceberg.partitioning import PartitionSpec, PartitionField
from pyiceberg.transforms import DayTransform

# R2 Data Catalog接続
catalog = load_catalog(
    "r2_catalog",
    **{
        "type": "rest",
        "uri": f"https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{bucket_name}/catalog",
        "credential": api_token,
        "warehouse": f"s3://{bucket_name}"
    }
)

# ネームスペース作成
catalog.create_namespace(("analytics", "events"))

# スキーマ定義
schema = Schema(
    NestedField(1, "event_id", StringType(), required=True),
    NestedField(2, "user_id", StringType(), required=True),
    NestedField(3, "event_type", StringType(), required=True),
    NestedField(4, "event_timestamp", TimestampType(), required=True),
    NestedField(5, "properties", StringType(), required=False)
)

# パーティション仕様
partition_spec = PartitionSpec(
    PartitionField(
        source_id=4,  # event_timestamp
        field_id=1000,
        transform=DayTransform(),
        name="event_date"
    )
)

# テーブル作成
table = catalog.create_table(
    identifier="analytics.events.pageviews",
    schema=schema,
    location="s3://data-lake-curated/analytics/events/pageviews",
    partition_spec=partition_spec
)
```

### パターン2: Parquet → Iceberg変換

```python
import pyarrow as pa
import pyarrow.parquet as pq
from pyiceberg.table import Table

# ParquetファイルをR2から読み取り
parquet_path = "s3://data-lake-raw/sources/api_jsonplaceholder/posts/year=2025/month=01/day=15/"

# PyArrow Tableとして読み込み
arrow_table = pq.read_table(parquet_path)

# Icebergテーブルに追加
iceberg_table: Table = catalog.load_table("analytics.api_jsonplaceholder.posts")
iceberg_table.append(arrow_table)

# またはoverwrite
iceberg_table.overwrite(arrow_table)
```

### パターン3: dlt + Iceberg統合

workers/ingestion/dlt_iceberg_pipeline.py を使用:

```bash
# デプロイ
wrangler deploy workers/ingestion/dlt_iceberg_pipeline.py --name dlt-iceberg-pipeline

# 実行
curl "https://dlt-iceberg-pipeline.your-subdomain.workers.dev?source=posts"
```

レスポンス例:
```json
{
  "success": true,
  "pipeline_name": "dlt_iceberg_pipeline",
  "raw_layer": {
    "bucket": "data-lake-raw",
    "path": "s3://data-lake-raw/sources/api_jsonplaceholder/posts/year=2025/month=01/day=15/",
    "format": "parquet"
  },
  "curated_layer": {
    "bucket": "data-lake-curated",
    "table": "analytics.api_jsonplaceholder.posts",
    "format": "iceberg",
    "location": "s3://data-lake-curated/analytics/api_jsonplaceholder/posts"
  },
  "message": "Data loaded to Bronze (Parquet) and Gold (Iceberg) layers"
}
```

---

## R2 Icebergフォルダ構造

```
s3://data-lake-curated/
├── analytics/                        # Icebergテーブル
│   ├── api_jsonplaceholder/
│   │   ├── posts/
│   │   │   ├── metadata/             # Icebergメタデータ
│   │   │   │   ├── v1.metadata.json
│   │   │   │   ├── v2.metadata.json
│   │   │   │   ├── snap-*.avro
│   │   │   │   └── version-hint.text
│   │   │   └── data/                 # データファイル
│   │   │       ├── ingestion_date=2025-01-15/
│   │   │       │   ├── 00000-0-data.parquet
│   │   │       │   └── 00001-1-data.parquet
│   │   │       └── ingestion_date=2025-01-16/
│   │   └── users/
│   │       ├── metadata/
│   │       └── data/
│   │
│   └── events/
│       ├── pageviews/
│       │   ├── metadata/
│       │   └── data/
│       └── clicks/
│
└── _catalog/                         # R2 Data Catalog DB
    └── catalog.db
```

---

## R2 SQLでのクエリ

Icebergテーブルは、R2 SQLから直接クエリ可能です:

```sql
-- R2 SQL (Cloudflare Dashboard)

-- Icebergテーブル一覧
SHOW TABLES FROM analytics.api_jsonplaceholder;

-- データクエリ
SELECT
  event_date,
  COUNT(*) as post_count
FROM analytics.api_jsonplaceholder.posts
WHERE event_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY event_date
ORDER BY event_date DESC;

-- タイムトラベルクエリ（過去のスナップショット）
SELECT * FROM analytics.api_jsonplaceholder.posts
FOR SYSTEM_VERSION AS OF '2025-01-15 12:00:00';
```

---

## DuckDBでのクエリ

DuckDBからもIcebergテーブルをクエリできます:

```sql
-- DuckDB
INSTALL iceberg;
LOAD iceberg;

-- S3設定（R2）
SET s3_endpoint='<account-id>.r2.cloudflarestorage.com';
SET s3_access_key_id='your-access-key';
SET s3_secret_access_key='your-secret-key';

-- Icebergテーブルをスキャン
SELECT * FROM iceberg_scan(
  's3://data-lake-curated/analytics/api_jsonplaceholder/posts/metadata/v2.metadata.json'
);

-- またはメタデータから自動検出
SELECT * FROM iceberg_scan(
  's3://data-lake-curated/analytics/api_jsonplaceholder/posts'
);
```

---

## 運用ガイド

### スキーマ進化

Icebergはスキーマ進化をサポート:

```python
from pyiceberg.table import Table
from pyiceberg.schema import Schema
from pyiceberg.types import NestedField, StringType

table: Table = catalog.load_table("analytics.api_jsonplaceholder.posts")

# 新しいカラムを追加
table.update_schema().add_column(
    "new_field",
    StringType(),
    doc="新しいフィールド"
).commit()

# カラム名変更
table.update_schema().rename_column(
    "old_name",
    "new_name"
).commit()
```

### パーティション進化

```python
# パーティション仕様変更
table.update_spec().add_field(
    "event_type",
    IdentityTransform(),
    "event_type_partition"
).commit()
```

### スナップショット管理

```python
# スナップショット一覧
for snapshot in table.snapshots():
    print(f"Snapshot {snapshot.snapshot_id}: {snapshot.summary}")

# 古いスナップショット削除（データ削減）
table.expire_snapshots(
    older_than=datetime.now() - timedelta(days=30)
)
```

### メタデータ最適化

```python
# メタデータファイルの圧縮
table.rewrite_manifests()

# データファイルの最適化（小ファイル統合）
table.rewrite_data_files(
    target_file_size_bytes=512 * 1024 * 1024  # 512MB
)
```

---

## トラブルシューティング

### 問題1: Catalogへの接続エラー

**エラー:** `Failed to connect to R2 Data Catalog`

**解決策:**
1. API Tokenが正しいか確認
2. バケットでData Catalogが有効化されているか確認
3. URIのアカウントIDとバケット名が正しいか確認

```bash
# API Token確認
wrangler secret list --name iceberg-converter

# Data Catalog有効化確認（Dashboard）
# R2 > Buckets > data-lake-curated > Data Catalog
```

### 問題2: スキーマ不一致エラー

**エラー:** `Schema mismatch when appending data`

**解決策:**
- スキーマ進化機能を使用
- または `schema_evolution="auto"` を設定

```python
# スキーマ自動進化
table.append(arrow_table, schema_evolution="auto")
```

### 問題3: Workers CPU時間超過

**エラー:** `CPU time limit exceeded`

**解決策:**
- データを小分けにして処理
- Workflowsを使った長時間実行パイプライン
- またはGitHub Actionsでバッチ処理

---

## まとめ

### 推奨構成

| ユースケース | 推奨アプローチ | 理由 |
|------------|--------------|------|
| バッチETL | dlt → Parquet → Iceberg | 安定性・柔軟性 |
| リアルタイム処理 | dlt + PyIceberg統合 | 低レイテンシ |
| ストリーミング | Cloudflare Pipelines | ネイティブサポート |
| 分析クエリ | R2 SQL / DuckDB | 直接クエリ可能 |

### 次のステップ

1. **Iceberg Workerデプロイ**: 変換パイプライン稼働
2. **dbt統合**: Icebergテーブルでのdbt変換
3. **Evidence統合**: Icebergテーブルの可視化
4. **モニタリング**: スナップショット、メタデータサイズ監視

---

## 参考リンク

- [Apache Iceberg公式](https://iceberg.apache.org/)
- [PyIcebergドキュメント](https://py.iceberg.apache.org/)
- [Cloudflare R2 Data Catalog](https://developers.cloudflare.com/r2/data-catalog/)
- [R2 SQL](https://developers.cloudflare.com/r2/sql/)
- [DuckDB Icebergサポート](https://duckdb.org/docs/extensions/iceberg.html)

---

最終更新: 2025年12月25日
