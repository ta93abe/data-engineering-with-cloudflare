# dbt SQLモデル実装ガイド

DuckDBとCloudflare R2を使用したdbtプロジェクトの実装です。

## 概要

- **dbtバージョン**: dbt-duckdb
- **データベース**: DuckDB（インメモリ/ローカル）
- **ストレージ**: Cloudflare R2（S3互換）
- **データ品質**: Elementary、dbt_expectations

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│                 Cloudflare R2                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │  data-lake-raw (Bronze Layer)                   │   │
│  │  └── sources/api_jsonplaceholder/               │   │
│  │      ├── posts/*.parquet                        │   │
│  │      └── users/*.parquet                        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           │ DuckDB + httpfs
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    dbt Project                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Staging Layer (Silver)                         │   │
│  │  └── VIEW: stg_api_posts, stg_api_users         │   │
│  │      - 型変換                                   │   │
│  │      - 標準化                                   │   │
│  │      - クレンジング                             │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Marts Layer (Gold)                             │   │
│  │  └── TABLE: fct_user_posts                      │   │
│  │      - 集計                                     │   │
│  │      - ビジネスロジック適用                     │   │
│  │      - 分析最適化                               │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           │ Elementary
                           ▼
              ┌────────────────────────┐
              │   Data Quality Reports │
              └────────────────────────┘
```

## 実装コード

### ディレクトリ構造

```
dbt/
├── dbt_project.yml          # プロジェクト設定
├── profiles.yml             # 接続プロファイル
├── packages.yml             # 依存パッケージ
├── models/
│   ├── staging/             # Stagingモデル（Silver Layer）
│   │   ├── schema.yml       # スキーマ定義・テスト
│   │   ├── stg_api_posts.sql
│   │   └── stg_api_users.sql
│   └── marts/               # Martモデル（Gold Layer）
│       ├── schema.yml
│       └── fct_user_posts.sql
├── macros/                  # カスタムマクロ（要作成）
├── seeds/                   # シードデータ（要作成）
├── snapshots/               # スナップショット（要作成）
└── tests/                   # カスタムテスト（要作成）
```

---

### dbt_project.yml

```yaml
name: 'cloudflare_data_platform'
version: '1.0.0'
config-version: 2

# プロジェクト設定
profile: 'cloudflare_data_platform'

# モデルパス設定
model-paths: ["models"]
analysis-paths: ["analyses"]
test-paths: ["tests"]
seed-paths: ["seeds"]
macro-paths: ["macros"]
snapshot-paths: ["snapshots"]

clean-targets:
  - "target"
  - "dbt_packages"
  - "logs"

# モデル設定
models:
  cloudflare_data_platform:
    # Staging層: Bronze -> Silver変換
    staging:
      +materialized: view
      +schema: staging
      +tags: ["staging"]
      +elementary_enabled: true
      +elementary_schema_changes: true

    # Marts層: Silver -> Gold変換
    marts:
      +materialized: table
      +schema: marts
      +tags: ["marts"]
      +elementary_enabled: true
      +elementary_schema_changes: true

# Elementary設定
vars:
  # Elementary用の設定
  elementary:
    # タイムゾーン
    timezone: 'UTC'
    # 異常検知の感度（1-5、5が最も厳しい）
    anomaly_sensitivity: 3
    # データ保持期間（日数）
    days_back: 30

# テスト設定
tests:
  +store_failures: true
  +schema: test_results

# スナップショット設定
snapshots:
  +target_schema: snapshots
  +strategy: timestamp
  +updated_at: updated_at

# ドキュメント設定
on-run-start:
  - "{{ log('Starting dbt run for Cloudflare Data Platform', info=True) }}"

on-run-end:
  - "{{ log('Completed dbt run for Cloudflare Data Platform', info=True) }}"
```

### profiles.yml

```yaml
# dbt profiles.yml
# Cloudflare R2 + DuckDBを使用したプロファイル設定

cloudflare_data_platform:
  target: dev
  outputs:
    # 開発環境: ローカルDuckDB
    dev:
      type: duckdb
      path: 'dev.duckdb'
      extensions:
        - httpfs
        - parquet
      settings:
        # R2接続設定（環境変数から取得）
        s3_endpoint: "{{ env_var('R2_ENDPOINT', 'ACCOUNT_ID.r2.cloudflarestorage.com') }}"
        s3_access_key_id: "{{ env_var('R2_ACCESS_KEY_ID') }}"
        s3_secret_access_key: "{{ env_var('R2_SECRET_ACCESS_KEY') }}"
        s3_region: 'auto'
        threads: 4

    # 本番環境: インメモリDuckDB + R2
    prod:
      type: duckdb
      path: ':memory:'
      extensions:
        - httpfs
        - parquet
        - iceberg
      settings:
        s3_endpoint: "{{ env_var('R2_ENDPOINT') }}"
        s3_access_key_id: "{{ env_var('R2_ACCESS_KEY_ID') }}"
        s3_secret_access_key: "{{ env_var('R2_SECRET_ACCESS_KEY') }}"
        s3_region: 'auto'
        threads: 8
        # 本番用の最適化設定
        memory_limit: '4GB'
        temp_directory: '/tmp/duckdb'

    # CI/CD環境
    ci:
      type: duckdb
      path: ':memory:'
      extensions:
        - httpfs
        - parquet
      settings:
        s3_endpoint: "{{ env_var('R2_ENDPOINT') }}"
        s3_access_key_id: "{{ env_var('R2_ACCESS_KEY_ID') }}"
        s3_secret_access_key: "{{ env_var('R2_SECRET_ACCESS_KEY') }}"
        s3_region: 'auto'
        threads: 2

# Elementary用の設定
# ElementaryはdbtプロジェクトのメタデータをDuckDBに保存します
elementary:
  # Elementaryメタデータ用のデータベース
  database_path: 'elementary.duckdb'
```

### packages.yml

```yaml
packages:
  # Elementary - データ品質監視とオブザーバビリティ
  - package: elementary-data/elementary
    version: 0.15.1

  # dbt_utils - 便利なマクロ集
  - package: dbt-labs/dbt_utils
    version: 1.1.1

  # dbt_expectations - データ品質テスト拡張
  - package: calogica/dbt_expectations
    version: 0.10.1
```

---

## SQLモデル

### Stagingモデル: stg_api_posts.sql

```sql
{{
  config(
    materialized='view',
    tags=['staging', 'api_data']
  )
}}

/*
  Staging model for JSONPlaceholder API posts data

  This model reads raw data from R2 Bronze layer and applies
  basic transformations and standardization.
*/

WITH source AS (
  SELECT
    *
  FROM read_parquet('s3://{{ env_var("R2_BUCKET_NAME", "data-lake-raw") }}/sources/api_jsonplaceholder/posts/**/*.parquet')
),

cleaned AS (
  SELECT
    -- Primary key
    CAST(id AS INTEGER) AS post_id,

    -- Foreign keys
    CAST(userId AS INTEGER) AS user_id,

    -- Attributes
    CAST(title AS VARCHAR) AS title,
    CAST(body AS VARCHAR) AS body,

    -- Metadata
    CURRENT_TIMESTAMP AS loaded_at

  FROM source
)

SELECT * FROM cleaned
```

### Stagingモデル: stg_api_users.sql

```sql
{{
  config(
    materialized='view',
    tags=['staging', 'api_data']
  )
}}

/*
  Staging model for JSONPlaceholder API users data

  This model reads raw user data from R2 Bronze layer and
  flattens nested JSON structures.
*/

WITH source AS (
  SELECT
    *
  FROM read_parquet('s3://{{ env_var("R2_BUCKET_NAME", "data-lake-raw") }}/sources/api_jsonplaceholder/users/**/*.parquet')
),

cleaned AS (
  SELECT
    -- Primary key
    CAST(id AS INTEGER) AS user_id,

    -- User attributes
    CAST(name AS VARCHAR) AS user_name,
    CAST(username AS VARCHAR) AS username,
    CAST(email AS VARCHAR) AS email,
    CAST(phone AS VARCHAR) AS phone,
    CAST(website AS VARCHAR) AS website,

    -- Address (nested JSON)
    -- Note: DuckDBはJSON関数をサポート。実際のスキーマに応じて調整が必要
    CAST(address AS JSON) AS address_json,

    -- Company (nested JSON)
    CAST(company AS JSON) AS company_json,

    -- Metadata
    CURRENT_TIMESTAMP AS loaded_at

  FROM source
)

SELECT * FROM cleaned
```

### Martsモデル: fct_user_posts.sql

```sql
{{
  config(
    materialized='table',
    tags=['marts', 'analytics']
  )
}}

/*
  Fact table: User Posts

  This mart model combines users and their posts for analytics.
  Gold layer data optimized for reporting and dashboards.
*/

WITH users AS (
  SELECT * FROM {{ ref('stg_api_users') }}
),

posts AS (
  SELECT * FROM {{ ref('stg_api_posts') }}
),

user_post_metrics AS (
  SELECT
    u.user_id,
    u.user_name,
    u.username,
    u.email,

    -- Post metrics
    COUNT(p.post_id) AS total_posts,
    AVG(LENGTH(p.body)) AS avg_post_length,
    MAX(LENGTH(p.body)) AS max_post_length,
    MIN(LENGTH(p.body)) AS min_post_length,

    -- Metadata
    MAX(p.loaded_at) AS last_post_loaded_at,
    CURRENT_TIMESTAMP AS calculated_at

  FROM users u
  LEFT JOIN posts p ON u.user_id = p.user_id
  GROUP BY 1, 2, 3, 4
)

SELECT * FROM user_post_metrics
```

---

## スキーマ定義・テスト

### models/staging/schema.yml

```yaml
version: 2

models:
  - name: stg_api_posts
    description: "Staging layer for JSONPlaceholder API posts data"
    config:
      elementary_enabled: true
      elementary_schema_changes: true

    columns:
      - name: post_id
        description: "Unique identifier for the post"
        tests:
          - unique
          - not_null
          # Elementary: ボリューム異常検知
          - elementary.volume_anomalies:
              timestamp_column: loaded_at
              sensitivity: 3
              where_expression: "loaded_at > CURRENT_DATE - INTERVAL '30 days'"

      - name: user_id
        description: "Foreign key to users table"
        tests:
          - not_null
          # Elementary: ディメンション異常検知（user_id分布の変化を検知）
          - elementary.dimension_anomalies:
              dimensions:
                - user_id
              timestamp_column: loaded_at
              where_expression: "loaded_at > CURRENT_DATE - INTERVAL '30 days'"

      - name: title
        description: "Post title"
        tests:
          - not_null
          # 空文字列チェック
          - dbt_utils.not_empty_string
          # Elementary: カラム値の異常検知（文字列長の変化など）
          - elementary.column_anomalies:
              column_anomalies:
                - length(title)
              timestamp_column: loaded_at

      - name: body
        description: "Post body content"
        tests:
          - not_null
          - dbt_utils.not_empty_string

      - name: loaded_at
        description: "Timestamp when data was loaded"
        tests:
          - not_null

  - name: stg_api_users
    description: "Staging layer for JSONPlaceholder API users data"
    config:
      elementary_enabled: true
      elementary_schema_changes: true

    columns:
      - name: user_id
        description: "Unique identifier for the user"
        tests:
          - unique
          - not_null
          # Elementary: ボリューム異常検知
          - elementary.volume_anomalies:
              timestamp_column: loaded_at
              sensitivity: 3

      - name: user_name
        description: "User's full name"
        tests:
          - not_null

      - name: username
        description: "User's username"
        tests:
          - not_null
          - unique

      - name: email
        description: "User's email address"
        tests:
          - not_null
          - unique
          # dbt_expectations: メールフォーマット検証
          - dbt_expectations.expect_column_values_to_match_regex:
              regex: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'

      - name: phone
        description: "User's phone number"

      - name: website
        description: "User's website"

      - name: address_json
        description: "User's address information (JSON)"

      - name: company_json
        description: "User's company information (JSON)"

      - name: loaded_at
        description: "Timestamp when data was loaded"
        tests:
          - not_null

# ソース定義（将来的にR2 Rawレイヤーをソースとして定義）
sources:
  - name: api_jsonplaceholder
    description: "Raw data from JSONPlaceholder API stored in R2"
    schema: raw
    tables:
      - name: posts
        description: "Raw posts data from JSONPlaceholder API"
        # フレッシュネスチェック（データが古くなっていないか）
        freshness:
          warn_after: {count: 24, period: hour}
          error_after: {count: 48, period: hour}

      - name: users
        description: "Raw users data from JSONPlaceholder API"
        freshness:
          warn_after: {count: 24, period: hour}
          error_after: {count: 48, period: hour}
```

---

## コード解説

### データレイヤー

| レイヤー | マテリアライゼーション | 用途 |
|---------|---------------------|------|
| **Staging** | VIEW | Bronze→Silver変換、型変換、標準化 |
| **Marts** | TABLE | Silver→Gold変換、集計、ビジネスロジック |

### R2からの直接読み込み

DuckDBの`read_parquet`関数でR2から直接読み込み:

```sql
SELECT *
FROM read_parquet('s3://bucket/path/**/*.parquet')
```

### Elementary異常検知

| テスト | 説明 |
|--------|------|
| `volume_anomalies` | 行数の異常変動検知 |
| `dimension_anomalies` | カテゴリ分布の変化検知 |
| `column_anomalies` | カラム値の統計的異常検知 |
| `schema_changes` | スキーマ変更検知 |

### dbt_expectationsテスト

```yaml
# 正規表現マッチ
- dbt_expectations.expect_column_values_to_match_regex:
    regex: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'

# 値の範囲
- dbt_expectations.expect_column_values_to_be_between:
    min_value: 0
    max_value: 100
```

## 環境変数

| 変数名 | 説明 |
|--------|------|
| `R2_ENDPOINT` | R2エンドポイント（例: `account_id.r2.cloudflarestorage.com`） |
| `R2_ACCESS_KEY_ID` | R2アクセスキーID |
| `R2_SECRET_ACCESS_KEY` | R2シークレットキー |
| `R2_BUCKET_NAME` | R2バケット名 |

## 実行方法

```bash
# 依存パッケージインストール
cd dbt
dbt deps

# 開発環境でビルド
dbt run --target dev

# テスト実行
dbt test

# Elementary実行
dbt run --select elementary

# ドキュメント生成
dbt docs generate
dbt docs serve
```

## 開発方針

### 命名規則

- **Staging**: `stg_{source}_{table}`
- **Marts**: `fct_{entity}` / `dim_{entity}`

### マテリアライゼーション選択

- **VIEW**: Staging、頻繁に変更されるモデル
- **TABLE**: Marts、分析クエリで使用
- **INCREMENTAL**: 大量データ、append-only

### テスト方針

1. **Primary Key**: `unique` + `not_null`
2. **Foreign Key**: `not_null` + relationships
3. **データ品質**: dbt_expectations
4. **異常検知**: Elementary

## 依存関係

```
dbt-duckdb>=1.7.0
dbt-utils>=1.1.0
elementary-data>=0.15.0
dbt-expectations>=0.10.0
```

---

最終更新: 2026-01-11
