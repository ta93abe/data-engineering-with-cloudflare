# dbt Fusion Project

_powered by the dbt Fusion engine (Rust-based)_

Databricks SQL Warehouse を接続先とする dbt Fusion プロジェクト。
Jaffle Shop サンプルモデルを含む。

## セットアップ

1. dbt Fusion CLI をインストール: `curl -fsSL https://public.cdn.getdbt.com/fs/install/install.sh | sh -s -- --update`
2. `profiles.yml` を作成（`profiles.yml.example` を参考）
3. OAuth 認証: `dbtf debug`

## 使い方

```bash
dbtf seed    # シードデータ投入
dbtf run     # モデル実行
dbtf test    # テスト実行
dbtf build   # seed + run + test
```

## 構成

```
development / production (catalog)
├── raw (schema)       ← seeds
├── staging (schema)   ← staging models (view)
└── marts (schema)     ← marts models (table)
```
