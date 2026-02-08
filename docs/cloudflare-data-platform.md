# Cloudflare Data Platform 詳細ガイド

## 1. 概要

Cloudflare Data Platformは、R2上に分析対応のデータウェアハウスおよびレイクハウスを構築するためのサーバーレスデータプラットフォームです。**Cloudflare Pipelines**、**R2 Data Catalog**、**R2 SQL**の3つのコンポーネントで構成され、データの取り込み（Ingest）、カタログ化（Catalog）、クエリ（Query）をエンドツーエンドで実現します。

### 主な特徴

- **ゼロエグレス料金**: 任意のクラウド、データプラットフォーム、リージョンからデータにアクセスしても転送コスト不要
- **Apache Iceberg準拠**: オープンテーブル形式でベンダーロックイン回避
- **サーバーレス**: インフラのプロビジョニング不要、自動スケーリング
- **自動テーブルメンテナンス**: コンパクション、スナップショット管理を自動化

### プラットフォーム全体のデータフロー

```
[Data Sources]
    │
    ▼
┌─────────────────────────────┐
│  Cloudflare Pipelines       │  ← Ingest
│  (Streams → SQL変換 → Sinks)│
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  R2 Data Catalog            │  ← Catalog
│  (Apache Iceberg テーブル)   │
│  (メタデータ管理・コンパクション)│
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  R2 SQL                     │  ← Query
│  (分散クエリエンジン)         │
│                             │
│  外部エンジン連携:            │
│  Spark / Snowflake / DuckDB │
│  / Trino / PyIceberg        │
└─────────────────────────────┘
```

---

## 2. Cloudflare Pipelines

### 2.1 概要

Cloudflare Pipelinesは、イベントデータを取り込み、SQLで変換し、Apache IcebergまたはParquet形式でR2に保存するサーバーレスのストリーミングETLプラットフォームです。[Arroyo](https://www.arroyo.dev/)ストリーム処理エンジンをベースに構築されています。

Apache KafkaやApache Flinkのようなインフラのセットアップが不要で、Wrangler CLIから数コマンドでパイプラインを構築できます。

### 2.2 アーキテクチャ — 3つのコアオブジェクト

```
┌──────────┐    ┌──────────────────┐    ┌──────────┐
│ Streams  │───→│ Pipelines (SQL)  │───→│  Sinks   │
│(データ入力)│    │(フィルタ・変換)    │    │(データ出力)│
└──────────┘    └──────────────────┘    └──────────┘
```

#### Streams（ストリーム）

永続的なバッファ付きキューで、イベントを受信・保存します。

- **HTTPエンドポイント**: 一意のURLが生成され、POSTでJSONデータを送信
- **Worker binding**: `wrangler.toml`で設定し、Workers内から`send()`メソッドで送信
- **スキーマバリデーション**: 定義されたスキーマに対してイベントを検証
- **複数パイプライン接続**: 1つのStreamを複数のPipelineで読み取り可能

**スキーマ定義例:**

```json
{
  "fields": [
    { "name": "user_id", "type": "string", "required": true },
    { "name": "event_type", "type": "string", "required": true },
    { "name": "amount", "type": "float64", "required": false },
    { "name": "timestamp", "type": "timestamp", "required": false },
    { "name": "metadata", "type": "json", "required": false }
  ]
}
```

**サポートされるデータ型:**

| プリミティブ型 | コンポジット型 |
|-------------|-------------|
| `string` | `list` |
| `int32` | `struct` |
| `int64` | |
| `float32` | |
| `float64` | |
| `bool` | |
| `timestamp` | |
| `binary` | |
| `json` | |

**HTTP送信例:**

```bash
curl -X POST https://{stream-id}.ingest.cloudflare.com \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -d '[{"user_id": "u123", "event_type": "purchase", "amount": 29.99}]'
```

**Worker binding設定 (`wrangler.toml`):**

```toml
[[pipelines]]
pipeline = "<STREAM_ID>"
binding = "STREAM"
```

**Worker内での送信:**

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await env.STREAM.send([
      {
        user_id: "user_12345",
        event_type: "purchase",
        product_id: "widget-001",
        amount: 29.99,
      },
    ]);
    return new Response("Event ingested");
  },
};
```

#### Pipelines（パイプライン）

StreamsとSinksをSQLで接続し、リアルタイムにデータを変換します。

**基本フロー:**

```sql
INSERT INTO my_sink SELECT * FROM my_stream
```

**フィルタリング:**

```sql
INSERT INTO my_sink
SELECT * FROM my_stream
WHERE event_type = 'purchase' AND amount > 100
```

**フィールド選択・変換:**

```sql
INSERT INTO my_sink
SELECT
  user_id,
  UPPER(event_type) as event_type,
  amount * 1.1 as amount_with_tax
FROM my_stream
```

**センシティブ情報のリダクション:**

```sql
INSERT INTO my_sink
SELECT
  user_id,
  '***' as email,  -- PII除外
  event_type,
  amount
FROM my_stream
```

> **制約**: Pipeline SQLは作成後に変更できません。変更する場合はパイプラインの削除・再作成が必要です。現在はステートレス変換のみサポートされています。

#### Sinks（シンク）

データの出力先を定義します。2種類のシンクタイプがあります。

**R2 Sink（ファイル出力）:**

| 設定項目 | 説明 | オプション |
|---------|------|---------|
| フォーマット | 出力形式 | JSON（改行区切り）、Parquet |
| 圧縮 | 圧縮方式 | `zstd`（デフォルト）、`snappy`、`gzip`、`lz4`、`uncompressed` |
| パーティション | 時間ベースパターン | デフォルト: `year=%Y/month=%m/day=%d` |
| ローリングポリシー | ファイル分割条件 | サイズ（MB）、時間間隔（秒） |

**R2 Data Catalog Sink（Icebergテーブル出力）:**

- ACIDトランザクション対応
- スキーマ進化サポート
- タイムトラベル機能
- Parquet圧縮オプション設定可能
- Row Groupサイズ設定可能

> **制約**: Sinkは作成後に変更できません。変更する場合はシンクの削除・再作成が必要です。

### 2.3 CLIコマンド

```bash
# インタラクティブセットアップ（推奨）
npx wrangler pipelines setup

# --- Stream管理 ---
# Stream作成（スキーマ付き、HTTP有効）
npx wrangler pipelines streams create <NAME> \
  --schema-file schema.json \
  --http-enabled true \
  --http-auth false

# Stream一覧
npx wrangler pipelines streams list

# Stream詳細
npx wrangler pipelines streams get <STREAM_ID>

# Stream削除
npx wrangler pipelines streams delete <STREAM_ID>

# --- Sink管理 ---
# R2 Sink作成
npx wrangler pipelines sinks create <NAME> \
  --type r2 \
  --bucket my-bucket

# R2 Data Catalog Sink作成
npx wrangler pipelines sinks create <NAME> \
  --type "r2-data-catalog" \
  --bucket "my-bucket" \
  --roll-interval 30 \
  --namespace "my_namespace" \
  --table "my_table" \
  --catalog-token $WRANGLER_R2_SQL_AUTH_TOKEN

# Sink一覧
npx wrangler pipelines sinks list

# Sink詳細
npx wrangler pipelines sinks get <SINK_ID>

# --- Pipeline管理 ---
# Pipeline作成
npx wrangler pipelines create my-pipeline \
  --sql "INSERT INTO my_sink SELECT * FROM my_stream"

# Pipeline一覧
npx wrangler pipelines list

# Pipeline詳細
npx wrangler pipelines get <PIPELINE_ID>

# Pipeline削除
npx wrangler pipelines delete <PIPELINE_ID>
```

### 2.4 制限値（オープンベータ）

| リソース | 制限 |
|---------|------|
| アカウントあたりStream数 | 20 |
| リクエストあたり最大ペイロード | 1 MB |
| Streamあたり最大取り込みレート | 5 MB/s |
| アカウントあたりSink数 | 20 |
| アカウントあたりPipeline数 | 20 |

制限の引き上げはCloudflareのLimit Increase Request Formから申請可能です。

### 2.5 Observability

Cloudflareダッシュボードまたは GraphQL Analytics API でメトリクスを取得可能です。

| メトリクス種別 | データセット | 取得項目 |
|-------------|-----------|---------|
| Operator | `AccountPipelinesOperatorAdaptiveGroups` | 読み取りバイト数/レコード数、デコードエラー |
| Sink | `AccountPipelinesSinkAdaptiveGroups` | 書き込みバイト数/レコード数、ファイル数、Row Group数 |

---

## 3. R2 Data Catalog

### 3.1 概要

R2 Data Catalogは、R2バケットに直接組み込まれたマネージドApache Icebergデータカタログです。標準の**Iceberg REST Catalog API**を公開し、外部クエリエンジンとのシームレスな統合を実現します。

データベースクラスターのセットアップ、オブジェクトストレージへの接続設定、インフラ管理は不要です。数コマンドでペタバイトスケールのデータレイクを構築できます。

### 3.2 Apache Icebergの主要機能

| 機能 | 説明 |
|------|------|
| **ACIDトランザクション** | 信頼性の高い並行読み書きとデータ整合性を保証 |
| **最適化されたメタデータ** | 高コストなフルテーブルスキャンを回避 |
| **スキーマ進化** | カラムの追加・リネーム・削除に対応 |
| **タイムトラベル** | 過去のスナップショットにクエリ可能 |
| **パーティションプルーニング** | 不要なデータファイルのスキップ |

### 3.3 セットアップ

```bash
# R2バケット作成
npx wrangler r2 bucket create my-data-lake

# Data Catalog有効化
npx wrangler r2 bucket catalog enable my-data-lake

# 自動コンパクション有効化（推奨）
npx wrangler r2 bucket catalog compaction enable my-data-lake
```

**自動コンパクション**: 小さなファイルを大きなファイルに統合し、クエリパフォーマンスを向上させます。本番環境では有効化を推奨します。

### 3.4 外部エンジン連携

R2 Data Catalogは標準Iceberg REST APIを公開しているため、以下のエンジンから直接アクセスできます。

| エンジン | 用途 |
|---------|------|
| **Apache Spark** | 大規模分散処理 |
| **Snowflake** | クラウドDWH連携 |
| **DuckDB** | ローカル・組み込み分析 |
| **Trino** | 分散SQLクエリ |
| **PyIceberg** | Pythonからの直接操作 |
| **ClickHouse** | OLAP分析 |

### 3.5 料金（ベータ期間）

現在のベータ期間中、R2 Data Catalog自体の追加料金は発生しません。課金対象は標準のR2ストレージとオペレーションのみです。

**将来の予定料金（参考）:**

| 項目 | 料金 |
|------|------|
| R2ストレージ | $0.015/GB-月 |
| Data Catalog操作 | $9.00/百万操作 |
| Compaction処理 | $0.005/GB処理 |
| エグレス | $0（無料） |

---

## 4. R2 SQL

### 4.1 概要

R2 SQLは、R2 Data Catalogに保存されたApache Icebergテーブルに対してSQLクエリを実行するサーバーレスの分散クエリエンジンです。ペタバイトスケールのデータセットを効率的に処理します。

### 4.2 分散クエリアーキテクチャ

R2 SQLは、I/O最適化とコンピュート分散の2つの課題に対応する高度なアーキテクチャを採用しています。

```
[ユーザー]
    │ SQL Query
    ▼
┌─────────────────────────────┐
│  Query Coordinator          │
│  (プランニング + 結果集約)     │
│                             │
│  ┌────────────────────────┐ │
│  │ Streaming Planner      │ │
│  │ ・マニフェスト解析       │ │
│  │ ・パーティションプルーニング│ │
│  │ ・Row Groupプルーニング  │ │
│  └──────────┬─────────────┘ │
└─────────────┼───────────────┘
              │ Work Units (ストリーミング)
    ┌─────────┼─────────┐
    ▼         ▼         ▼
┌────────┐┌────────┐┌────────┐
│Worker 1││Worker 2││Worker N│
│DataFusion│DataFusion│DataFusion│
│(ベクトル化)│(ベクトル化)│(ベクトル化)│
└────┬───┘└────┬───┘└────┬───┘
     │         │         │
     └─────────┼─────────┘
               │ Apache Arrow (gRPC)
               ▼
         [結果返却]
```

#### ストリーミングプランニングパイプライン

従来のモノリシックなクエリ計画とは異なり、**計画と実行を並行処理**します。

1. スナップショットとマニフェストリストを取得
2. マニフェストを読み込みながら、マッチするデータファイル/Row Groupをワークユニットとして即座に発行
3. コンピュートノードがプランナーの完了を待たずにデータI/Oを開始

#### メタデータベースのプルーニング（3段階）

| 段階 | 統計情報の場所 | 効果 |
|------|-------------|------|
| パーティションレベル | Icebergマニフェストリスト | 値の範囲でパーティション除外 |
| 列レベル | 個別ファイルのmin/max値 | ファイル単位のスキップ |
| Row Groupレベル | Parquetフッター | 行グループ単位のスキップ |

#### Early Termination（早期終了）

`LIMIT`句を含むクエリでは、`ORDER BY`句に基づきマニフェスト処理順序を最適化します。残りのワークユニットが最終結果に影響しないと判断された時点でパイプラインを停止し、データの一部分のみで正確な結果を返します。

#### 実行エンジン

各ワーカーで[Apache DataFusion](https://datafusion.apache.org/)が動作します。

- Row GroupをDataFusionパーティションとしてマッピングし並列処理
- ベクトル化実行で解釈オーバーヘッドを削減
- Parquetの列指向フォーマットにより必要な列のみ読み込み
- 結果はApache Arrow形式でgRPC経由で集約

### 4.3 サポートされるSQL

**集約関数（2026年1月追加）:**

| 関数 | 説明 |
|------|------|
| `SUM()` | 合計 |
| `COUNT()` | カウント |
| `AVG()` | 平均 |
| `MIN()` | 最小値 |
| `MAX()` | 最大値 |

`GROUP BY`句、`HAVING`句もサポートされています。

**クエリ例:**

```sql
-- 基本的なフィルタクエリ
SELECT user_id, event_type, amount
FROM my_namespace.events
WHERE __ingest_ts > '2026-01-01T00:00:00Z'
  AND event_type = 'purchase'
LIMIT 100

-- 集約クエリ
SELECT
  merchant_category,
  COUNT(*) as transaction_count,
  SUM(amount) as total_amount,
  AVG(amount) as avg_amount
FROM fraud_detection.transactions
WHERE is_fraud = true
GROUP BY merchant_category
HAVING COUNT(*) > 10
```

### 4.4 CLIでのクエリ実行

```bash
# 認証トークン設定
export WRANGLER_R2_SQL_AUTH_TOKEN=[your-token]

# クエリ実行
npx wrangler r2 sql query "{WAREHOUSE}" \
  "SELECT user_id, event_type FROM my_namespace.events WHERE amount > 100 LIMIT 10"
```

### 4.5 現在の制約

- `ORDER BY`は現在テーブルのパーティションキーに含まれるカラムのみサポート（改善予定）
- JOINは未サポート（2026年上半期に予定）

### 4.6 料金（ベータ期間）

オープンベータ期間中は、R2 SQL自体の追加料金は発生しません。料金適用前に最低30日の事前通知があります。

---

## 5. エンドツーエンド パイプライン構築例

### 5.1 前提条件

- Cloudflareアカウント（Workers Paid plan）
- Node.js 16.17.0以上
- Python 3.8以上（データ生成スクリプト用）

### 5.2 認証セットアップ

以下の権限を持つカスタムAPIトークンを作成します。

| 権限 | アクセスレベル |
|------|-------------|
| Workers Pipelines | Read, Send, Edit |
| Workers R2 Data Catalog | Read, Edit |
| Workers R2 SQL | Read |
| Workers R2 Storage | Read, Edit |

```bash
export WRANGLER_R2_SQL_AUTH_TOKEN=[your-token]
npx wrangler login
```

### 5.3 Step 1: R2バケットとData Catalog

```bash
# バケット作成
npx wrangler r2 bucket create fraud-pipeline

# Data Catalog有効化
npx wrangler r2 bucket catalog enable fraud-pipeline

# Warehouse IDを保存
export WAREHOUSE=[ACCOUNTID_BUCKETNAME]

# コンパクション有効化（推奨）
npx wrangler r2 bucket catalog compaction enable fraud-pipeline
```

### 5.4 Step 2: Stream作成

スキーマファイル (`raw_transactions_schema.json`):

```json
{
  "fields": [
    { "name": "transaction_id", "type": "string", "required": true },
    { "name": "user_id", "type": "int64", "required": true },
    { "name": "amount", "type": "float64", "required": false },
    { "name": "transaction_timestamp", "type": "string", "required": false },
    { "name": "location", "type": "string", "required": false },
    { "name": "merchant_category", "type": "string", "required": false },
    { "name": "is_fraud", "type": "bool", "required": false }
  ]
}
```

```bash
npx wrangler pipelines streams create raw_events_stream \
  --schema-file raw_transactions_schema.json \
  --http-enabled true \
  --http-auth false

export STREAM_ENDPOINT=[http-ingest-endpoint]
```

### 5.5 Step 3: Sink作成

```bash
# メインテーブルへのSink
npx wrangler pipelines sinks create raw_events_sink \
  --type "r2-data-catalog" \
  --bucket "fraud-pipeline" \
  --roll-interval 30 \
  --namespace "fraud_detection" \
  --table "transactions" \
  --catalog-token $WRANGLER_R2_SQL_AUTH_TOKEN
```

### 5.6 Step 4: Pipeline作成

```bash
# 全イベントを取り込むパイプライン
npx wrangler pipelines create raw_events_pipeline \
  --sql "INSERT INTO raw_events_sink SELECT * FROM raw_events_stream"

# フィルタリング用パイプライン（高額不正取引のみ）
npx wrangler pipelines sinks create fraud_filter_sink \
  --type "r2-data-catalog" \
  --bucket "fraud-pipeline" \
  --roll-interval 30 \
  --namespace "fraud_detection" \
  --table "fraud_transactions" \
  --catalog-token $WRANGLER_R2_SQL_AUTH_TOKEN

npx wrangler pipelines create fraud_events_pipeline \
  --sql "INSERT INTO fraud_filter_sink SELECT * FROM raw_events_stream WHERE is_fraud=true AND amount > 1000"
```

### 5.7 Step 5: R2 SQLでクエリ

```bash
# 最近の不正取引を取得
npx wrangler r2 sql query "$WAREHOUSE" \
  "SELECT transaction_id, user_id, amount, location, merchant_category
   FROM fraud_detection.transactions
   WHERE is_fraud = true
   LIMIT 10"

# カテゴリ別集計
npx wrangler r2 sql query "$WAREHOUSE" \
  "SELECT merchant_category, COUNT(*) as cnt, SUM(amount) as total
   FROM fraud_detection.transactions
   WHERE is_fraud = true
   GROUP BY merchant_category"
```

---

## 6. ユースケース

### 6.1 ログ分析

サーバーログ、アプリケーションイベント、テレメトリデータを収集し、SQLで分析します。

- Pipelinesでイベントをストリーム取り込み
- SQL変換でフィルタ・正規化
- R2 SQLでデバッグ、パフォーマンストラッキング、運用ダッシュボード構築

### 6.2 ビジネスインテリジェンス

クリックストリーム、ユーザーイベント、トランザクションデータを処理します。

- BIツールをIcebergテーブルに直接接続
- Iceberg REST API経由でSnowflake/Sparkと統合
- ゼロエグレスでマルチクラウド分析

### 6.3 ETLパイプライン

データ変換をSQL変換で完結させ、別途ETLサービスを用意する必要がありません。

- 取り込み時にフィルタ・エンリッチ・バリデーション
- PII情報のリダクション
- 複数のSinkで用途別テーブルへの分岐出力

### 6.4 マルチクラウド分析

単一のデータソースを複数クラウドのクエリエンジンからアクセスします。

- Apache Icebergオープン形式でデータ保存
- Spark/Snowflake/DuckDB等から標準REST API経由で接続
- エグレス料金ゼロで自由にデータアクセス

---

## 7. ロードマップ（2026年上半期）

| 機能 | ステータス |
|------|---------|
| 集約関数（SUM, COUNT, AVG, MIN, MAX） | 2026年1月リリース済み |
| Logpush統合 | 開発中 |
| Workers経由のユーザー定義関数（UDF） | 開発中 |
| JOINサポート | 開発中 |
| ステートフル変換（Pipelines） | 開発中 |

---

## 8. 料金まとめ

### 現在（オープンベータ）

| サービス | 料金 |
|---------|------|
| Cloudflare Pipelines | 無料（R2ストレージ・オペレーション費用のみ） |
| R2 Data Catalog | 無料（R2ストレージ・オペレーション費用のみ） |
| R2 SQL | 無料（R2ストレージ・オペレーション費用のみ） |
| R2 エグレス | 無料 |

**前提条件**: Workers Paid plan（$5/月〜）が必要です。

### 将来の予定料金（参考）

| 項目 | 料金 |
|------|------|
| R2ストレージ | $0.015/GB-月 |
| Data Catalog操作 | $9.00/百万操作 |
| Compaction処理 | $0.005/GB処理 |
| Pipelines | データ読み取り量、SQL変換処理量、配信量に基づく（詳細未定） |
| R2 SQL | 詳細未定（適用前に最低30日の事前通知） |

---

## 9. 既存アーキテクチャとの統合

本プロジェクトの[アーキテクチャ設計](./architecture-design.md)におけるCloudflare Data Platformの位置づけは以下の通りです。

### Data Ingestion Layer

Cloudflare Pipelinesは既存のWorkers/HTTP APIベースの取り込みを置き換え・補完します。

```
[既存]                          [Data Platform統合]
Workers → Analytics Engine      Workers → Pipelines → R2 (Iceberg)
Workers → R2 (手動Parquet)      HTTP    → Pipelines → R2 (Iceberg)
```

### Data Storage Layer

R2 Data Catalogにより、Medallion Architecture（Bronze/Silver/Gold）がApache Icebergテーブルとして管理されます。

```
[既存]                          [Data Platform統合]
R2 (手動パーティション管理)      R2 Data Catalog (自動メタデータ管理)
dbt + DuckDB (変換)             Pipelines SQL (取り込み時変換)
                                + dbt + DuckDB (後段変換)
```

### Analytics Layer

R2 SQLにより、追加インフラなしでR2上のデータを直接分析できます。

```
[既存]                          [Data Platform統合]
DuckDB (ローカル分析)            R2 SQL (分散クエリ)
Evidence (BI)                   + DuckDB/Spark/Snowflake (外部エンジン)
                                + Evidence (BI)
```

---

## 10. 参考リンク

### 公式ドキュメント

- [Cloudflare Data Platform](https://workers.cloudflare.com/product/data-platform/)
- [Cloudflare Pipelines Docs](https://developers.cloudflare.com/pipelines/)
- [R2 Data Catalog Docs](https://developers.cloudflare.com/r2/data-catalog/)
- [R2 SQL Docs](https://developers.cloudflare.com/r2-sql/)
- [Apache Iceberg](https://iceberg.apache.org/docs/latest/)

### ブログ記事

- [Announcing the Cloudflare Data Platform](https://blog.cloudflare.com/cloudflare-data-platform/)
- [R2 SQL: a deep dive into our distributed query engine](https://blog.cloudflare.com/r2-sql-deep-dive/)

### 外部記事

- [Cloudflare Introduces Data Platform with Zero Egress Fees - InfoQ](https://www.infoq.com/news/2025/11/cloudflare-data-platform/)
- [Cloudflare Introduces Aggregations in R2 SQL - InfoQ](https://www.infoq.com/news/2026/01/cloudflare-r2-sql-aggregations/)

### End-to-End チュートリアル

- [Build an end to end data pipeline](https://developers.cloudflare.com/r2-sql/tutorials/end-to-end-pipeline/)

---

最終更新: 2026-02-07
