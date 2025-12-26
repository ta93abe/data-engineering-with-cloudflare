# ワークフローオーケストレーション完全ガイド

Cloudflareデータ基盤におけるワークフローオーケストレーションの選択肢、比較、実装ガイド。

## 📋 目次

1. [オーケストレーション選択肢の全体像](#オーケストレーション選択肢の全体像)
2. [Cloudflareネイティブアプローチ](#cloudflareネイティブアプローチ)
3. [OSS オーケストレーションツール比較](#ossオーケストレーションツール比較)
4. [推奨構成とユースケース別選択](#推奨構成とユースケース別選択)
5. [実装例](#実装例)

---

## オーケストレーション選択肢の全体像

### 比較マトリクス

| アプローチ | 複雑度 | コスト | Cloudflare統合 | スケーラビリティ | おすすめ度 |
|-----------|--------|--------|----------------|-----------------|-----------|
| **Cloudflare Pipelines** | 低 | $ | ✅ ネイティブ | 高 | ⭐⭐⭐⭐⭐ イベントETL |
| **Workers Cron + Queues** | 低 | $ | ✅ ネイティブ | 高 | ⭐⭐⭐⭐⭐ バッチ処理 |
| **Cloudflare Workflows (Beta)** | 低-中 | $ | ✅ ネイティブ | 高 | ⭐⭐⭐⭐ 今後有望 |
| **Prefect (セルフホスト)** | 中 | $ | 🟡 可能 | 高 | ⭐⭐⭐⭐⭐ バランス良 |
| **Dagster (セルフホスト)** | 中-高 | $$ | 🟡 可能 | 高 | ⭐⭐⭐⭐ データ重視 |
| **Apache Airflow (セルフホスト)** | 高 | $$ | 🟡 可能 | 高 | ⭐⭐⭐ 実績豊富 |
| **Temporal (セルフホスト)** | 高 | $$ | 🟡 可能 | 非常に高 | ⭐⭐⭐⭐ マイクロサービス |
| **Kestra (セルフホスト)** | 低-中 | $ | 🟡 可能 | 中-高 | ⭐⭐⭐⭐ YAML志向 |

---

## Cloudflareネイティブアプローチ

### 1. Cloudflare Pipelines 🆕（イベントストリーミング・ETL特化）

**リアルタイムイベント取り込みとETL処理に最適。**

#### 概要

Cloudflare Pipelines（2025年4月ベータリリース）は、Cloudflare Data Platformの中核コンポーネントで、イベントデータの取り込み、変換、保存を統合的に処理します。

- **R2 Data Catalog**: Apache Iceberg形式のテーブル管理
- **R2 SQL**: DuckDBベースのクエリエンジン
- **Pipelines**: イベント収集・リアルタイム変換

#### 特徴

- ✅ **高速取り込み**: 1パイプラインあたり100 MB/秒
- ✅ **リアルタイムSQL変換**: イベントをその場でフィルタ・変換・エンリッチ
- ✅ **Apache Iceberg対応**: オープンフォーマットでベンダーロックイン回避
- ✅ **Workers統合**: Workersからのイベントストリーミングがネイティブ
- ✅ **オープンベータ**: 現在は無料（ストレージ・クエリは通常料金）

#### アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│          Cloudflare Workers / HTTP API                       │
│          - クリックストリーム                                  │
│          - アプリケーションログ                                │
│          - メトリクス                                         │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Pipelines                            │
│  - SQLベースの変換（フィルタ・エンリッチ）                      │
│  - 自動バッチング                                             │
│  - 重複排除・集約                                             │
└─────────────────────────────────────────────────────────────┘
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
        ┌──────────────┐      ┌──────────────┐
        │Apache Iceberg│      │  R2 Files    │
        │  Tables      │      │  (Parquet)   │
        └──────────────┘      └──────────────┘
                │                     │
                └──────────┬──────────┘
                           ▼
                   ┌──────────────┐
                   │   R2 SQL     │
                   │  (クエリ)     │
                   └──────────────┘
```

#### 使い所

| ユースケース | 説明 |
|-------------|------|
| **クリックストリームデータ** | ウェブサイト・アプリのユーザーイベント収集 |
| **アプリケーションログ** | Workers/APIからのログ集約・検索 |
| **メトリクス収集** | カスタムメトリクスのリアルタイム取り込み |
| **リアルタイムETL** | ソースからR2へのストリーミング変換 |
| **データレイク取り込み** | Apache Iceberg形式でデータレイク構築 |
| **CDNアナリティクス** | Cloudflare CDN経由のリクエストデータ分析 |

#### 実装例

```javascript
// workers/events/clickstream-ingestion.js

/**
 * クリックストリームイベントをPipelinesに送信
 */
export default {
  async fetch(request, env) {
    const event = await request.json();

    // Pipelinesにイベント送信
    await fetch(`https://api.cloudflare.com/pipelines/v1/accounts/${env.ACCOUNT_ID}/pipelines/${env.PIPELINE_ID}/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        events: [{
          timestamp: new Date().toISOString(),
          user_id: event.userId,
          page: event.page,
          action: event.action,
          properties: event.properties
        }]
      })
    });

    return new Response('Event tracked', { status: 200 });
  }
};
```

```sql
-- Pipelines SQL変換設定（例）

-- 生イベントをフィルタ・エンリッチしてIcebergテーブルに保存
SELECT
  timestamp,
  user_id,
  page,
  action,
  CASE
    WHEN action = 'purchase' THEN 'conversion'
    WHEN action = 'add_to_cart' THEN 'engagement'
    ELSE 'other'
  END as event_category,
  properties
FROM events
WHERE action IS NOT NULL
  AND user_id IS NOT NULL
```

#### R2 SQLでのクエリ

```sql
-- Icebergテーブルから分析クエリ
SELECT
  DATE_TRUNC('hour', timestamp) as hour,
  event_category,
  COUNT(*) as event_count,
  COUNT(DISTINCT user_id) as unique_users
FROM clickstream_events
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
GROUP BY hour, event_category
ORDER BY hour DESC, event_count DESC
```

#### いつ使うべきか

- ✅ **イベントストリーミング**: 高頻度イベント（クリック、ログ、メトリクス）
- ✅ **リアルタイム変換**: SQLでその場で処理できる単純な変換
- ✅ **Apache Iceberg**: オープンフォーマットで長期保存・分析
- ❌ **複雑なワークフロー**: 複雑なDAG依存関係がある場合
- ❌ **バッチ処理**: 定期的な大規模バッチ処理（→ Workers Cron + Queues）

---

### 2. Workers Cron + Queues（バッチ処理推奨🏆）

**定期バッチ処理に最もシンプルで費用対効果の高い選択肢。**

#### アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│              Workers Cron (スケジューラー)                    │
│  - cron: "0 */6 * * *"                                      │
│  - トリガー: タスクをQueuesに送信                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Queues                               │
│  - データ取り込みQueue                                        │
│  - 変換処理Queue                                             │
│  - 通知Queue                                                 │
└─────────────────────────────────────────────────────────────┘
                           │
                ┌──────────┼──────────┐
                ▼          ▼          ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Worker 1 │ │ Worker 2 │ │ Worker 3 │
        │ (Ingest) │ │(Transform)│ │ (Notify) │
        └──────────┘ └──────────┘ └──────────┘
```

#### 実装例

```javascript
// workers/orchestrator/cron-scheduler.js

/**
 * Cronスケジューラー - DAG定義とタスク送信
 */
export default {
  async scheduled(event, env, ctx) {
    const cronType = event.cron;  // "0 */6 * * *"

    // DAG定義
    const dags = {
      'data-ingestion-dag': {
        schedule: '0 */6 * * *',
        tasks: [
          { name: 'fetch-api-data', queue: 'ingestion', params: { source: 'api' } },
          { name: 'validate-data', queue: 'validation', params: {} },
          { name: 'write-to-r2', queue: 'storage', params: { layer: 'bronze' } }
        ]
      },
      'transformation-dag': {
        schedule: '30 */6 * * *',
        tasks: [
          { name: 'dbt-run', queue: 'transformation', params: { models: 'staging' } },
          { name: 'dbt-test', queue: 'testing', params: {} }
        ]
      }
    };

    // 該当するDAGを実行
    for (const [dagName, dag] of Object.entries(dags)) {
      if (dag.schedule === cronType) {
        ctx.waitUntil(executeDag(env, dagName, dag));
      }
    }
  }
};

async function executeDag(env, dagName, dag) {
  const runId = crypto.randomUUID();
  console.log(`Starting DAG: ${dagName}, Run ID: ${runId}`);

  for (const task of dag.tasks) {
    try {
      // タスクをQueueに送信
      await env.TASK_QUEUE.send({
        runId,
        dagName,
        taskName: task.name,
        params: task.params,
        timestamp: new Date().toISOString()
      });

      console.log(`Task queued: ${task.name}`);

    } catch (error) {
      console.error(`Failed to queue task ${task.name}:`, error);

      // 失敗をD1に記録
      await env.DB.prepare(`
        INSERT INTO task_failures (run_id, dag_name, task_name, error, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(runId, dagName, task.name, error.message, new Date().toISOString()).run();
    }
  }
}
```

```javascript
// workers/tasks/ingestion-worker.js

/**
 * Queueコンシューマー - データ取り込みタスク
 */
export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      const { runId, taskName, params } = message.body;

      try {
        await executeTask(taskName, params, env);

        // 成功をD1に記録
        await env.DB.prepare(`
          INSERT INTO task_runs (run_id, task_name, status, completed_at)
          VALUES (?, ?, ?, ?)
        `).bind(runId, taskName, 'success', new Date().toISOString()).run();

        message.ack();

      } catch (error) {
        console.error(`Task failed: ${taskName}`, error);

        // リトライまたは失敗記録
        if (message.attempts < 3) {
          message.retry();
        } else {
          await logTaskFailure(env, runId, taskName, error);
          message.ack();
        }
      }
    }
  }
};

async function executeTask(taskName, params, env) {
  switch (taskName) {
    case 'fetch-api-data':
      return await fetchAPIData(params, env);

    case 'validate-data':
      return await validateData(params, env);

    case 'write-to-r2':
      return await writeToR2(params, env);

    default:
      throw new Error(`Unknown task: ${taskName}`);
  }
}
```

#### wrangler設定

```toml
# wrangler-orchestrator.toml

name = "orchestrator"
main = "workers/orchestrator/cron-scheduler.js"
compatibility_date = "2024-01-01"

# Cronトリガー
[triggers]
crons = [
  "0 */6 * * *",   # データ取り込み
  "30 */6 * * *"   # 変換処理
]

# Queues binding
[[queues.producers]]
queue = "task-queue"
binding = "TASK_QUEUE"

# D1 binding
[[d1_databases]]
binding = "DB"
database_name = "orchestration-db"
database_id = "your-d1-database-id"
```

```toml
# wrangler-task-worker.toml

name = "ingestion-worker"
main = "workers/tasks/ingestion-worker.js"
compatibility_date = "2024-01-01"

# Queues consumer
[[queues.consumers]]
queue = "task-queue"
max_batch_size = 10
max_batch_timeout = 30
```

---

### 3. Cloudflare Workflows (Beta) 🆕

**2024年後半にベータリリース予定の新機能。**

#### 特徴

- ✅ ステートフル、長時間実行ワークフロー対応
- ✅ 自動リトライ・エラーハンドリング
- ✅ ビジュアルワークフローエディタ（予定）
- ✅ Durable Objects ベース

#### 想定される使用例

```javascript
// workers/workflows/data-pipeline.js (仮想例)

import { WorkflowEntrypoint, WorkflowStep } from 'cloudflare:workflows';

export class DataPipeline extends WorkflowEntrypoint {
  async run(event, step) {
    // ステップ1: データ取り込み
    const rawData = await step.do('fetch-data', async () => {
      return await fetchFromAPI(event.source);
    });

    // ステップ2: バリデーション
    const validatedData = await step.do('validate', async () => {
      return await validateData(rawData);
    });

    // ステップ3: 変換
    const transformedData = await step.do('transform', async () => {
      return await transformData(validatedData);
    });

    // ステップ4: R2保存
    await step.do('save-to-r2', async () => {
      await saveToR2(transformedData);
    });

    // ステップ5: 通知
    await step.do('notify', async () => {
      await sendSlackNotification('Data pipeline completed');
    });

    return { success: true, recordsProcessed: transformedData.length };
  }
}
```

**注意:** Cloudflare Workflowsはまだベータ版のため、本番利用は慎重に。

---

### 4. Durable Objects でステートフル管理

複雑な依存関係がある場合の選択肢。

```javascript
// workers/orchestrator/workflow-coordinator.js

export class WorkflowCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/start') {
      return await this.startWorkflow(await request.json());
    }

    if (url.pathname === '/status') {
      return await this.getStatus();
    }

    return new Response('Not Found', { status: 404 });
  }

  async startWorkflow(config) {
    const workflowState = {
      id: crypto.randomUUID(),
      status: 'running',
      steps: config.steps.map(s => ({ name: s, status: 'pending' })),
      startedAt: new Date().toISOString()
    };

    await this.state.storage.put('workflow', workflowState);

    // ステップを順次実行
    for (let i = 0; i < config.steps.length; i++) {
      await this.executeStep(i, config.steps[i]);
    }

    return new Response(JSON.stringify({ workflowId: workflowState.id }));
  }

  async executeStep(index, stepName) {
    const workflow = await this.state.storage.get('workflow');

    workflow.steps[index].status = 'running';
    workflow.steps[index].startedAt = new Date().toISOString();
    await this.state.storage.put('workflow', workflow);

    try {
      // Queueにタスク送信
      await this.env.TASK_QUEUE.send({ stepName });

      workflow.steps[index].status = 'completed';
    } catch (error) {
      workflow.steps[index].status = 'failed';
      workflow.steps[index].error = error.message;
    }

    await this.state.storage.put('workflow', workflow);
  }

  async getStatus() {
    const workflow = await this.state.storage.get('workflow');
    return new Response(JSON.stringify(workflow));
  }
}
```

---

## OSS オーケストレーションツール比較

### 1. Prefect ⭐⭐⭐⭐⭐ (最推奨)

**モダンでPythonicなワークフローエンジン（セルフホスト）。**

#### 特徴

- ✅ Python-native、デコレータベース
- ✅ ダイナミックワークフロー（実行時にDAG変更可）
- ✅ セルフホスト可能（Docker/VM）
- ✅ タスクキャッシング、パラメータ化
- ✅ 優れたUI

#### Cloudflare統合例

```python
# flows/data_pipeline.py

from prefect import flow, task
import duckdb
import os

@task(retries=3, retry_delay_seconds=60)
def fetch_from_r2(bucket: str, prefix: str):
    """R2からデータ取得"""
    conn = duckdb.connect(':memory:')
    conn.execute("INSTALL httpfs; LOAD httpfs;")
    conn.execute(f"SET s3_endpoint='{os.getenv('R2_ENDPOINT')}';")

    df = conn.execute(f"""
        SELECT * FROM read_parquet('s3://{bucket}/{prefix}/*.parquet')
    """).df()

    return df

@task
def transform_data(df):
    """データ変換"""
    df['processed_at'] = pd.Timestamp.now()
    df['total'] = df['amount'] * df['quantity']
    return df

@task(retries=2)
def write_to_r2(df, bucket: str, key: str):
    """R2に書き込み（Workers経由）"""
    response = requests.post(
        'https://data-writer.yourcompany.workers.dev/write',
        json={
            'bucket': bucket,
            'key': key,
            'data': df.to_dict('records')
        },
        headers={'Authorization': f'Bearer {os.getenv("WORKERS_API_KEY")}'}
    )
    response.raise_for_status()

@flow(name="r2-data-pipeline")
def r2_data_pipeline(source_bucket: str, target_bucket: str):
    """R2データパイプライン"""

    # 並列実行
    raw_data = fetch_from_r2.submit(source_bucket, 'bronze/raw')

    # 変換
    transformed = transform_data(raw_data.result())

    # 保存
    write_to_r2(transformed, target_bucket, 'silver/processed.parquet')

# スケジュール設定
if __name__ == "__main__":
    r2_data_pipeline.serve(
        name="r2-pipeline-deployment",
        cron="0 */6 * * *"
    )
```

#### デプロイ（セルフホスト）

```bash
# Prefect Serverをローカル起動
prefect server start

# 別ターミナルでエージェント起動
prefect agent start -q default

# または Docker Compose（推奨）
docker-compose up -d
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  prefect-server:
    image: prefecthq/prefect:2-python3.11
    command: prefect server start --host 0.0.0.0
    ports:
      - "4200:4200"
    environment:
      - PREFECT_SERVER_API_HOST=0.0.0.0
    volumes:
      - prefect-data:/root/.prefect

  prefect-agent:
    image: prefecthq/prefect:2-python3.11
    command: prefect agent start -q cloudflare-queue
    environment:
      - PREFECT_API_URL=http://prefect-server:4200/api
      - R2_ENDPOINT=${R2_ENDPOINT}
      - R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
      - R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}
    volumes:
      - ./flows:/flows
    depends_on:
      - prefect-server

volumes:
  prefect-data:
```

---

### 2. Dagster ⭐⭐⭐⭐

**データ資産中心のオーケストレーション（セルフホスト）。**

#### 特徴

- ✅ Asset-oriented（データセット = 第一級市民）
- ✅ ソフトウェアエンジニアリング原則（テスト、型）
- ✅ データリネージ自動追跡
- ✅ パーティション対応
- ✅ セルフホスト可能（Docker/Kubernetes）

#### 実装例

```python
# dagster_project/assets.py

from dagster import asset, AssetExecutionContext
import duckdb
import os

@asset(group_name="bronze")
def raw_api_data(context: AssetExecutionContext):
    """APIから生データ取得してR2に保存"""
    data = fetch_api_data()

    # R2に保存（Workers経由）
    write_to_r2('bronze/api_data.parquet', data)

    context.log.info(f"Fetched {len(data)} records")
    return data

@asset(group_name="silver", deps=[raw_api_data])
def cleaned_data(context: AssetExecutionContext):
    """データクリーニング"""
    conn = duckdb.connect(':memory:')
    conn.execute("INSTALL httpfs; LOAD httpfs;")

    cleaned = conn.execute("""
        SELECT
          id,
          TRIM(name) as name,
          CAST(amount AS DECIMAL(10,2)) as amount
        FROM read_parquet('s3://bronze/api_data.parquet')
        WHERE amount IS NOT NULL
    """).df()

    write_to_r2('silver/cleaned.parquet', cleaned)
    return cleaned

@asset(group_name="gold", deps=[cleaned_data])
def aggregated_metrics(context: AssetExecutionContext):
    """集計メトリクス"""
    conn = duckdb.connect(':memory:')

    metrics = conn.execute("""
        SELECT
          DATE_TRUNC('day', created_at) as date,
          COUNT(*) as total_records,
          SUM(amount) as total_amount
        FROM read_parquet('s3://silver/cleaned.parquet')
        GROUP BY date
    """).df()

    write_to_r2('gold/metrics.parquet', metrics)
    return metrics
```

```python
# dagster_project/jobs.py

from dagster import define_asset_job, ScheduleDefinition

# ジョブ定義
daily_pipeline = define_asset_job(
    name="daily_pipeline",
    selection=["raw_api_data", "cleaned_data", "aggregated_metrics"]
)

# スケジュール
daily_schedule = ScheduleDefinition(
    job=daily_pipeline,
    cron_schedule="0 2 * * *"
)
```

---

### 3. Apache Airflow ⭐⭐⭐

**業界標準、最も普及（セルフホスト）。**

#### 特徴

- ✅ 成熟したエコシステム
- ✅ 豊富なオペレーター（400+）
- ✅ 強力なUI
- ✅ セルフホスト（Docker/Kubernetes）
- ❌ 複雑なセットアップ
- ❌ 重い（リソース消費大）

#### DAG例

```python
# dags/cloudflare_r2_pipeline.py

from airflow import DAG
from airflow.operators.python import PythonOperator
from datetime import datetime, timedelta
import duckdb

default_args = {
    'owner': 'data-team',
    'retries': 3,
    'retry_delay': timedelta(minutes=5)
}

def fetch_from_r2(**context):
    """R2からデータ取得"""
    conn = duckdb.connect(':memory:')
    conn.execute("INSTALL httpfs; LOAD httpfs;")

    data = conn.execute("""
        SELECT * FROM read_parquet('s3://bronze/raw/*.parquet')
    """).fetchall()

    context['ti'].xcom_push(key='raw_data', value=data)

def transform(**context):
    """変換処理"""
    data = context['ti'].xcom_pull(key='raw_data')
    # 変換ロジック
    transformed = process_data(data)
    context['ti'].xcom_push(key='transformed_data', value=transformed)

def load_to_r2(**context):
    """R2に保存"""
    data = context['ti'].xcom_pull(key='transformed_data')
    # Workers経由で保存
    save_via_workers(data)

with DAG(
    'r2_data_pipeline',
    default_args=default_args,
    description='R2 data processing pipeline',
    schedule_interval='0 */6 * * *',
    start_date=datetime(2025, 1, 1),
    catchup=False
) as dag:

    fetch = PythonOperator(
        task_id='fetch_from_r2',
        python_callable=fetch_from_r2
    )

    transform_task = PythonOperator(
        task_id='transform',
        python_callable=transform
    )

    load = PythonOperator(
        task_id='load_to_r2',
        python_callable=load_to_r2
    )

    fetch >> transform_task >> load
```

---

### 4. Temporal ⭐⭐⭐⭐

**マイクロサービス・長時間実行ワークフロー向け（セルフホスト）。**

#### 特徴

- ✅ 非常に堅牢（自動リトライ、タイムアウト）
- ✅ 長時間実行ワークフロー（数日〜数ヶ月）
- ✅ 複雑な状態管理
- ✅ セルフホスト可能（Docker/Kubernetes）
- ❌ 学習曲線が急

#### ワークフロー例

```typescript
// workflows/dataProcessing.ts

import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const { fetchFromR2, transformData, writeToR2 } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '1s',
    maximumAttempts: 3
  }
});

export async function dataProcessingWorkflow(config: WorkflowConfig): Promise<void> {
  // ステップ1
  const rawData = await fetchFromR2(config.sourceBucket);

  // ステップ2（並列実行可能）
  const [transformed1, transformed2] = await Promise.all([
    transformData(rawData, 'model1'),
    transformData(rawData, 'model2')
  ]);

  // ステップ3
  await writeToR2(config.targetBucket, [transformed1, transformed2]);
}
```

---

### 5. Kestra ⭐⭐⭐⭐

**YAML-based、UI重視（セルフホスト）。**

#### 特徴

- ✅ YAMLでワークフロー定義
- ✅ リアルタイム実行ビュー
- ✅ プラグインエコシステム
- ✅ セットアップ簡単（Docker一発）
- ✅ セルフホスト可能

#### フロー定義

```yaml
# flows/r2-data-pipeline.yml

id: r2-data-pipeline
namespace: data-engineering

inputs:
  - name: source_bucket
    type: STRING
    defaults: bronze

  - name: target_bucket
    type: STRING
    defaults: silver

tasks:
  - id: fetch_data
    type: io.kestra.plugin.scripts.python.Script
    script: |
      import duckdb
      conn = duckdb.connect(':memory:')
      conn.execute("INSTALL httpfs; LOAD httpfs;")
      data = conn.execute(f"SELECT * FROM read_parquet('s3://{{ inputs.source_bucket }}/*.parquet')").df()
      print(f"Fetched {len(data)} records")

  - id: transform
    type: io.kestra.plugin.scripts.python.Script
    script: |
      # 変換処理
      transformed = data.copy()
      transformed['processed'] = True

  - id: upload_to_r2
    type: io.kestra.plugin.core.http.Request
    uri: https://data-writer.workers.dev/upload
    method: POST
    body: "{{ outputs.transform.data }}"

triggers:
  - id: daily_schedule
    type: io.kestra.core.models.triggers.types.Schedule
    cron: "0 2 * * *"
```

---

## 推奨構成とユースケース別選択

### シナリオ別推奨

| ユースケース | 推奨ツール | 理由 |
|-------------|-----------|------|
| **イベントストリーミング・ログ収集** | Cloudflare Pipelines | リアルタイムETL、Apache Iceberg対応 |
| **シンプルな定期バッチ** | Workers Cron + Queues | コスト最小、管理不要 |
| **中規模データパイプライン** | Prefect (セルフホスト) | バランス、使いやすい、軽量 |
| **複雑な依存関係・データ資産管理** | Dagster (セルフホスト) | Asset-oriented、リネージ |
| **既存Airflow利用組織** | Apache Airflow (セルフホスト) | 互換性、エコシステム |
| **マイクロサービス連携** | Temporal (セルフホスト) | 堅牢性、長時間実行 |
| **ノーコード志向** | Kestra (セルフホスト) | YAML、UI |

### 推奨アーキテクチャ

#### パターン1: フルCloudflareネイティブ（小〜中規模）

```
Workers Cron → Queues → Workers → R2 → D1
                  ↓
          Durable Objects (状態管理)
```

**メリット:**
- 運用コスト最小
- Cloudflare統合完璧
- スケーラブル

**デメリット:**
- UI/可視化が弱い
- 複雑なDAGは実装大変

---

#### パターン2: Prefect (セルフホスト) + Cloudflare（中〜大規模）🏆

```
┌──────────────────────┐
│ Prefect Server       │ (Docker/VM)
│ - Webダッシュボード   │
│ - スケジューラー      │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Prefect Agent        │ (Docker/VM)
└──────┬───────────────┘
       │
       ▼
┌──────────────────────────────────┐
│   Cloudflare Workers + R2        │
│   - データ処理実行               │
│   - R2読み書き                   │
└──────────────────────────────────┘
```

**セットアップ:**

```yaml
# docker-compose.yml

version: '3.8'
services:
  prefect-server:
    image: prefecthq/prefect:2-python3.11
    command: prefect server start --host 0.0.0.0
    ports:
      - "4200:4200"
    volumes:
      - prefect-data:/root/.prefect

  prefect-agent:
    image: prefecthq/prefect:2-python3.11
    environment:
      - PREFECT_API_URL=http://prefect-server:4200/api
      - R2_ENDPOINT=${R2_ENDPOINT}
      - R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
      - R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}
    command: prefect agent start -q cloudflare-queue
    volumes:
      - ./flows:/flows
    depends_on:
      - prefect-server

volumes:
  prefect-data:
```

**メリット:**
- 強力なUI（セルフホストでも利用可能）
- Cloudflare統合可能
- タスクキャッシング
- 外部SaaS不要

**デメリット:**
- サーバー＋エージェント実行環境必要（VM/Docker）
- サーバーの運用・保守が必要

---

#### パターン3: ハイブリッド（超大規模）

```
┌──────────────┐
│   Dagster    │ (Asset管理・リネージ)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Workers Cron  │ (スケジュール)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Queues     │ (タスクキュー)
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────┐
│   Workers (実行)                  │
│   ↓                              │
│   R2, D1, Vectorize              │
└──────────────────────────────────┘
```

---

## 実装例: Prefect完全統合

### Flowsディレクトリ構造

```
flows/
├── __init__.py
├── config.py
├── tasks/
│   ├── __init__.py
│   ├── r2_operations.py
│   ├── transformations.py
│   └── notifications.py
├── flows/
│   ├── daily_ingestion.py
│   ├── hourly_processing.py
│   └── weekly_aggregation.py
└── deployments/
    └── production.py
```

### R2 Operations

```python
# flows/tasks/r2_operations.py

from prefect import task
import duckdb
import os
import requests

@task(name="read-from-r2", retries=3)
def read_from_r2(bucket: str, prefix: str):
    """R2からParquetデータ読み取り"""
    conn = duckdb.connect(':memory:')
    conn.execute("INSTALL httpfs; LOAD httpfs;")
    conn.execute(f"SET s3_endpoint='{os.getenv('R2_ENDPOINT')}';")
    conn.execute(f"SET s3_access_key_id='{os.getenv('R2_ACCESS_KEY_ID')}';")
    conn.execute(f"SET s3_secret_access_key='{os.getenv('R2_SECRET_ACCESS_KEY')}';")

    df = conn.execute(f"""
        SELECT * FROM read_parquet('s3://{bucket}/{prefix}/**/*.parquet')
    """).df()

    return df

@task(name="write-to-r2-via-worker", retries=2)
def write_to_r2_via_worker(data, bucket: str, key: str):
    """Workers経由でR2に書き込み"""
    response = requests.post(
        f"{os.getenv('WORKERS_API_URL')}/write",
        json={
            'bucket': bucket,
            'key': key,
            'data': data.to_dict('records')
        },
        headers={
            'Authorization': f"Bearer {os.getenv('WORKERS_API_KEY')}"
        },
        timeout=300
    )

    response.raise_for_status()
    return response.json()
```

### メインフロー

```python
# flows/flows/daily_ingestion.py

from prefect import flow
from prefect.tasks import task_input_hash
from datetime import timedelta
from tasks.r2_operations import read_from_r2, write_to_r2_via_worker
from tasks.transformations import clean_data, enrich_data
from tasks.notifications import send_slack_notification

@flow(
    name="daily-data-ingestion",
    description="Daily data ingestion and transformation pipeline",
    log_prints=True
)
def daily_ingestion_flow(date: str):
    """日次データ取り込みフロー"""

    # 並列でソースデータ取得
    api_data = read_from_r2.submit("bronze", f"api/{date}")
    db_data = read_from_r2.submit("bronze", f"database/{date}")

    # 待機
    api_result = api_data.result()
    db_result = db_data.result()

    # データクリーニング（並列）
    cleaned_api = clean_data.submit(api_result)
    cleaned_db = clean_data.submit(db_result)

    # エンリッチメント
    enriched = enrich_data(
        cleaned_api.result(),
        cleaned_db.result()
    )

    # Silverレイヤーに保存
    write_result = write_to_r2_via_worker(
        enriched,
        "silver",
        f"enriched/{date}/data.parquet"
    )

    # 通知
    send_slack_notification(
        f"✅ Daily ingestion completed: {len(enriched)} records processed"
    )

    return write_result
```

### デプロイ

```python
# flows/deployments/production.py

from flows.daily_ingestion import daily_ingestion_flow
from prefect.deployments import Deployment
from prefect.server.schemas.schedules import CronSchedule

deployment = Deployment.build_from_flow(
    flow=daily_ingestion_flow,
    name="production-daily-ingestion",
    work_queue_name="cloudflare-queue",
    schedule=CronSchedule(cron="0 2 * * *", timezone="UTC"),
    parameters={"date": "{{ ds }}"},
    tags=["production", "daily", "r2"]
)

if __name__ == "__main__":
    deployment.apply()
```

```bash
# デプロイ実行
python flows/deployments/production.py

# エージェント起動
prefect agent start -q cloudflare-queue
```

---

## モニタリング・可視化

### Prefect UI

- リアルタイム実行状況
- タスク依存関係グラフ
- 失敗アラート
- パフォーマンスメトリクス

### カスタムダッシュボード（Evidence）

```sql
-- flows/monitoring/task_metrics.sql

SELECT
  flow_name,
  DATE_TRUNC('day', start_time) as date,
  COUNT(*) as total_runs,
  SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as successful,
  SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
  AVG(DATEDIFF('second', start_time, end_time)) as avg_duration_seconds
FROM prefect_flow_runs
WHERE start_time >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY flow_name, date
ORDER BY date DESC, flow_name
```

---

## ベストプラクティス

### 1. べき等性

```python
@task
def write_with_idempotency(data, partition_key):
    """べき等な書き込み"""
    # パーティションキーで既存データを上書き
    key = f"silver/data/{partition_key}/data.parquet"
    write_to_r2(data, key)  # 同じキーなら上書き
```

### 2. エラーハンドリング

```python
@task(retries=3, retry_delay_seconds=[10, 60, 300])
def resilient_task():
    """段階的なリトライ遅延"""
    try:
        return risky_operation()
    except TemporaryError:
        raise  # リトライ
    except PermanentError as e:
        log_to_slack(f"Permanent failure: {e}")
        raise  # 失敗として記録
```

### 3. リソース管理

```python
@task(tags=["heavy-compute"])
def cpu_intensive_task():
    """重い処理はタグ付け"""
    # 専用ワーカーで実行
    pass
```

---

## コスト比較（セルフホスト前提）

| 構成 | 月間コスト（概算） | 内訳 |
|------|------------------|------|
| **Cloudflare Pipelines** | $0-10 | ベータ期間中無料、ストレージ・クエリのみ課金 |
| **Workers Cron + Queues** | $5-20 | Workers実行費のみ |
| **Prefect (セルフホスト)** | $30-100 | VM/Docker (2-4 vCPU, 4-8GB RAM) |
| **Dagster (セルフホスト)** | $50-150 | VM/Docker (4-8 vCPU, 8-16GB RAM) |
| **Airflow (セルフホスト)** | $50-200 | VM/K8s (4-8 vCPU, 8-16GB RAM) |
| **Temporal (セルフホスト)** | $100-300 | VM/K8s (8+ vCPU, 16+ GB RAM) |
| **Kestra (セルフホスト)** | $30-80 | VM/Docker (2-4 vCPU, 4-8GB RAM) |

**注意:**
- すべて外部SaaS不要のセルフホスト構成
- コストはVMまたはDockerホスティング費用（AWS/GCP/Azure EC2/Compute Engine等）
- Cloudflare Workersのコストは別途

---

## まとめ

### 推奨構成（すべてセルフホスト）

#### 💚 イベントストリーミング・リアルタイムETL
→ **Cloudflare Pipelines**（ベータ期間中無料）

#### 💙 スタートアップ・中小規模バッチ処理
→ **Workers Cron + Queues**（最もシンプル）

#### 💜 成長企業・中規模データパイプライン
→ **Prefect (セルフホスト) + Cloudflare Workers**

#### 🧡 大企業・複雑なパイプライン
→ **Dagster (セルフホスト)** または **Airflow (セルフホスト)** + Cloudflare

**すべての構成で外部SaaSは不要。セルフホストで完全にコントロール可能。**

---

## 参考リンク

### Cloudflareネイティブ
- [Cloudflare Pipelines](https://developers.cloudflare.com/pipelines/)
- [Cloudflare Data Platform](https://blog.cloudflare.com/cloudflare-data-platform/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)

### OSSツール（すべてセルフホスト可能）
- [Prefect Documentation](https://docs.prefect.io/)
- [Dagster Documentation](https://docs.dagster.io/)
- [Apache Airflow](https://airflow.apache.org/)
- [Temporal](https://temporal.io/)
- [Kestra](https://kestra.io/)

---

最終更新: 2025-12-26
