# Great Expectations - Cloudflare Data Platform

Great Expectationsを使用したデータ品質検証とプロファイリング。

## 概要

Great Expectationsは、データの期待値（Expectations）を定義し、データが期待通りであることを検証するツールです。

### 主な機能

1. **データ検証**: データが定義された期待値を満たしているか検証
2. **データプロファイリング**: データの統計情報を自動生成
3. **Data Docs**: HTMLベースのデータドキュメント生成
4. **アラート**: 検証失敗時のSlack通知
5. **R2統合**: DuckDB経由でR2上のParquetファイルを直接検証

## ディレクトリ構造

```
great_expectations/
├── great_expectations.yml       # メイン設定ファイル
├── expectations/                # Expectation Suites
│   ├── api_posts_suite.json    # Posts用の期待値定義
│   └── api_users_suite.json    # Users用の期待値定義
├── checkpoints/                 # Checkpoints
│   └── daily_data_quality_checkpoint.yml
├── plugins/                     # カスタムプラグイン
│   ├── __init__.py
│   └── custom_r2_datasource.py # R2データソース
├── uncommitted/                 # Git管理外（.gitignore）
│   ├── config_variables.yml    # 環境変数設定
│   ├── data_docs/              # 生成されたData Docs
│   └── validations/            # 検証結果
└── README.md                    # このファイル
```

## セットアップ

### 1. 依存関係のインストール

```bash
pip install great-expectations==0.18.12
pip install duckdb==0.10.0
pip install pandas
```

### 2. 環境変数の設定

```bash
export R2_ENDPOINT="your-account-id.r2.cloudflarestorage.com"
export R2_ACCESS_KEY_ID="your-access-key-id"
export R2_SECRET_ACCESS_KEY="your-secret-access-key"
export R2_BUCKET_NAME="data-lake-raw"
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."  # オプション
```

### 3. 設定の確認

```bash
cd great_expectations
great_expectations project check-config
```

## 使用方法

### データ検証の実行

```bash
# Python スクリプトで実行
python scripts/run_great_expectations.py

# または Great Expectations CLI
great_expectations checkpoint run daily_data_quality_checkpoint
```

### Data Docs の表示

```bash
# Data Docsを生成して表示
great_expectations docs build
great_expectations docs list

# ローカルサーバーで表示
cd great_expectations/uncommitted/data_docs/local_site
python -m http.server 8080
# http://localhost:8080 にアクセス
```

### 新しい Expectation Suite の作成

```bash
# 対話的に作成
great_expectations suite new

# または既存データからプロファイリング
great_expectations suite demo
```

## Expectation Types

### 基本的な Expectations

```python
# テーブルレベル
expect_table_row_count_to_be_between(min_value=1, max_value=1000000)
expect_table_columns_to_match_ordered_list(column_list=["id", "name", "email"])

# カラムレベル
expect_column_values_to_not_be_null(column="user_id")
expect_column_values_to_be_unique(column="email")
expect_column_values_to_be_in_set(column="status", value_set=["active", "inactive"])

# データ型
expect_column_values_to_be_in_type_list(column="age", type_list=["INTEGER"])

# 文字列
expect_column_value_lengths_to_be_between(column="title", min_value=1, max_value=500)
expect_column_values_to_match_regex(column="email", regex="^[a-zA-Z0-9._%+-]+@.*")

# 数値
expect_column_values_to_be_between(column="price", min_value=0, max_value=10000)
expect_column_mean_to_be_between(column="score", min_value=50, max_value=100)

# 日付
expect_column_values_to_be_dateutil_parseable(column="created_at")
```

### カスタム Expectations

```python
# great_expectations/plugins/custom_expectations.py
from great_expectations.execution_engine import PandasExecutionEngine
from great_expectations.expectations.expectation import ColumnMapExpectation

class ExpectColumnValuesToBeValidPostalCode(ColumnMapExpectation):
    """カスタムExpectation: 郵便番号の検証"""

    map_metric = "column_values.match_regex"
    success_keys = ("regex",)

    default_kwarg_values = {
        "regex": r"^\d{3}-\d{4}$",
        "result_format": "BASIC"
    }
```

## Checkpoints

Checkpointは複数の検証をまとめて実行するための設定です。

### Checkpoint の実行

```bash
# CLI
great_expectations checkpoint run daily_data_quality_checkpoint

# Python
import great_expectations as gx

context = gx.get_context()
results = context.run_checkpoint(checkpoint_name="daily_data_quality_checkpoint")

if not results["success"]:
    print("❌ Validation failed!")
```

### Checkpoint の作成

```yaml
# checkpoints/my_checkpoint.yml
name: my_checkpoint
config_version: 1.0
class_name: Checkpoint

validations:
  - batch_request:
      datasource_name: r2_bronze
      data_asset_name: my_table
    expectation_suite_name: my_suite

action_list:
  - name: store_validation_result
    action:
      class_name: StoreValidationResultAction
  - name: update_data_docs
    action:
      class_name: UpdateDataDocsAction
```

## R2 統合

### DuckDB経由でR2データを検証

```python
import duckdb
import great_expectations as gx

# R2接続設定
conn = duckdb.connect(":memory:")
conn.execute("INSTALL httpfs; LOAD httpfs;")
conn.execute(f"SET s3_endpoint='{R2_ENDPOINT}';")
conn.execute(f"SET s3_access_key_id='{R2_ACCESS_KEY_ID}';")
conn.execute(f"SET s3_secret_access_key='{R2_SECRET_ACCESS_KEY}';")

# データ読み込み
df = conn.execute("""
    SELECT * FROM read_parquet('s3://my-bucket/data/**/*.parquet')
""").fetchdf()

# Great Expectationsで検証
context = gx.get_context()
validator = context.sources.pandas_default.read_dataframe(df)
validator.expect_table_row_count_to_be_between(min_value=1)
results = validator.validate()
```

## GitHub Actions 統合

`.github/workflows/great-expectations.yml` が以下を自動実行：

1. **毎日の検証**: 2:00 UTCに自動実行
2. **Data Docs生成**: HTMLレポート生成
3. **Cloudflare Pages デプロイ**: レポートをPagesにデプロイ
4. **Slack通知**: 失敗時に通知
5. **週次プロファイリング**: 日曜日にデータプロファイリング

## ベストプラクティス

### 1. Expectation の粒度

```yaml
# ✅ Good: 具体的な期待値
expect_column_values_to_be_between:
  column: age
  min_value: 0
  max_value: 120

# ❌ Bad: 曖昧な期待値
expect_column_values_to_not_be_null:
  column: optional_field  # オプショナルフィールドには不適切
```

### 2. メタデータの活用

```json
{
  "expectation_type": "expect_column_values_to_be_unique",
  "kwargs": {
    "column": "user_id"
  },
  "meta": {
    "notes": "user_id must be unique (primary key)",
    "profiled_at": "2025-12-26",
    "business_rule": "BR-001: User IDs are system-generated UUIDs"
  }
}
```

### 3. 段階的な導入

```
Phase 1: 基本的な検証
  - NOT NULL チェック
  - ユニーク制約
  - データ型チェック

Phase 2: ビジネスルール
  - 値の範囲チェック
  - フォーマット検証
  - 参照整合性

Phase 3: 統計的検証
  - 分布の異常検知
  - 外れ値検出
  - トレンド分析
```

## トラブルシューティング

### 1. R2接続エラー

```bash
# 環境変数を確認
env | grep R2_

# DuckDBで直接テスト
duckdb -c "
  INSTALL httpfs; LOAD httpfs;
  SET s3_endpoint='$R2_ENDPOINT';
  SET s3_access_key_id='$R2_ACCESS_KEY_ID';
  SET s3_secret_access_key='$R2_SECRET_ACCESS_KEY';
  SELECT * FROM read_parquet('s3://$R2_BUCKET_NAME/**/*.parquet') LIMIT 5;
"
```

### 2. Validation が失敗する

```bash
# 詳細なログを確認
great_expectations --verbose checkpoint run my_checkpoint

# 結果を確認
cat great_expectations/uncommitted/validations/<validation_id>/validation_result.json
```

### 3. Data Docs が生成されない

```bash
# キャッシュをクリア
rm -rf great_expectations/uncommitted/data_docs/

# 再生成
great_expectations docs build

# 権限を確認
ls -la great_expectations/uncommitted/
```

## 参考リンク

- [Great Expectations 公式ドキュメント](https://docs.greatexpectations.io/)
- [Expectation Gallery](https://greatexpectations.io/expectations/)
- [DuckDB httpfs Extension](https://duckdb.org/docs/extensions/httpfs.html)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)

---

最終更新: 2025-12-26
