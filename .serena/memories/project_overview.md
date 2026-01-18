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

## Cloudflareサービス
### コア基盤
- Workers: サーバーレスコンピューティング
- Workflows: 耐久性のある実行エンジン
- D1: サーバーレスSQLデータベース
- Workers KV: キー・バリューストレージ
- R2: S3互換オブジェクトストレージ（エグレス無料）
- Vectorize: ベクトルデータベース

### データ処理・AI
- Pipelines: ストリーミングETL
- Workers AI: AI推論プラットフォーム
- AI Gateway: AI制御・監視プレーン
- Analytics Engine: 時系列メトリクスDB

## 外部ツール統合
- **dbt**: SQLベースのデータ変換・モデリング
- **dlt**: Pythonベースのデータ抽出・ロードツール
- **DuckDB**: R2上のParquet/Icebergファイルを直接クエリ
- **Elementary**: dbt向けデータ品質監視
- **Great Expectations**: Pythonベースのデータ検証
- **Apache Iceberg**: ACIDトランザクション対応テーブルフォーマット
- **Evidence.dev**: コードベースのBIツール
- **marimo**: Git-friendlyなリアクティブPythonノートブック
