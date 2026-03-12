# sandbox-dbt

Cloudflare Sandbox 上で dbt (DuckDB) パイプラインを実行する Worker。
API / Cron トリガーで dbt seed → run → test を Cloudflare 内で完結させ、成果物を R2 に保存する。

## アーキテクチャ

```
┌─────────────────────────────────────────────┐
│  Cloudflare Worker (Hono)                   │
│  POST /run  ──→  Sandbox Container          │
│  GET  /runs      ┌───────────────────────┐  │
│  Cron 0 2 * * *  │ Python + dbt-duckdb   │  │
│                   │ dbt seed/run/test     │  │
│                   │ profiles.yml (ci)     │  │
│                   └──────────┬────────────┘  │
│                              │               │
│  R2 (data-lake) ◄────────────┘               │
│  └─ dbt-runs/{runId}/                        │
│       ├── result.json                        │
│       ├── manifest.json                      │
│       ├── run_results.json                   │
│       └── dbt.log                            │
└─────────────────────────────────────────────┘
```

## ローカル開発

### 前提条件

- Node.js 18+
- pnpm
- Docker Desktop または Colima（Sandbox コンテナのビルド・実行に必要）

### セットアップ

```bash
cd sandbox-dbt

# 依存関係インストール
pnpm install

# R2 認証情報を .dev.vars に設定（ローカル開発用）
cat > .dev.vars << 'EOF'
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
EOF
```

### 起動

```bash
# transform/core を同期 + Worker + Sandbox 起動
pnpm dev
```

初回は Docker イメージのビルドに 2-3 分かかる。
`dbt deps` も Dockerfile 内で実行されるため、以降の起動は高速。

### 動作確認

```bash
# ヘルスチェック
curl http://localhost:8787/health

# dbt 実行（seed + run + test）
curl -X POST http://localhost:8787/run

# 個別コマンド
curl -X POST "http://localhost:8787/run?command=seed"
curl -X POST "http://localhost:8787/run?command=run"
curl -X POST "http://localhost:8787/run?command=test"

# 実行履歴
curl http://localhost:8787/runs

# 実行結果詳細
curl http://localhost:8787/runs/<runId>
```

### トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| `pnpm dev` で Docker エラー | Docker Desktop が起動していない | Docker Desktop を起動 |
| dbt 実行で R2 接続エラー | `.dev.vars` の認証情報が不正 | R2 API トークンを再確認 |
| `dbt deps` エラー | dbt-project/ が未同期 | `pnpm prebuild` を手動実行 |
| コンテナビルドが遅い | 初回のみ。pip install が重い | 2回目以降はキャッシュで高速 |

## デプロイ

### 1. シークレット設定（初回のみ）

```bash
cd sandbox-dbt

# R2 認証情報を Workers Secrets に設定
wrangler secret put R2_ENDPOINT
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

### 2. デプロイ

```bash
# transform/core 同期 + デプロイ
pnpm deploy
```

`pnpm deploy` は内部で以下を実行する:
1. `prebuild`: transform/core → dbt-project/ を rsync
2. `wrangler deploy --minify`: Worker + Dockerfile をデプロイ

### 3. 確認

```bash
# 本番ヘルスチェック
curl https://sandbox-dbt.<SUBDOMAIN>.workers.dev/health

# 本番で dbt 実行
curl -X POST https://sandbox-dbt.<SUBDOMAIN>.workers.dev/run
```

### CI/CD

Cloudflare Dashboard の GitHub 連携で自動デプロイ:
- **main へのマージ** → 本番デプロイ
- **PR 作成** → プレビュー URL 発行

> **注意**: `prebuild` が必要なため、GitHub 連携を使う場合は
> ビルドコマンドに `pnpm prebuild && wrangler deploy --minify` を設定すること。

## API

| Method | Path | 説明 |
|--------|------|------|
| GET | `/health` | ヘルスチェック |
| POST | `/run` | dbt 実行（seed + run + test） |
| POST | `/run?command=seed\|run\|test` | 個別コマンド実行 |
| GET | `/runs` | 実行履歴一覧 |
| GET | `/runs/:runId` | 実行結果詳細 |

### Cron

毎日 UTC 02:00（JST 11:00）に `seed + run + test` を自動実行。

## プロジェクト構成

```
sandbox-dbt/
├── Dockerfile              # cloudflare/sandbox ベース + dbt 事前 install
├── dbt-project/            # transform/core のコピー（prebuild で生成、gitignore）
├── src/
│   ├── index.ts            # Hono ルーティング + scheduled ハンドラー
│   ├── types.ts            # 型定義（Env, DbtRunResult 等）
│   └── services/
│       ├── dbt-runner.ts   # Sandbox 内 dbt 実行ロジック
│       └── r2-artifacts.ts # R2 成果物の保存・取得
├── wrangler.jsonc          # Workers 設定（containers, R2, cron）
├── biome.json
├── tsconfig.json
└── package.json
```

`dbt-project/` は `.gitignore` に含まれる。
ソースは常に `transform/core/` が Single Source of Truth。

## 改善ロードマップ

現状の評価と ◎ にするための施策。

| 観点 | 現状 | 施策 | Issue |
|------|:--:|------|-------|
| DuckDB 対応 | ○ | marts を R2 Parquet 直接書き出しにし、コンテナのリソース制限に依存しない設計にする | [TA-382](https://linear.app/ta93abe/issue/TA-382) |
| セットアップ容易性 | ○ | `.dev.vars.example` テンプレート追加。`pnpm dev` 一発で動く（ほぼ達成済み） | [TA-383](https://linear.app/ta93abe/issue/TA-383) |
| コスト | ? | 実行頻度を 1日1回に限定、API に rate limit（10回/日）、R2 成果物に TTL | [TA-384](https://linear.app/ta93abe/issue/TA-384) |
| 運用負荷 | ○ | 構造化ログ（JSON）+ exec 失敗時の自動リトライ（1回）+ Webhook 通知 | [TA-385](https://linear.app/ta93abe/issue/TA-385) |
| 観測可能性 | ○ | run_results.json を解析してモデル別メトリクス（成否・実行時間・行数）を返す。Analytics Engine 連携 | [TA-386](https://linear.app/ta93abe/issue/TA-386) |
