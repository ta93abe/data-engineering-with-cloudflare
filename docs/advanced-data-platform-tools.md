# 高度なデータプラットフォームツール統合ガイド

OpenMetadata、OpenLineage、リバースETL、DVC、Debeziumの包括的導入ガイド。

## 📋 目次

1. [OpenMetadata & OpenLineage (メタデータ管理・リネージ)](#openmetadata--openlineage)
2. [リバースETL (データ活性化)](#リバースetl)
3. [DVC (データバージョン管理)](#dvc-data-version-control)
4. [Debezium (Change Data Capture)](#debezium-cdc)

---

# OpenMetadata & OpenLineage

## 概要

### OpenMetadata
オープンソースのメタデータ管理・データカタログプラットフォーム。

**機能:**
- データカタログ（データセット、テーブル、カラム）
- データリネージ追跡
- データプロファイリング
- データ品質管理
- ユーザー・チーム管理
- タグ・用語集

### OpenLineage
データリネージの標準化プロトコル。

**機能:**
- パイプライン実行追跡
- データセット間の依存関係
- ジョブ実行履歴
- メタデータ収集標準化

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│              OpenMetadata Server (Dockerで実行)              │
│  - Metadata Store (PostgreSQL/MySQL)                        │
│  - Elasticsearch (検索)                                      │
│  - API Server                                               │
└─────────────────────────────────────────────────────────────┘
                           ▲
                           │ Ingestion
┌──────────────────────────┼──────────────────────────────────┐
│                          │                                  │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ dbt Metadata │  │ R2 Datasets │  │ D1 Tables       │  │
│  │ (models,     │  │ (parquet,   │  │ (SQLite         │  │
│  │  tests,      │  │  JSON)      │  │  tables)        │  │
│  │  docs)       │  └─────────────┘  └─────────────────┘  │
│  └──────────────┘                                          │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         OpenLineage Events (HTTP)                    │  │
│  │  - dbt run → OpenLineage emit                       │  │
│  │  - Workers execution → Lineage API                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## セットアップ

### 1. OpenMetadata Docker起動

```bash
# docker-compose.yml
version: '3.8'

services:
  openmetadata-server:
    image: openmetadata/server:1.2.0
    ports:
      - "8585:8585"
    environment:
      - OPENMETADATA_CLUSTER_NAME=openmetadata
      - DB_DRIVER_CLASS=org.postgresql.Driver
      - DB_SCHEME=postgresql
      - DB_USER=openmetadata_user
      - DB_USER_PASSWORD=openmetadata_password
      - DB_HOST=postgresql
      - DB_PORT=5432
      - ELASTICSEARCH_HOST=elasticsearch
      - ELASTICSEARCH_PORT=9200
    depends_on:
      - postgresql
      - elasticsearch

  postgresql:
    image: postgres:15
    environment:
      POSTGRES_USER: openmetadata_user
      POSTGRES_PASSWORD: openmetadata_password
      POSTGRES_DB: openmetadata_db
    volumes:
      - postgres-data:/var/lib/postgresql/data

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.10.2
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    volumes:
      - es-data:/usr/share/elasticsearch/data

volumes:
  postgres-data:
  es-data:
```

```bash
docker-compose up -d
# OpenMetadata UI: http://localhost:8585
```

### 2. dbt統合

```yaml
# dbt/profiles.yml

cloudflare_data_platform:
  target: prod
  outputs:
    prod:
      type: duckdb
      path: ':memory:'
      # OpenMetadata設定
      metadata:
        openmetadata:
          server_url: "http://localhost:8585"
          api_version: "v1"
          auth_provider: "no-auth"
```

```yaml
# dbt/dbt_project.yml

meta:
  openmetadata:
    service_name: "cloudflare-dbt"
    database: "duckdb"
```

### 3. dbtメタデータ取り込み

```bash
# OpenMetadata Ingestion設定
# ingestion/dbt_metadata.yaml

source:
  type: dbt
  serviceName: cloudflare-dbt
  sourceConfig:
    config:
      type: DBT
      dbtConfigSource:
        dbtManifestFilePath: /path/to/dbt/target/manifest.json
        dbtCatalogFilePath: /path/to/dbt/target/catalog.json
        dbtRunResultsFilePath: /path/to/dbt/target/run_results.json

sink:
  type: metadata-rest
  config:
    api_endpoint: http://localhost:8585/api

workflowConfig:
  openMetadataServerConfig:
    hostPort: http://localhost:8585/api
    authProvider: no-auth
```

```bash
# メタデータ取り込み実行
metadata ingest -c ingestion/dbt_metadata.yaml
```

### 4. R2データセット登録

```python
# scripts/register_r2_datasets.py

from metadata.generated.schema.entity.services.connections.metadata.openMetadataConnection import (
    OpenMetadataConnection,
)
from metadata.ingestion.ometa.ometa_api import OpenMetadata
from metadata.generated.schema.entity.data.table import Table, Column, DataType

# OpenMetadata接続
server_config = OpenMetadataConnection(hostPort="http://localhost:8585/api")
metadata = OpenMetadata(server_config)

# R2データセット登録
r2_table = Table(
    name="api_posts",
    databaseSchema="r2://data-lake-raw/sources/api_jsonplaceholder",
    columns=[
        Column(name="id", dataType=DataType.INT),
        Column(name="userId", dataType=DataType.INT),
        Column(name="title", dataType=DataType.STRING),
        Column(name="body", dataType=DataType.STRING),
    ],
    tableType="External",
)

metadata.create_or_update(r2_table)
print("R2 dataset registered in OpenMetadata")
```

## OpenLineage統合

### 1. dbt with OpenLineage

```yaml
# dbt/profiles.yml

cloudflare_data_platform:
  target: prod
  outputs:
    prod:
      type: duckdb
      path: ':memory:'
      # OpenLineage設定
      openlineage:
        url: "http://localhost:5000"
        api_key: "${OPENLINEAGE_API_KEY}"
        namespace: "cloudflare_dbt"
```

### 2. Workers実行時のLineage記録

```javascript
// workers/data-processor/lineage.js

/**
 * OpenLineage イベント送信
 */
export async function emitLineageEvent(env, runEvent) {
  const lineageEvent = {
    eventType: runEvent.eventType,  // START, COMPLETE, FAIL
    eventTime: new Date().toISOString(),
    run: {
      runId: runEvent.runId,
      facets: {
        processing: {
          bytesRead: runEvent.bytesRead,
          bytesWritten: runEvent.bytesWritten,
          recordsRead: runEvent.recordsRead,
          recordsWritten: runEvent.recordsWritten
        }
      }
    },
    job: {
      namespace: "cloudflare_workers",
      name: runEvent.jobName,
      facets: {
        documentation: {
          description: runEvent.description
        }
      }
    },
    inputs: runEvent.inputs.map(input => ({
      namespace: "r2",
      name: input.dataset,
      facets: {
        dataSource: {
          name: "r2",
          uri: `s3://${input.bucket}/${input.key}`
        }
      }
    })),
    outputs: runEvent.outputs.map(output => ({
      namespace: "r2",
      name: output.dataset,
      facets: {
        dataSource: {
          name: "r2",
          uri: `s3://${output.bucket}/${output.key}`
        },
        schema: {
          fields: output.schema
        }
      }
    })),
    producer: "cloudflare-workers/1.0"
  };

  await fetch(env.OPENLINEAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENLINEAGE_API_KEY}`
    },
    body: JSON.stringify(lineageEvent)
  });
}

// 使用例
await emitLineageEvent(env, {
  eventType: 'START',
  runId: crypto.randomUUID(),
  jobName: 'transform-api-data',
  description: 'Transform API data from bronze to silver',
  inputs: [
    { dataset: 'api_posts_bronze', bucket: 'data-lake-raw', key: 'sources/api/posts.parquet' }
  ],
  outputs: [
    {
      dataset: 'api_posts_silver',
      bucket: 'data-lake-silver',
      key: 'transformed/posts.parquet',
      schema: [
        { name: 'post_id', type: 'INTEGER' },
        { name: 'user_id', type: 'INTEGER' },
        { name: 'title', type: 'STRING' }
      ]
    }
  ],
  bytesRead: 1024000,
  bytesWritten: 512000,
  recordsRead: 1000,
  recordsWritten: 1000
});
```

---

# リバースETL

## 概要

**リバースETL**: データウェアハウスからSaaS/業務システムへデータを同期。

**ユースケース:**
- R2のユーザーデータ → Salesforce CRM
- 分析結果 → Slack通知
- 顧客セグメント → HubSpot マーケティング
- 製品利用状況 → Intercom カスタマーサポート

## ソリューション比較

| ツール | 特徴 | コスト | Cloudflare統合 |
|--------|------|--------|---------------|
| **Hightouch** | GUI、多数のコネクタ、SQL同期 | $$$ | R2/DuckDB対応 |
| **Census** | エンタープライズ向け、リッチUI | $$$ | カスタムコネクタ |
| **Airbyte** | オープンソース、拡張性高 | $ (セルフホスト) | カスタムソース作成可 |
| **自作 (Workers)** | 完全カスタマイズ可能 | $ (Workers実行費) | ✅ ネイティブ |

## 推奨: Workers + Airbyte ハイブリッド

### アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                  R2 (データレイク)                            │
│  Silver/Gold Layer Parquet files                            │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│         Workers Cron (リバースETLオーケストレータ)              │
│  - DuckDBでR2をクエリ                                        │
│  - ターゲットAPI形式に変換                                     │
│  - レート制限・リトライ管理                                     │
└─────────────────────────────────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    ▼              ▼
          ┌─────────────┐  ┌─────────────┐
          │ Salesforce  │  │  HubSpot    │
          │   API       │  │    API      │
          └─────────────┘  └─────────────┘
```

### Workers実装

```javascript
// workers/reverse-etl/salesforce-sync.js

import duckdb from '@duckdb/duckdb-wasm';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncToSalesforce(env));
  }
};

async function syncToSalesforce(env) {
  // 1. DuckDBでR2データをクエリ
  const conn = await duckdb.connect(':memory:');

  await conn.execute(`
    INSTALL httpfs;
    LOAD httpfs;
    SET s3_endpoint='${env.R2_ENDPOINT}';
    SET s3_access_key_id='${env.R2_ACCESS_KEY_ID}';
    SET s3_secret_access_key='${env.R2_SECRET_ACCESS_KEY}';
  `);

  const result = await conn.query(`
    SELECT
      email,
      first_name,
      last_name,
      company,
      annual_revenue,
      last_activity_date
    FROM read_parquet('s3://data-lake-gold/crm/enriched_leads.parquet')
    WHERE sync_to_salesforce = true
      AND last_synced_at < CURRENT_TIMESTAMP - INTERVAL '1' HOUR
    LIMIT 1000
  `);

  // 2. Salesforce APIに送信
  const accessToken = await getSalesforceToken(env);

  for (const row of result.toArray()) {
    try {
      await upsertSalesforceContact(accessToken, {
        Email: row.email,
        FirstName: row.first_name,
        LastName: row.last_name,
        Company: row.company,
        AnnualRevenue: row.annual_revenue,
        LastActivityDate: row.last_activity_date
      });

      // 同期完了をマーク
      await markAsSynced(env, row.email);

    } catch (error) {
      console.error(`Failed to sync ${row.email}:`, error);
      await logSyncError(env, row.email, error.message);
    }
  }

  conn.close();
}

async function getSalesforceToken(env) {
  const response = await fetch('https://login.salesforce.com/services/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.SALESFORCE_CLIENT_ID,
      client_secret: env.SALESFORCE_CLIENT_SECRET
    })
  });

  const data = await response.json();
  return data.access_token;
}

async function upsertSalesforceContact(token, contact) {
  const response = await fetch(
    `https://yourinstance.salesforce.com/services/data/v58.0/sobjects/Contact/Email/${contact.Email}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(contact)
    }
  );

  if (!response.ok) {
    throw new Error(`Salesforce API error: ${response.statusText}`);
  }

  return response.json();
}
```

### Airbyte セルフホスト

```yaml
# docker-compose.yml (Airbyte)

version: '3.8'
services:
  airbyte:
    image: airbyte/airbyte:latest
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://airbyte:airbyte@db:5432/airbyte
    volumes:
      - airbyte-data:/data

  db:
    image: postgres:14
    environment:
      POSTGRES_USER: airbyte
      POSTGRES_PASSWORD: airbyte
      POSTGRES_DB: airbyte

volumes:
  airbyte-data:
```

カスタムR2ソース作成:

```python
# airbyte-integrations/connectors/source-r2-duckdb/source.py

from airbyte_cdk.sources import AbstractSource
import duckdb

class SourceR2DuckDB(AbstractSource):
    def check_connection(self, logger, config) -> Tuple[bool, any]:
        try:
            conn = duckdb.connect(':memory:')
            conn.execute(f"SELECT * FROM read_parquet('{config['s3_path']}') LIMIT 1")
            return True, None
        except Exception as e:
            return False, e

    def streams(self, config):
        return [R2Stream(config)]
```

---

# DVC (Data Version Control)

## 概要

**DVC**: Git-like data/model versioning for ML/Data pipelines.

**機能:**
- データセット・モデルのバージョン管理
- パイプライン定義・実行
- メトリクストラッキング
- リモートストレージ (R2対応)

## セットアップ

### 1. DVCインストール

```bash
pip install dvc dvc-s3
```

### 2. R2バックエンド設定

```bash
# プロジェクト初期化
dvc init

# R2リモート設定
dvc remote add -d r2 s3://dvc-storage/data
dvc remote modify r2 endpointurl https://xxxxx.r2.cloudflarestorage.com
dvc remote modify r2 access_key_id $R2_ACCESS_KEY_ID
dvc remote modify r2 secret_access_key $R2_SECRET_ACCESS_KEY
```

### 3. データトラッキング

```bash
# 大容量データファイルをDVCで管理
dvc add data/raw/large_dataset.parquet

# Git add (メタデータのみ)
git add data/raw/large_dataset.parquet.dvc .gitignore

# R2にプッシュ
dvc push

# 他の環境でプル
dvc pull
```

### 4. パイプライン定義

```yaml
# dvc.yaml

stages:
  download:
    cmd: python scripts/download_data.py
    outs:
      - data/raw/api_data.json

  transform:
    cmd: python scripts/transform.py
    deps:
      - data/raw/api_data.json
      - scripts/transform.py
    outs:
      - data/processed/transformed.parquet

  train:
    cmd: python scripts/train_model.py
    deps:
      - data/processed/transformed.parquet
      - scripts/train_model.py
    params:
      - train.epochs
      - train.batch_size
    outs:
      - models/model.joblib
    metrics:
      - metrics/train_metrics.json:
          cache: false
```

```bash
# パイプライン実行
dvc repro

# メトリクス比較
dvc metrics show
dvc metrics diff
```

### 5. モデルレジストリ

```bash
# モデルをR2に保存
dvc add models/production_model.joblib
git add models/production_model.joblib.dvc
git commit -m "Add production model v1.2.0"
git tag -a "model-v1.2.0" -m "Production model version 1.2.0"
dvc push

# Workers AIでモデル使用
# (R2から読み取り → 推論)
```

---

# Debezium (CDC)

## 概要

**Debezium**: Change Data Capture (CDC) for databases.

**機能:**
- データベース変更のリアルタイムキャプチャ
- Kafka Connect統合
- 複数DB対応 (PostgreSQL, MySQL, MongoDB, etc.)

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│           PostgreSQL / MySQL (本番DB)                        │
│  - Write-Ahead Log (WAL) / Binary Log                      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼ CDC
┌─────────────────────────────────────────────────────────────┐
│              Debezium Connector                              │
│  - WAL/BinLog読み取り                                        │
│  - 変更イベント生成                                            │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Kafka / Redpanda                                │
│  - トピック: dbserver1.public.users                          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│         Cloudflare Workers (Kafka Consumer)                  │
│  - Kafka → Workers Queues                                   │
│  - 変更をR2に書き込み                                          │
│  - リアルタイム分析                                            │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              R2 (データレイク)                                │
│  - CDC events stored as Parquet                             │
│  - Iceberg table format                                     │
└─────────────────────────────────────────────────────────────┘
```

## セットアップ

### 1. Debezium + Kafka

```yaml
# docker-compose.yml

version: '3.8'
services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    depends_on:
      - zookeeper
    ports:
      - "9092:9092"
    environment:
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092

  debezium:
    image: debezium/connect:2.5
    depends_on:
      - kafka
    ports:
      - "8083:8083"
    environment:
      BOOTSTRAP_SERVERS: kafka:9092
      GROUP_ID: 1
      CONFIG_STORAGE_TOPIC: debezium_configs
      OFFSET_STORAGE_TOPIC: debezium_offsets
      STATUS_STORAGE_TOPIC: debezium_statuses
```

### 2. PostgreSQL Connector設定

```json
{
  "name": "postgres-connector",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "tasks.max": "1",
    "database.hostname": "postgres",
    "database.port": "5432",
    "database.user": "debezium",
    "database.password": "debezium",
    "database.dbname": "production_db",
    "database.server.name": "dbserver1",
    "table.include.list": "public.users,public.orders,public.products",
    "plugin.name": "pgoutput",
    "publication.name": "dbz_publication",
    "slot.name": "debezium"
  }
}
```

```bash
# Connector登録
curl -X POST http://localhost:8083/connectors \
  -H "Content-Type: application/json" \
  -d @postgres-connector.json
```

### 3. Kafka → Workers統合

```javascript
// workers/cdc-consumer/index.js

/**
 * KafkaからCDCイベントを受信してR2に保存
 */

import { Kafka } from 'kafkajs';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(consumeCDCEvents(env));
  }
};

async function consumeCDCEvents(env) {
  const kafka = new Kafka({
    clientId: 'cloudflare-workers',
    brokers: [env.KAFKA_BROKER],
    sasl: {
      mechanism: 'plain',
      username: env.KAFKA_USERNAME,
      password: env.KAFKA_PASSWORD
    }
  });

  const consumer = kafka.consumer({ groupId: 'cdc-to-r2' });

  await consumer.connect();
  await consumer.subscribe({ topics: ['dbserver1.public.users'] });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const event = JSON.parse(message.value.toString());

      // Debeziumイベント解析
      const { op, before, after, ts_ms } = event.payload;

      // R2に保存
      await saveCDCEventToR2(env, {
        operation: op,  // c=create, u=update, d=delete
        table: topic,
        before: before,
        after: after,
        timestamp: new Date(ts_ms).toISOString()
      });
    }
  });
}

async function saveCDCEventToR2(env, cdcEvent) {
  const key = `cdc/${cdcEvent.table}/${cdcEvent.timestamp.split('T')[0]}/${crypto.randomUUID()}.json`;

  await env.CDC_BUCKET.put(key, JSON.stringify(cdcEvent), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      operation: cdcEvent.operation,
      table: cdcEvent.table
    }
  });

  // Analytics Engineに記録
  await env.ANALYTICS.writeDataPoint({
    blobs: ['cdc_event', cdcEvent.operation, cdcEvent.table],
    doubles: [1],
    indexes: [cdcEvent.timestamp]
  });
}
```

### 4. CDC → Iceberg Table

```python
# scripts/cdc_to_iceberg.py

from pyiceberg.catalog import load_catalog
import duckdb

# Icebergカタログ接続
catalog = load_catalog("r2", **{
    "type": "rest",
    "uri": "http://localhost:8181",
    "s3.endpoint": os.getenv("R2_ENDPOINT"),
    "s3.access-key-id": os.getenv("R2_ACCESS_KEY_ID"),
    "s3.secret-access-key": os.getenv("R2_SECRET_ACCESS_KEY")
})

# CDCイベントを読み取り
conn = duckdb.connect(':memory:')
conn.execute("INSTALL httpfs; LOAD httpfs;")
conn.execute(f"SET s3_endpoint='{os.getenv('R2_ENDPOINT')}';")

events = conn.execute("""
    SELECT * FROM read_json_auto('s3://cdc-bucket/cdc/dbserver1.public.users/*/*/*.json')
    WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '1' HOUR
""").fetchall()

# Icebergテーブルにマージ
table = catalog.load_table("cdc.users")

for event in events:
    if event['operation'] == 'c':  # Create
        table.append(event['after'])
    elif event['operation'] == 'u':  # Update
        table.overwrite(event['after'])
    elif event['operation'] == 'd':  # Delete
        table.delete(event['before'])
```

---

## 統合ワークフロー例

### エンドツーエンド: 本番DB → CDC → R2 → dbt → Evidence

```
┌─────────────┐
│ PostgreSQL  │ (本番トランザクションDB)
└──────┬──────┘
       │ WAL
       ▼
┌─────────────┐
│  Debezium   │ (CDC)
└──────┬──────┘
       │ Kafka
       ▼
┌─────────────┐
│   Workers   │ (Kafka Consumer)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ R2 (Bronze) │ (CDC Events)
└──────┬──────┘
       │ dbt
       ▼
┌─────────────┐
│ R2 (Silver) │ (Transformed + PII Masked)
└──────┬──────┘
       │ dbt
       ▼
┌─────────────┐
│ R2 (Gold)   │ (Business Metrics)
└──────┬──────┘
       │ Evidence
       ▼
┌─────────────┐
│  Dashboard  │ (BI Reporting)
└─────────────┘
       │ Reverse ETL
       ▼
┌─────────────┐
│ Salesforce  │ (Operational System)
└─────────────┘
```

---

## GitHub Actions統合

```yaml
# .github/workflows/data-ops.yml

name: Data Operations

on:
  workflow_dispatch:
  schedule:
    - cron: '0 */6 * * *'

jobs:
  dvc-pipeline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup DVC
        run: |
          pip install dvc dvc-s3
          dvc remote modify r2 access_key_id ${{ secrets.R2_ACCESS_KEY_ID }}
          dvc remote modify r2 secret_access_key ${{ secrets.R2_SECRET_ACCESS_KEY }}

      - name: Pull data
        run: dvc pull

      - name: Run pipeline
        run: dvc repro

      - name: Push results
        run: dvc push

  reverse-etl:
    runs-on: ubuntu-latest
    needs: dvc-pipeline
    steps:
      - name: Trigger Workers Cron
        run: |
          curl -X POST https://reverse-etl.yourcompany.workers.dev/sync \
            -H "Authorization: Bearer ${{ secrets.WORKERS_API_KEY }}"
```

---

## ベストプラクティス

### 1. データ品質
- **Elementary**: dbtモデルの品質監視
- **Great Expectations**: Bronze層の生データ検証
- **OpenMetadata**: メタデータカタログ・リネージ

### 2. セキュリティ
- **PII検出**: 全レイヤーでPII自動検出
- **データマスキング**: Silver層でマスキング
- **Cloudflare Access**: ダッシュボード保護

### 3. コスト最適化
- **Evidence**: R2コスト監視ダッシュボード
- **DVC**: 大容量データの効率的バージョン管理
- **Workers Cron**: スケジューラーとしてのコスト削減

### 4. 運用監視
- **OpenLineage**: データフロー可視化
- **Analytics Engine**: メトリクス収集
- **Debezium**: リアルタイム変更追跡

---

## 参考リンク

- [OpenMetadata Docs](https://docs.open-metadata.org/)
- [OpenLineage](https://openlineage.io/)
- [Airbyte](https://airbyte.com/)
- [DVC Documentation](https://dvc.org/doc)
- [Debezium Documentation](https://debezium.io/documentation/)

---

最終更新: 2025-12-26
