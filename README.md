# Data Engineering with Cloudflare

Cloudflareのエッジコンピューティングプラットフォームを活用したデータ基盤のリポジトリです。

## プロジェクト構成

```
.
├── docs/           # ドキュメント
├── ingestion/      # データ取り込み (Cloudflare Workers)
├── transform/      # データ変換 (dbt, DuckDB)
├── dashboard/      # ダッシュボード (Evidence.dev, marimo)
├── ai/             # AI/ML Workers
├── ml/             # 機械学習パイプライン
├── mcp-server/     # MCP Server (LLM連携)
├── infrastructure/ # インフラ管理 (Pulumi)
└── scripts/        # ユーティリティスクリプト
```

## ドキュメント

- [アーキテクチャ設計概要](./docs/architecture-design.md)


## 技術スタック

### Cloudflare サービス

| カテゴリ | サービス | 用途 |
|---------|---------|------|
| コンピュート | Workers | サーバーレス処理 |

### 外部ツール
