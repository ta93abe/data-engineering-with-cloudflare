# Data Engineering with Cloudflare

Cloudflareのエッジコンピューティングプラットフォームを活用したデータ基盤のリポジトリです。

## 📚 ドキュメント

- [アーキテクチャ設計概要](./docs/architecture-design.md) - Cloudflareデータ基盤の全体設計

## 🚀 Cloudflare データサービス

このプロジェクトでは、以下のCloudflareサービスを活用します：

- **Workers**: サーバーレスコンピューティング
- **Workers KV**: キー・バリューストレージ
- **R2**: S3互換オブジェクトストレージ（エグレス無料）
- **D1**: サーバーレスSQLデータベース
- **Analytics Engine**: 時系列データとメトリクス分析
- **Queues**: メッセージキューサービス
- **Durable Objects**: ステートフルアプリケーション
- **Hyperdrive**: PostgreSQL接続プール

## 🎯 プロジェクト目標

- グローバルに分散された低レイテンシなデータ基盤の構築
- コスト効率の高いデータストレージと処理
- スケーラブルで信頼性の高いアーキテクチャ
- 開発・運用の効率化

## 📖 はじめに

詳細な設計と実装ガイドについては、[アーキテクチャ設計概要](./docs/architecture-design.md)をご覧ください。

