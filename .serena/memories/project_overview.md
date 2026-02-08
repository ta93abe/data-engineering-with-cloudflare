# Project Overview

## プロジェクト名
data-engineering-with-cloudflare

## 目的
Cloudflareのエッジコンピューティングプラットフォームを活用し、グローバルに分散された低レイテンシ、高スケーラビリティなデータ基盤を構築する。

## 主な特徴
- **エッジファースト**: Cloudflareのグローバルネットワークを活用した低レイテンシ処理
- **サーバーレス**: 自動スケーリングと運用負荷の削減
- **コスト最適化**: R2のエグレス無料など、従来のクラウドより低コスト
- **統合プラットフォーム**: Workers、KV、R2、D1など、統合されたサービス群

## ディレクトリ構造（2026-02現在）
```
data-engineering-with-cloudflare/
├── .claude/                    # Claude Code設定
├── .github/workflows/          # GitHub Actions CI/CD
├── ingestion/                  # データ取り込みWorker (TypeScript/Hono)
│   ├── src/
│   │   ├── index.ts           # メインエントリ
│   │   ├── types.ts           # 型定義
│   │   ├── services/github.ts # GitHub APIサービス
│   │   └── __tests__/         # テスト
│   ├── biome.json             # Biome設定
│   ├── wrangler.jsonc         # Wrangler設定（JSONC形式）
│   └── package.json           # pnpm依存関係
├── transform/
│   └── core/                  # dbtプロジェクト (DuckDB)
│       ├── models/            # dbtモデル
│       ├── macros/            # dbtマクロ
│       ├── tests/             # dbtテスト
│       ├── seeds/             # シードデータ
│       ├── dbt_project.yml    # dbt設定
│       ├── .sqruff.toml       # SQL Linter設定
│       └── pyproject.toml     # Python依存関係 (uv)
├── mcp-server/                # MCPサーバー（予定）
├── ai/                        # AI関連（予定）
├── dashboard/                 # ダッシュボード（予定）
├── ml/                        # ML関連（予定）
├── infrastructure/
│   ├── pulumi/                # IaC (Go + Pulumi)
│   └── d1/                    # D1マイグレーション
├── docs/                      # ドキュメント
├── scripts/                   # ユーティリティスクリプト
└── logs/                      # ログ
```

## 主要なCloudflareサービス
- Workers: サーバーレスコンピューティング
- D1: サーバーレスSQLデータベース（"raw"データベース）
- Workers KV: キー・バリューストレージ
- R2: S3互換オブジェクトストレージ（エグレス無料）
- Workers Observability: ログ・トレーシング
- Queues: メッセージキュー
- Analytics Engine: 時系列メトリクスDB

## 外部ツール統合
- **dbt** (dbt-duckdb): SQLベースのデータ変換・モデリング
- **Elementary**: dbt向けデータ品質監視
- **Great Expectations**: データバリデーション・品質監視
- **Apache Iceberg**: R2上のオープンテーブルフォーマット（データレイク）
- **Marimo**: リアクティブPythonノートブック
- **dbt-osmosis**: スキーマ自動管理
- **Pulumi** (Go): Infrastructure as Code
