# Cloudflare データ基盤 - 情報源リンク集

Cloudflareでデータ基盤を構築する際に参考になる公式ドキュメント、ブログ記事、コミュニティリソースをまとめています。

## 目次

- [公式ドキュメント](#公式ドキュメント)
- [公式ブログ](#公式ブログ)
- [チェンジログ](#チェンジログ)
- [製品別ドキュメント](#製品別ドキュメント)
- [コミュニティ](#コミュニティ)
- [ツール・SDK](#ツールsdk)
- [学習リソース](#学習リソース)
- [参考アーキテクチャ](#参考アーキテクチャ)

---

## 公式ドキュメント

### メインドキュメント
- [Cloudflare Developers](https://developers.cloudflare.com/) - 公式開発者ドキュメントのトップページ
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/) - Workers公式ドキュメント
- [Storage Options Guide](https://developers.cloudflare.com/workers/platform/storage-options/) - ストレージサービス選択ガイド
- [Pricing Overview](https://developers.cloudflare.com/workers/platform/pricing/) - Workers料金体系

### データプラットフォーム
- [Cloudflare Data Platform Announcement](https://blog.cloudflare.com/cloudflare-data-platform/) - データプラットフォームの発表記事
- [Data Anywhere with Pipelines, Events, and Workflows](https://blog.cloudflare.com/data-anywhere-events-pipelines-durable-execution-workflows/) - データプラットフォームの概要

---

## 公式ブログ

### 主要アナウンス（2025年）
- [Developer Week 2025 Wrap-up](https://blog.cloudflare.com/developer-week-2025-wrap-up/) - 2025年4月の主要アップデート
- [AI Week 2025 Updates](https://www.cloudflare.com/en-gb/innovation-week/ai-week-2025/updates/) - AI関連アップデート
- [What's New at Cloudflare](https://www.cloudflare.com/whats-new/) - 最新情報一覧

### ブログカテゴリ
- [Product News](https://blog.cloudflare.com/tag/product-news/) - 製品ニュース
- [Workers](https://blog.cloudflare.com/tag/workers/) - Workers関連記事
- [Cloudflare Stream](https://blog.cloudflare.com/tag/cloudflare-stream/) - Stream関連記事
- [WebRTC](https://blog.cloudflare.com/tag/webrtc/) - WebRTC関連記事

---

## チェンジログ

### 全体
- [Cloudflare Developers Changelog](https://developers.cloudflare.com/changelog/) - 全サービスのチェンジログ
- [Cloudflare One Changelog](https://developers.cloudflare.com/cloudflare-one/changelog/) - Cloudflare Oneのチェンジログ
- [Pages Changelog](https://developers.cloudflare.com/pages/platform/changelog/) - Pagesのチェンジログ

### 主要な変更（2025年）
- [Pipelines Launch (2025-04-10)](https://developers.cloudflare.com/changelog/2025-04-10-launching-pipelines/) - Pipelines公開
- [R2 Data Catalog Beta (2025-04-10)](https://developers.cloudflare.com/changelog/2025-04-10-r2-data-catalog-beta/) - R2 Data Catalogベータ
- [R2 SQL Open Beta (2025-09-25)](https://developers.cloudflare.com/changelog/2025-09-25-announcing-r2-sql-open-beta/) - R2 SQL公開
- [Pipelines SQL Transformations (2025-09-25)](https://developers.cloudflare.com/changelog/2025-09-25-pipelines-sql/) - Pipelines SQL対応
- [Media Transformations (2025-03-06)](https://developers.cloudflare.com/changelog/2025-03-06-media-transformations/) - Media Transformations公開
- [New Workers AI Models (2025-03-17)](https://developers.cloudflare.com/changelog/2025-03-17-new-workers-ai-models/) - 新AIモデル追加
- [Workers AI Pricing Update (2025-02-20)](https://developers.cloudflare.com/changelog/2025-02-20-updated-pricing-docs/) - Workers AI価格改定
- [Automatic Resource Provisioning (2025-10-24)](https://developers.cloudflare.com/changelog/2025-10-24-automatic-resource-provisioning/) - KV, R2, D1自動プロビジョニング

---

## 製品別ドキュメント

### コンピューティング

#### Workers
- [Overview](https://developers.cloudflare.com/workers/) - Workers概要
- [Get Started](https://developers.cloudflare.com/workers/get-started/) - クイックスタート
- [Examples](https://developers.cloudflare.com/workers/examples/) - コード例
- [Runtime APIs](https://developers.cloudflare.com/workers/runtime-apis/) - ランタイムAPI
- [Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/) - バインディング

#### Workflows
- [Overview](https://developers.cloudflare.com/workflows/) - Workflows概要
- [Guide](https://developers.cloudflare.com/workflows/get-started/guide/) - 使い方ガイド
- [GA Announcement](https://blog.cloudflare.com/workflows-ga-production-ready-durable-execution/) - GA発表
- [Building Workflows](https://blog.cloudflare.com/building-workflows-durable-execution-on-workers/) - 構築ガイド
- [Python Workflows](https://blog.cloudflare.com/python-workflows/) - Python対応

#### Durable Objects
- [Overview](https://developers.cloudflare.com/durable-objects/) - Durable Objects概要
- [Get Started](https://developers.cloudflare.com/durable-objects/get-started/) - 入門ガイド
- [Running Serverless Puppeteer](https://blog.cloudflare.com/running-serverless-puppeteer-workers-durable-objects/) - Puppeteer統合

#### Workers for Platforms
- [Overview](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/) - Workers for Platforms概要
- [Product Page](https://www.cloudflare.com/developer-platform/products/workers-for-platforms/) - 製品ページ
- [Configuration](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/get-started/configuration/) - 設定ガイド
- [Announcement](https://blog.cloudflare.com/workers-for-platforms/) - 発表記事

### ストレージ・データベース

#### D1
- [Overview](https://developers.cloudflare.com/d1/) - D1概要
- [Get Started](https://developers.cloudflare.com/d1/get-started/) - クイックスタート
- [Release Notes](https://developers.cloudflare.com/d1/platform/release-notes/) - リリースノート

#### Workers KV
- [Overview](https://developers.cloudflare.com/kv/) - KV概要
- [Get Started](https://developers.cloudflare.com/kv/get-started/) - クイックスタート
- [Blog: Workers KV is GA](https://blog.cloudflare.com/workers-kv-is-ga/) - GA発表

#### R2
- [Overview](https://developers.cloudflare.com/r2/) - R2概要
- [Get Started](https://developers.cloudflare.com/r2/get-started/) - クイックスタート
- [Event Notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/) - イベント通知
- [Blog: R2 Event Notifications](https://blog.cloudflare.com/data-anywhere-events-pipelines-durable-execution-workflows/) - イベント通知発表

#### Vectorize
- [Overview](https://developers.cloudflare.com/vectorize/) - Vectorize概要
- [Get Started with Embeddings](https://developers.cloudflare.com/vectorize/get-started/embeddings/) - 埋め込み入門
- [Blog: Vectorize Vector Database](https://blog.cloudflare.com/vectorize-vector-database-open-beta/) - オープンベータ発表

#### Hyperdrive
- [Overview](https://developers.cloudflare.com/hyperdrive/) - Hyperdrive概要
- [Get Started](https://developers.cloudflare.com/hyperdrive/get-started/) - クイックスタート

### AI・機械学習

#### Workers AI
- [Overview](https://developers.cloudflare.com/workers-ai/) - Workers AI概要
- [Product Page](https://www.cloudflare.com/developer-platform/products/workers-ai/) - 製品ページ
- [Models](https://developers.cloudflare.com/workers-ai/models/) - 利用可能モデル
- [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) - 料金体系
- [Blog: Workers AI - Bigger, Better, Faster](https://blog.cloudflare.com/workers-ai-bigger-better-faster/) - アップデート記事
- [Blog: Globally Distributed AI](https://blog.cloudflare.com/globally-distributed-ai-and-a-constellation-update/) - グローバル分散AI

#### AI Gateway
- [Overview](https://developers.cloudflare.com/ai-gateway/) - AI Gateway概要
- [Features](https://developers.cloudflare.com/ai-gateway/features/) - 機能一覧
- [Caching](https://developers.cloudflare.com/ai-gateway/features/caching/) - キャッシング機能
- [Analytics](https://developers.cloudflare.com/ai-gateway/observability/analytics/) - アナリティクス
- [Pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/) - 料金
- [Product Page](https://www.cloudflare.com/developer-platform/products/ai-gateway/) - 製品ページ
- [Blog: AI Gateway August 2025 Refresh](https://blog.cloudflare.com/ai-gateway-aug-2025-refresh/) - 2025年8月アップデート
- [Blog: Announcing AI Gateway](https://blog.cloudflare.com/announcing-ai-gateway/) - 発表記事

### データ処理・ETL

#### Pipelines
- [Overview](https://developers.cloudflare.com/pipelines/) - Pipelines概要
- [Getting Started](https://developers.cloudflare.com/pipelines/getting-started/) - 入門ガイド
- [Blog: Arroyo Acquisition](https://blog.cloudflare.com/cloudflare-acquires-arroyo-pipelines-streaming-ingestion-beta/) - Arroyo買収とPipelines
- [Reference Architecture: Serverless ETL](https://developers.cloudflare.com/reference-architecture/diagrams/serverless/serverless-etl/) - ETLアーキテクチャ

#### Analytics Engine
- [Overview](https://developers.cloudflare.com/analytics/analytics-engine/) - Analytics Engine概要
- [Get Started](https://developers.cloudflare.com/analytics/analytics-engine/get-started/) - クイックスタート

### メッセージング・イベント

#### Queues
- [Overview](https://developers.cloudflare.com/queues/) - Queues概要
- [Get Started](https://developers.cloudflare.com/queues/get-started/) - クイックスタート

#### Pub/Sub
- [Overview](https://developers.cloudflare.com/pub-sub/) - Pub/Sub概要

### メディア・コンテンツ

#### Stream
- [Overview](https://developers.cloudflare.com/stream/) - Stream概要
- [Product Page](https://www.cloudflare.com/developer-platform/products/cloudflare-stream/) - 製品ページ
- [Transform Videos](https://developers.cloudflare.com/stream/transform-videos/) - 動画変換
- [FAQ](https://developers.cloudflare.com/stream/faq/) - よくある質問
- [Pricing](https://developers.cloudflare.com/stream/pricing/) - 料金
- [Blog: What's New with Cloudflare Media](https://blog.cloudflare.com/whats-next-for-cloudflare-media/) - メディアサービス最新情報

#### Media Transformations
- [Blog: Media Transformations](https://blog.cloudflare.com/media-transformations-for-video-open-beta/) - 動画変換機能

#### Images
- [Overview](https://developers.cloudflare.com/images/) - Images概要
- [Get Started](https://developers.cloudflare.com/images/get-started/) - クイックスタート

### リアルタイム通信

#### Cloudflare Calls (Realtime)
- [Overview](https://developers.cloudflare.com/realtime/) - Realtime概要
- [Product Page](https://www.cloudflare.com/developer-platform/products/cloudflare-realtime/) - 製品ページ
- [Blog: Cloudflare Calls Anycast WebRTC](https://blog.cloudflare.com/cloudflare-calls-anycast-webrtc/) - Anycast WebRTC
- [Blog: Announcing Cloudflare Calls](https://blog.cloudflare.com/announcing-cloudflare-calls/) - 発表記事
- [Blog: Real-Time Communications at Scale](https://blog.cloudflare.com/announcing-our-real-time-communications-platform/) - リアルタイム通信プラットフォーム
- [Blog: AI Integration with Calls](https://blog.cloudflare.com/bring-multimodal-real-time-interaction-to-your-ai-applications-with-cloudflare-calls/) - AI統合

### 開発者ツール

#### Pages
- [Overview](https://developers.cloudflare.com/pages/) - Pages概要
- [Get Started](https://developers.cloudflare.com/pages/get-started/) - クイックスタート
- [Framework Guides](https://developers.cloudflare.com/pages/framework-guides/) - フレームワークガイド

#### Browser Rendering
- [Overview](https://developers.cloudflare.com/browser-rendering/) - Browser Rendering概要
- [Puppeteer](https://developers.cloudflare.com/browser-rendering/puppeteer/) - Puppeteer統合
- [Screenshots](https://developers.cloudflare.com/browser-rendering/workers-bindings/screenshots/) - スクリーンショット
- [FAQ](https://developers.cloudflare.com/browser-rendering/faq/) - よくある質問
- [Blog: Browser Rendering Open Beta](https://blog.cloudflare.com/browser-rendering-open-beta/) - オープンベータ発表
- [GitHub: Puppeteer](https://github.com/cloudflare/puppeteer) - Puppeteer forkリポジトリ

#### Email Routing / Email Workers
- [Overview](https://developers.cloudflare.com/email-routing/) - Email Routing概要
- [Email Workers](https://developers.cloudflare.com/email-routing/email-workers/) - Email Workers
- [Enable Email Workers](https://developers.cloudflare.com/email-routing/email-workers/enable-email-workers/) - Email Workers有効化
- [Send Emails from Workers](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/) - Workers からのメール送信
- [Blog: Email Service](https://blog.cloudflare.com/email-service/) - Email Service発表
- [Blog: Route to Workers](https://blog.cloudflare.com/announcing-route-to-workers/) - Email Workers発表

#### Zaraz
- [Overview](https://developers.cloudflare.com/zaraz/) - Zaraz概要
- [Product Page](https://www.cloudflare.com/application-services/products/zaraz/) - 製品ページ
- [Supported Tools](https://developers.cloudflare.com/zaraz/reference/supported-tools/) - 対応ツール
- [FAQ](https://developers.cloudflare.com/zaraz/faq/) - よくある質問
- [Blog: Zaraz Acquisition](https://blog.cloudflare.com/cloudflare-acquires-zaraz-to-enable-cloud-loading-of-third-party-tools/) - Zaraz買収
- [Blog: Automated Actions](https://blog.cloudflare.com/account-owned-tokens-automated-actions-zaraz/) - 自動化アクション

---

## 参考アーキテクチャ

### Reference Architecture Diagrams
- [Reference Architecture Docs](https://developers.cloudflare.com/reference-architecture/) - リファレンスアーキテクチャトップ
- [Serverless ETL Pipelines](https://developers.cloudflare.com/reference-architecture/diagrams/serverless/serverless-etl/) - サーバーレスETL
- [Event Notifications for Storage](https://developers.cloudflare.com/reference-architecture/diagrams/storage/event-notifications-for-storage/) - ストレージイベント通知
- [Programmable Platforms](https://developers.cloudflare.com/reference-architecture/diagrams/serverless/programmable-platforms/) - プログラマブルプラットフォーム

### Examples & Demos
- [Workers Examples](https://developers.cloudflare.com/workers/examples/) - Workers実装例
- [Demos and Architectures](https://developers.cloudflare.com/workers/demos/) - デモとアーキテクチャ

---

## ツール・SDK

### Wrangler CLI
- [Wrangler Documentation](https://developers.cloudflare.com/workers/wrangler/) - Wrangler公式ドキュメント
- [Installation](https://developers.cloudflare.com/workers/wrangler/install-and-update/) - インストール
- [Commands](https://developers.cloudflare.com/workers/wrangler/commands/) - コマンドリファレンス
- [Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) - 設定ファイル

### SDKs
- [GitHub: workers-sdk](https://github.com/cloudflare/workers-sdk) - Workers SDK
- [GitHub: cloudflare-docs](https://github.com/cloudflare/cloudflare-docs) - ドキュメントリポジトリ
- [GitHub: puppeteer](https://github.com/cloudflare/puppeteer) - Puppeteer fork
- [npm: @cloudflare/puppeteer](https://www.npmjs.com/package/@cloudflare/puppeteer) - Puppeteer npm パッケージ

### Miniflare（ローカル開発）
- [GitHub: miniflare](https://github.com/cloudflare/miniflare) - Miniflare リポジトリ
- [Miniflare Discussion: Storage](https://github.com/cloudflare/miniflare/discussions/525) - ストレージ関連ディスカッション

---

## コミュニティ

### 公式コミュニティ
- [Cloudflare Community](https://community.cloudflare.com/) - 公式フォーラム
- [Cloudflare Developers Discord](https://discord.gg/cloudflaredev) - Discord サーバー
- [GitHub Discussions](https://github.com/orgs/cloudflare/discussions) - GitHub ディスカッション

### ソーシャルメディア
- [Twitter: @CloudflareDev](https://twitter.com/CloudflareDev) - 開発者向け公式Twitter
- [Twitter: @Cloudflare](https://twitter.com/Cloudflare) - Cloudflare公式Twitter
- [YouTube: Cloudflare](https://www.youtube.com/cloudflare) - 公式YouTube

---

## 学習リソース

### チュートリアル・ガイド
- [Workers Get Started Guide](https://developers.cloudflare.com/workers/get-started/guide/) - Workers入門
- [D1 Tutorial](https://developers.cloudflare.com/d1/tutorials/) - D1チュートリアル
- [R2 Get Started](https://developers.cloudflare.com/r2/get-started/) - R2入門
- [Vectorize Tutorial](https://developers.cloudflare.com/vectorize/get-started/) - Vectorize入門

### ベストプラクティス
- [Workers Best Practices](https://developers.cloudflare.com/workers/platform/best-practices/) - Workersベストプラクティス
- [Security Best Practices](https://developers.cloudflare.com/workers/platform/security/) - セキュリティベストプラクティス

### パフォーマンス
- [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) - Workers制限値
- [Workers Pricing - Scale to Zero](https://blog.cloudflare.com/workers-pricing-scale-to-zero/) - 新料金体系

---

## 外部リソース

### ニュース・記事
- [InfoQ: Cloudflare Developer Week 2025](https://www.infoq.com/news/2025/11/cloudflare-data-platform/) - InfoQの記事
- [InfoQ: Python Workflows](https://www.infoq.com/news/2025/11/cloudflare-python-ai-workflows/) - Python Workflows記事
- [InfoQ: Workflows for Scalable Applications](https://www.infoq.com/news/2024/11/cloudflare-workers-durable-scale/) - Workflowsスケーラビリティ
- [BigDATAwire: R2 Event Notifications](https://www.hpcwire.com/bigdatawire/2024/04/04/cloudflare-announces-majors-updates-for-r2-including-event-notifications-and-gcs-support/) - R2アップデート記事
- [Datanami: R2 Updates](https://www.datanami.com/2024/04/04/cloudflare-announces-majors-updates-for-r2-including-event-notifications-and-gcs-support/) - R2記事
- [VentureBeat: AI Platform](https://venturebeat.com/ai/cloudflare-ignites-ai-platform-efforts-with-serverless-inference-vectorize-database-and-ai-gateway) - AIプラットフォーム記事

### 技術ブログ
- [BlogGeek.me: Cloudflare Video Services](https://bloggeek.me/cloudflare-2025/) - 動画サービス分析
- [Bas codes: Developer Week 2025](https://bas.codes/posts/cloudflare-dev-week-25/) - Developer Week解説
- [Webmobix: Developer Week Recap](https://webmobix.com/blog/cloudflare-developer-week-2025-recap/) - Developer Weekまとめ

---

## 製品ページ

### 主要製品
- [Workers](https://workers.cloudflare.com/) - Workers製品サイト
- [Workers AI](https://workers.cloudflare.com/product/workers-ai) - Workers AI製品ページ
- [AI Gateway](https://workers.cloudflare.com/product/ai-gateway) - AI Gateway製品ページ
- [Workers Pricing](https://workers.cloudflare.com/pricing) - 料金ページ

### ソリューション
- [Multi-Tenant Platform Development](https://workers.cloudflare.com/solutions/platforms) - マルチテナントソリューション

---

## その他のリソース

### Cloudflareサービス概要
- [Cloudflavor: Platform Services](https://cloudflavor.io/products/cloudflare/) - サービス一覧

### セキュリティ・コンプライアンス
- [Cloudflare Trust Hub](https://www.cloudflare.com/trust-hub/) - セキュリティ・コンプライアンス情報
- [Status Page](https://www.cloudflarestatus.com/) - サービス稼働状況

---

## 更新履歴

- **2025-12-25**: 初版作成
  - 公式ドキュメント、ブログ、チェンジログへのリンクを整理
  - 製品別ドキュメント、コミュニティリソース、学習リソースを追加
  - 2025年の最新情報を反映

---

## リンク切れについて

Cloudflareは頻繁にドキュメントを更新しています。リンク切れを見つけた場合：

1. [Cloudflare Developers](https://developers.cloudflare.com/)のサイト内検索を利用
2. [Cloudflare Blog](https://blog.cloudflare.com/)のタグ検索を利用
3. [GitHub Issues](https://github.com/ta93abe/data-engineering-with-cloudflare/issues)で報告

---

最終更新: 2025年12月25日
