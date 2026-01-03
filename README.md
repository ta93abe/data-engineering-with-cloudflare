# Data Engineering with Cloudflare

Cloudflareのエッジコンピューティングプラットフォームを活用したデータ基盤のリポジトリです。

## 📚 ドキュメント

- [アーキテクチャ設計概要](./docs/architecture-design.md) - Cloudflareデータ基盤の全体設計
- [アーキテクチャ図](./docs/architecture-diagrams.md) - Mermaid形式の視覚的なアーキテクチャ図（9種類）
- [Cloudflareサービスカタログ](./docs/cloudflare-services-catalog.md) - 全サービスの詳細とデータ基盤での活用方法（2025年最新版）
- [外部サービス統合ガイド](./docs/external-services.md) - dbt、dlt、DuckDB、Evidence.dev等との連携方法
- [R2ストレージ設計](./docs/r2-storage-design.md) - バケット戦略とフォルダ構造の詳細設計（4バケット構成）
- [dlt Workers実装ガイド](./docs/dlt-workers-implementation.md) - Workers上でのdltパイプライン実装
- [Iceberg実装ガイド](./docs/iceberg-implementation.md) - Apache Iceberg on Cloudflare（PyIceberg + R2 Data Catalog）
- **[🚀 Icebergセットアップガイド](./docs/iceberg-setup-guide.md)** - R2 Data Catalogを使った実践的なセットアップ手順（ベータ版対応）
- **[💰 コスト分析](./docs/cost-analysis.md)** - 固定費・変動費の詳細試算とコスト最適化戦略
- **[🐙 GitHubデータパイプライン](./docs/github-data-pipeline.md)** - 全リポジトリのメトリクス・アクティビティ自動収集（dlt統合）
- **[⚡ GitHub Workers設計](./docs/github-workers-design.md)** - Cloudflare WorkersベースのGitHubデータ取得アーキテクチャ（設計フェーズ）
- **[🔄 GitHub dbt変換設計](./docs/github-dbt-design.md)** - dbtでRaw→Staging→Marts変換、メトリクス・KPI定義（設計フェーズ）
- **[📊 GitHub Evidence.dev可視化設計](./docs/github-evidence-design.md)** - Evidence.devダッシュボード、Workers+R2デプロイ（設計フェーズ）
- **[🎯 GitHub実装計画](./docs/github-implementation-plan.md)** - 6週間MVP実装ロードマップ、フェーズ別タスク（実装開始）
- **[🛠️ GitHub Workersセットアップガイド](./docs/github-workers-setup.md)** - Workers実装のセットアップとデプロイ手順
- **[🧪 GitHub Workersテストガイド](./docs/github-workers-testing.md)** - Vitestを使ったユニット/統合テスト、カバレッジ測定
- **[📋 セットアップTODOリスト](./docs/SETUP_TODO.md)** - 手動セットアップ手順とチェックリスト（Terraform + Secrets設定）
- [情報源リンク集](./docs/resources.md) - 公式ドキュメント、ブログ、コミュニティリソース

## 🚀 Cloudflare データサービス

このプロジェクトでは、以下のCloudflareサービスを活用します：

### コア基盤
- **Workers**: サーバーレスコンピューティング（フルスタック対応）
- **Workflows**: 耐久性のある実行エンジン（Python対応 ✨NEW）
- **Containers**: フルLinuxコンテナ（2025年6月公開予定 🚧）

### ストレージ・データベース
- **D1**: サーバーレスSQLデータベース（パフォーマンス向上 ⚡）
- **Workers KV**: キー・バリューストレージ
- **R2**: S3互換オブジェクトストレージ（エグレス無料、R2 SQL対応 ✨NEW）
- **Vectorize**: ベクトルデータベース（GA ✨NEW）
- **Hyperdrive**: PostgreSQL/MySQL接続プール

### データ処理・AI
- **Pipelines**: ストリーミングETL（SQL変換対応 ✨NEW）
- **Workers AI**: AI推論プラットフォーム（50+モデル）
- **AI Gateway**: AI制御・監視プレーン
- **Analytics Engine**: 時系列メトリクスDB

### メッセージング・イベント
- **Queues**: メッセージキューサービス
- **R2 Event Notifications**: R2イベント駆動処理（ベータ 🔵）
- **Durable Objects**: ステートフルアプリケーション

### その他
- **Calls**: WebRTCリアルタイム通信（ベータ 🔵）
- **Stream**: 動画ストリーミング
- **Pages**: フルスタックホスティング
- **Browser Rendering**: ヘッドレスブラウザ（ベータ 🔵）

詳細は[サービスカタログ](./docs/cloudflare-services-catalog.md)をご覧ください。

## 🎯 プロジェクト目標

- グローバルに分散された低レイテンシなデータ基盤の構築
- コスト効率の高いデータストレージと処理
- スケーラブルで信頼性の高いアーキテクチャ
- 開発・運用の効率化

## 🔧 外部サービス統合

Cloudflareサービスと組み合わせて、エンドツーエンドのデータパイプラインを構築します：

### データ変換・処理
- **dbt**: SQLベースのデータ変換・モデリング
- **dlt**: Pythonベースのデータ抽出・ロードツール
- **DuckDB**: R2上のParquet/Icebergファイルを直接クエリ

### データ品質
- **Elementary**: dbt向けデータ品質監視・オブザーバビリティツール ✨NEW
- **Great Expectations**: Pythonベースのデータ検証・プロファイリングツール ✨NEW

### データフォーマット
- **Apache Iceberg**: R2上でのACIDトランザクション対応テーブルフォーマット

### データ可視化
- **Evidence.dev**: コードベースのBIツール（Cloudflare Pagesへデプロイ）
- **marimo**: Git-friendlyなリアクティブPythonノートブック ✨NEW

### CI/CD・開発
- **GitHub**: バージョン管理・コラボレーション
- **GitHub Actions**: ETLパイプライン自動実行・Workers自動デプロイ

### 通知・監視
- **Slack**: パイプライン実行結果・アラート通知

詳細は[外部サービス統合ガイド](./docs/external-services.md)をご覧ください。

## 📐 アーキテクチャ概要

```mermaid
graph TB
    subgraph "Data Sources"
        API[External APIs]
        Events[User Events]
        DB[(External DBs)]
    end

    subgraph "Ingestion"
        dlt[dlt]
        Workers[Workers]
        Pipelines[Pipelines]
    end

    subgraph "Storage"
        R2[(R2 + Iceberg)]
        D1[(D1)]
        KV[(KV)]
    end

    subgraph "Transform"
        dbt[dbt + DuckDB]
        WorkersT[Workers]
    end

    subgraph "Analytics"
        Evidence[Evidence.dev]
        R2SQL[R2 SQL]
        Engine[Analytics Engine]
    end

    subgraph "Orchestration"
        GHA[GitHub Actions]
        WF[Workflows]
    end

    API --> dlt
    Events --> Workers
    Events --> Pipelines
    DB --> dlt

    dlt --> R2
    Workers --> D1
    Workers --> KV
    Workers --> Engine
    Pipelines --> R2

    R2 --> dbt
    D1 --> dbt
    dbt --> R2
    dbt --> D1

    R2 --> Evidence
    R2 --> R2SQL
    D1 --> Evidence
    Engine --> Evidence

    GHA --> dlt
    GHA --> dbt
    WF --> WorkersT

    Workers -.通知.-> Slack[Slack]
    GHA -.通知.-> Slack

    style Workers fill:#f96
    style R2 fill:#6cf
    style Evidence fill:#9f6
```

詳細は[アーキテクチャ図](./docs/architecture-diagrams.md)をご覧ください（11種類のMermaid図を提供）。

## 🏗️ Infrastructure as Code (IaC)

このプロジェクトでは **Terraform** と **Makefile** を使ってインフラとデプロイを自動化しています。

### Terraform で管理されるリソース:

- ✅ **R2 Buckets** (data-lake-raw, data-lake-raw-preview)
- ✅ **Queues** (github-fetch-queue, github-fetch-dlq)
- ✅ **KV Namespaces** (METADATA_KV, METADATA_KV_PRODUCTION)
- ✅ **Workers** (github-scheduler, github-fetcher)
- ✅ **Queue Consumers** (Fetcher Worker バインディング)
- ✅ **Cron Triggers** (毎日 2:00 AM UTC)

### クイックセットアップ:

```bash
# 1. 初期セットアップ
make setup

# 2. terraform.tfvars を編集
nano terraform/terraform.tfvars

# 3. Cloudflare API Token を設定
export CLOUDFLARE_API_TOKEN="your-api-token"

# 4. インフラ作成
make init
make plan
make apply

# 5. Secrets 設定（手動）
make setup-secrets

# 6. テスト実行
make test

# 7. デプロイ（本番の場合のみ）
make deploy
```

### 便利なコマンド:

```bash
make help           # 利用可能なコマンド一覧
make test           # 全テスト実行
make test-coverage  # カバレッジレポート生成
make logs-scheduler # Scheduler Worker のログ確認
make logs-fetcher   # Fetcher Worker のログ確認
make trigger        # Scheduler 手動実行
make status         # デプロイ状況確認
```

### 手動設定が必要なもの:

- ❌ **GitHub Personal Access Token** (セキュリティ上 Terraform 管理外)
- ❌ **Cloudflare API Token** (初回のみ)
- ❌ **wrangler.toml の ID 更新** (Terraform outputs から取得)

詳細は以下を参照:
- **[📋 SETUP_TODO.md](./docs/SETUP_TODO.md)** - 手動セットアップ手順（TODO リスト）
- **[📖 terraform/README.md](./terraform/README.md)** - Terraform 設定ガイド
- **[🛠️ Makefile](./Makefile)** - 自動化コマンド一覧

## 📖 はじめに

### 🚀 クイックスタート

**R2 Data Catalog + Iceberg環境を15分でセットアップ:**

👉 **[QUICKSTART.md](./QUICKSTART.md)** - 3ステップで即座に始められるガイド

### 📚 詳細ドキュメント

詳細な設計と実装ガイドについては、[アーキテクチャ設計概要](./docs/architecture-design.md)をご覧ください。

