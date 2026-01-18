# Suggested Commands

## Python環境

### 依存関係インストール
```bash
# uv使用（推奨）
uv sync

# 開発依存関係含む
uv sync --extra dev

# 特定グループ
uv sync --extra iceberg
uv sync --extra workers
```

### Linting & Formatting
```bash
# Ruff (リント)
ruff check .
ruff check . --fix

# Black (フォーマット)
black .
black --check .

# mypy (型チェック)
mypy src/

# SQLFluff (SQLリント)
sqlfluff lint dbt/models/
sqlfluff fix dbt/models/
```

### テスト
```bash
pytest
pytest --cov=src --cov-report=html
```

## dbt

```bash
cd dbt

# 依存関係インストール
dbt deps

# モデル実行
dbt run
dbt run --select model_name

# テスト
dbt test

# ドキュメント生成
dbt docs generate
dbt docs serve
```

## Great Expectations

```bash
cd great_expectations

# チェックポイント実行
great_expectations checkpoint run daily_data_quality_checkpoint

# データドキュメント生成
great_expectations docs build
```

## marimo (ノートブック)

```bash
# ノートブック起動
marimo edit marimo/notebooks/data_quality_dashboard.py

# サーバーモード
marimo run marimo/notebooks/data_quality_dashboard.py
```

## Cloudflare Workers

### Wrangler CLI
```bash
# ローカル開発
wrangler dev

# 特定設定ファイル使用
wrangler dev --config wrangler-llm-chat.toml

# デプロイ
wrangler deploy
wrangler deploy --config wrangler-llm-chat.toml

# 環境変数設定
wrangler secret put API_KEY

# KV操作
wrangler kv:namespace create "NAMESPACE_NAME"
wrangler kv:namespace list

# D1操作
wrangler d1 create database-name
wrangler d1 migrations apply database-name

# R2操作
wrangler r2 bucket create bucket-name
wrangler r2 bucket list

# ログ確認
wrangler tail
```

### Rust MCP Server
```bash
cd workers/mcp-server

# Rustターゲット追加（初回のみ）
rustup target add wasm32-unknown-unknown

# worker-buildインストール（初回のみ）
cargo install worker-build

# ビルド
worker-build --release

# ローカル開発
wrangler dev

# デプロイ
wrangler deploy
```

## Git

```bash
# ブランチ作成
git switch -c feature/xxx

# コミット
git add .
git commit -m "feat: xxx"

# プッシュ
git push -u origin feature/xxx

# PR作成
gh pr create --title "xxx" --body "xxx"
```

## ユーティリティ (macOS/Darwin)

```bash
# ファイル検索
find . -name "*.py" -type f
mdfind -onlyin . "keyword"

# テキスト検索
grep -r "pattern" .
rg "pattern"  # ripgrep推奨

# ディレクトリ構造
ls -la
find . -type d -maxdepth 2

# プロセス確認
lsof -i :8787  # ポート使用確認
```
