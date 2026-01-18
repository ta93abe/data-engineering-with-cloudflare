# Tech Stack

## プログラミング言語
- **TypeScript/JavaScript**: Cloudflare Workers実装
- **Rust**: MCP Server実装 (WebAssembly)
- **Python**: データパイプライン、データ品質、ノートブック
- **SQL**: dbt変換、D1クエリ

## Python環境
- Python 3.11以上
- パッケージ管理: uv (pyproject.toml)

### 主要ライブラリ
```
# dbt
dbt-duckdb>=1.7.2
elementary-data[duckdb]>=0.15.1
sqlfluff>=3.0.0

# Data Quality
great-expectations>=0.18.12

# Data Processing
duckdb>=0.10.0
pandas>=2.0.0
numpy>=1.24.0
pyarrow>=14.0.0

# Visualization
marimo>=0.9.14
plotly>=5.18.0

# dlt pipeline
dlt[filesystem]>=0.4.0

# Apache Iceberg
pyiceberg>=0.6.0

# Cloud Storage
boto3>=1.34.0
s3fs>=2024.2.0
```

### 開発ツール
- ruff: Linter
- black: Formatter
- mypy: 型チェック
- pytest: テスト

## Rust環境 (MCP Server)
- workers-rs: Cloudflare Workers Rustバインディング
- serde/serde_json: JSON処理
- ビルド: worker-build (WebAssembly)

## Cloudflare CLI
- Wrangler: Cloudflare Workers用CLI

## CI/CD
- GitHub Actions
  - dbt-ci.yml
  - elementary-monitor.yml
  - great-expectations.yml
  - marimo-notebooks.yml

## ディレクトリ構造
```
data-engineering-with-cloudflare/
├── .claude/              # Claude Code設定
├── .github/workflows/    # GitHub Actions
├── dbt/                  # dbtプロジェクト
├── docs/                 # ドキュメント
├── great_expectations/   # データ品質設定
├── marimo/               # Pythonノートブック
├── scripts/              # ユーティリティスクリプト
├── workers/              # Cloudflare Workers
│   ├── ai/              # AI関連Workers (JS)
│   ├── ingestion/       # データ取り込み (Python)
│   ├── mcp-server/      # MCP Server (Rust)
│   └── transformation/  # データ変換 (Python)
├── pyproject.toml       # Python依存関係
└── wrangler*.toml       # Wrangler設定ファイル群
```
