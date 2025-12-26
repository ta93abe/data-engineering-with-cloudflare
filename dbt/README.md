# dbt プロジェクト - Cloudflare Data Platform

このdbtプロジェクトは、Cloudflare R2上のデータを変換し、データ品質を監視するために設計されています。

## プロジェクト構成

```
dbt/
├── models/
│   ├── staging/        # Bronze -> Silver変換
│   │   └── schema.yml  # モデル定義とテスト
│   └── marts/          # Silver -> Gold変換（分析用マート）
│       └── schema.yml
├── tests/              # カスタムテスト
├── macros/             # カスタムマクロ
├── snapshots/          # スナップショット（SCD Type 2）
├── analyses/           # アドホック分析SQL
├── seeds/              # 静的データ（CSV）
├── dbt_project.yml     # プロジェクト設定
├── packages.yml        # dbtパッケージ依存関係
└── profiles.yml        # データベース接続設定
```

## セットアップ

### 1. 依存関係のインストール

```bash
# dbt-duckdbとElementaryをインストール
pip install dbt-duckdb elementary-data

# dbtパッケージをインストール
cd dbt
dbt deps
```

### 2. 環境変数の設定

```bash
# R2接続情報
export R2_ENDPOINT="your-account-id.r2.cloudflarestorage.com"
export R2_ACCESS_KEY_ID="your-access-key-id"
export R2_SECRET_ACCESS_KEY="your-secret-access-key"
```

### 3. dbtコマンド

```bash
# モデルをビルド
dbt run

# テストを実行
dbt test

# ドキュメントを生成
dbt docs generate
dbt docs serve

# 特定のモデルのみ実行
dbt run --select staging.stg_events

# インクリメンタルモデルを全件再ビルド
dbt run --full-refresh

# Elementaryモデルを実行
dbt run --select elementary
```

## Elementaryによるデータ品質監視

### Elementaryのセットアップ

```bash
# Elementaryモデルを実行（初回のみ）
dbt run --select elementary

# Elementaryレポートを生成
edr report

# レポートをブラウザで表示
edr report --serve

# モニタリング実行（Slack通知付き）
edr monitor --slack-webhook $SLACK_WEBHOOK_URL
```

### Elementary CLI コマンド

```bash
# 基本レポート生成
edr report

# 過去7日間のデータを分析
edr report --days-back 7

# 特定のプロファイル・ターゲットを指定
edr report --profile-target prod

# HTMLファイルとして保存
edr report --file-path ./reports/elementary_report.html

# Slack通知付きモニタリング
edr monitor \
  --slack-webhook $SLACK_WEBHOOK_URL \
  --slack-channel data-quality \
  --timezone UTC
```

### Elementary テストの種類

#### 1. ボリューム異常検知
```yaml
tests:
  - elementary.volume_anomalies:
      timestamp_column: event_timestamp
      sensitivity: 3  # 1-5（5が最も厳しい）
```

#### 2. ディメンション異常検知
```yaml
tests:
  - elementary.dimension_anomalies:
      dimensions:
        - event_type
        - user_country
      timestamp_column: event_timestamp
```

#### 3. カラム値の異常検知
```yaml
tests:
  - elementary.all_columns_anomalies:
      column_anomalies:
        - column_name
      timestamp_column: event_timestamp
```

#### 4. スキーマ変更検知
```yaml
# dbt_project.yml
models:
  cloudflare_data_platform:
    staging:
      +elementary_schema_changes: true
```

## データレイヤー

### Bronze Layer（Raw Data）
- **場所**: R2 `data-lake-raw` バケット
- **形式**: dltによるParquet/JSON
- **用途**: 生データの保存

### Silver Layer（Cleaned & Standardized）
- **場所**: R2 `data-lake-silver` バケット（またはDuckDB view）
- **形式**: dbt staging モデル
- **用途**: データクレンジング、標準化

### Gold Layer（Business Logic）
- **場所**: R2 `data-lake-gold` バケット
- **形式**: dbt marts モデル（Iceberg形式推奨）
- **用途**: 分析用の集約データ、ダッシュボード用データ

## GitHub Actions統合

```yaml
# .github/workflows/dbt-ci.yml
name: dbt CI

on:
  pull_request:
    paths:
      - 'dbt/**'

jobs:
  dbt-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: pip install dbt-duckdb elementary-data
      - name: Run dbt
        working-directory: dbt
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        run: |
          dbt deps
          dbt run --target ci
          dbt test
      - name: Run Elementary
        working-directory: dbt
        run: |
          dbt run --select elementary
          edr report
```

## ベストプラクティス

### 1. モデルの命名規則
- Staging: `stg_<source>_<table>`
- Intermediate: `int_<description>`
- Marts: `fct_<description>` または `dim_<description>`

### 2. テストの推奨事項
- すべてのPKに `unique` と `not_null` テスト
- 重要なカラムにElementary異常検知テスト
- スキーマ変更検知を有効化

### 3. インクリメンタルモデル
```sql
{{
  config(
    materialized='incremental',
    unique_key='id',
    on_schema_change='fail'  # スキーマ変更時にエラー
  )
}}

SELECT ...
FROM read_parquet('s3://bucket/path/*.parquet')
{% if is_incremental() %}
WHERE updated_at > (SELECT MAX(updated_at) FROM {{ this }})
{% endif %}
```

### 4. パフォーマンス最適化
- Parquet形式を使用
- パーティション化されたファイル構造
- WHERE句で不要なデータをフィルタ

## トラブルシューティング

### DuckDB接続エラー
```bash
# 環境変数を確認
echo $R2_ENDPOINT
echo $R2_ACCESS_KEY_ID

# DuckDBから直接R2に接続できるかテスト
duckdb -c "
  INSTALL httpfs;
  LOAD httpfs;
  SET s3_endpoint='$R2_ENDPOINT';
  SET s3_access_key_id='$R2_ACCESS_KEY_ID';
  SET s3_secret_access_key='$R2_SECRET_ACCESS_KEY';
  SELECT * FROM read_parquet('s3://bucket/path/*.parquet') LIMIT 5;
"
```

### Elementary レポートが生成されない
```bash
# Elementaryモデルが実行されているか確認
dbt run --select elementary

# elementary.duckdbが存在するか確認
ls -la elementary.duckdb

# デバッグモードで実行
edr report --debug
```

## 参考リンク

- [dbt Documentation](https://docs.getdbt.com/)
- [dbt-duckdb Documentation](https://github.com/duckdb/dbt-duckdb)
- [Elementary Documentation](https://docs.elementary-data.com/)
- [DuckDB httpfs Extension](https://duckdb.org/docs/extensions/httpfs.html)

---

最終更新: 2025-12-26
