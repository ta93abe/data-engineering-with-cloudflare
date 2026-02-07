# Tech Stack (2026-02更新)

## プログラミング言語
- **TypeScript**: Cloudflare Workers実装（メイン）
- **Python**: dbt変換パイプライン
- **Go**: Pulumiインフラ管理
- **SQL**: dbt変換、D1クエリ

## ingestion Worker (TypeScript)
- **ランタイム**: Cloudflare Workers
- **フレームワーク**: Hono
- **パッケージマネージャー**: pnpm
- **設定**: wrangler.jsonc (JSONC形式)
- **バインディング**: D1 ("raw" database)
- **Cron**: 毎日0:00 UTC
- **Observability**: Workers Observability有効

### 主要依存関係
```json
{
  "dependencies": { "hono": "^4.11.7" },
  "devDependencies": {
    "@biomejs/biome": "^2.3.13",
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.20250124.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.4.0"
  }
}
```

## transform/core (dbt + Python)
- **Python**: >=3.11, <3.13
- **パッケージマネージャー**: uv
- **dbtアダプタ**: dbt-duckdb>=1.9.0
- **データ品質**: elementary-data>=0.16.1
- **スキーマ管理**: dbt-osmosis>=1.0.0
- **SQLフォーマット**: shandy-sqlfmt[jinjafmt]>=0.24.0
- **SQLリント**: sqruff>=0.24.0 (DuckDB方言)

## infrastructure (Pulumi + Go)
- **IaC**: Pulumi (Go)
- **D1マイグレーション**: Wrangler CLI

## Linting & Formatting

| 対象 | ツール | 備考 |
|------|--------|------|
| TypeScript/JS | Biome | ESLint+Prettier置き換え |
| SQL | sqruff | DuckDB方言、Jinja対応 |
| SQL整形 | shandy-sqlfmt | 行長120 |

## テスト

| 対象 | ツール | 備考 |
|------|--------|------|
| TypeScript | Vitest | @cloudflare/vitest-pool-workers |
| dbt | dbt test | Elementary含む |

## CI/CD (GitHub Actions)

| ワークフロー | 用途 |
|-------------|------|
| claude-code-review.yml | AIコードレビュー |
| claude.yml | Claude関連 |
| d1-migrations.yml | D1マイグレーション適用 |
| pulumi-deploy.yml | インフラデプロイ |
| pulumi-preview.yml | インフラプレビュー |
| biome-check.yml | Biomeリント・フォーマットチェック |

## ツール

| 用途 | ツール |
|------|--------|
| Issue管理 | Linear (de-studyプロジェクト) |
| PR管理 | Graphite (スタック型PR) |
| リポジトリ | GitHub |
| IaC | Pulumi (Go) |
| Workers CLI | Wrangler |
