# Suggested Commands (2026-02更新)

## ingestion Worker (TypeScript)

```bash
cd ingestion

# 依存関係インストール
pnpm install

# ローカル開発
pnpm dev              # wrangler dev

# デプロイ
pnpm deploy           # wrangler deploy --minify

# テスト
pnpm test             # vitest (watch mode)
pnpm test:run         # vitest run (single run)

# 型チェック
pnpm typecheck        # tsc --noEmit

# 型生成
pnpm cf-typegen       # wrangler types --env-interface CloudflareBindings

# Linting (Biome)
pnpm lint             # biome lint .
pnpm lint:fix         # biome lint --write .
pnpm format           # biome format --write .
pnpm check            # biome check . (lint + format)
pnpm check:fix        # biome check --write .
```

## transform/core (dbt)

```bash
cd transform/core

# Python環境セットアップ
uv sync
uv sync --group dev

# dbt操作
uv run dbt deps
uv run dbt run
uv run dbt run --select model_name
uv run dbt test
uv run dbt docs generate
uv run dbt docs serve

# SQLリント (sqruff)
uv run sqruff lint models/
uv run sqruff fix models/

# SQLフォーマット (sqlfmt)
uv run sqlfmt models/
```

## infrastructure

### Pulumi
```bash
cd infrastructure/pulumi

# 環境変数読み込み
set -a; source .env.local; set +a

# プレビュー
pulumi preview

# デプロイ
pulumi up
```

### D1マイグレーション
```bash
# マイグレーション適用
wrangler d1 migrations apply raw --config infrastructure/d1/wrangler.toml

# ローカルで確認
wrangler d1 migrations apply raw --local --config infrastructure/d1/wrangler.toml
```

## Cloudflare Workers CLI

```bash
# 環境変数設定
wrangler secret put API_KEY

# KV操作
wrangler kv namespace create "NAMESPACE_NAME"
wrangler kv namespace list

# D1操作
wrangler d1 create database-name

# R2操作
wrangler r2 bucket create bucket-name
wrangler r2 bucket list

# ログ確認
wrangler tail
```

## Git / Graphite

```bash
# ブランチ作成
git checkout main && git pull
git checkout -b feat/description

# Graphiteでトラッキング＆PR作成
gt track
gt submit --no-interactive

# Graphite同期
gt sync

# PRマージ
gh pr merge <pr-number> --squash --delete-branch
```
