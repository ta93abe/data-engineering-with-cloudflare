# dbt Project: Cloudflare Data Platform

Cloudflare R2 + DuckDB を使用した dbt プロジェクト。

## セットアップ

```bash
cd transform/core

# 依存関係のインストール
uv sync

# dbt パッケージのインストール
uv run dbt deps

# 設定確認
uv run dbt debug
```

## 環境変数

R2 接続に必要な環境変数:

```bash
export R2_ENDPOINT="your-account-id.r2.cloudflarestorage.com"
export R2_ACCESS_KEY_ID="your-access-key-id"
export R2_SECRET_ACCESS_KEY="your-secret-access-key"
export R2_BUCKET_NAME="your-bucket-name"
```

## 実行

```bash
# モデルの実行
uv run dbt run

# テストの実行
uv run dbt test

# ドキュメント生成
uv run dbt docs generate
uv run dbt docs serve
```

## プロジェクト構成

```
transform/core/
├── pyproject.toml          # Python 依存関係 (uv)
├── dbt_project.yml         # dbt 設定
├── profiles.yml            # 接続プロファイル
├── packages.yml            # dbt パッケージ
├── .sqruff.toml            # SQL Linter 設定
├── models/
│   ├── staging/            # Staging Layer (view)
│   │   ├── _staging__sources.yml
│   │   ├── _staging__models.yml
│   │   └── stg_*.sql
│   └── marts/              # Marts Layer (table)
│       └── core/
│           ├── _core__models.yml
│           └── dim_*.sql / fct_*.sql
├── tests/                  # カスタムテスト
├── macros/                 # カスタムマクロ
├── seeds/                  # シードデータ
└── snapshots/              # スナップショット
```

## 命名規則

| レイヤー | プレフィックス | マテリアライズ |
|----------|----------------|----------------|
| Staging | `stg_` | view |
| Intermediate | `int_` | ephemeral |
| Marts - Fact | `fct_` | table |
| Marts - Dimension | `dim_` | table |

## パッケージ

- **elementary**: データ品質監視
- **dbt_utils**: 汎用マクロ
- **dbt_expectations**: テスト拡張
- **codegen**: YAML 自動生成
- **audit_helper**: リファクタリング検証
- **dbt_project_evaluator**: ベストプラクティス診断
- **automate_dv**: Data Vault 自動化

## Linting

```bash
# SQL Lint
uv run sqruff lint models/

# SQL Format
uv run sqruff fix models/
```

## dbt-osmosis

```bash
# schema.yml の自動同期
uv run dbt-osmosis yaml refactor
```
