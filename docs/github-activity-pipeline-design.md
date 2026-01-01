# GitHub Activity Pipeline 設計ドキュメント

## 1. 概要

### 1.1 目的

GitHubの活動ログ（リポジトリイベント、コミット、プルリクエスト、Issue等）を定期的に収集し、Cloudflare R2にDuckDB/Parquet形式で保存することで、開発チームのアクティビティを分析・可視化する基盤を構築します。

### 1.2 主な機能

- **自動収集**: Workers Cronによる定期的なGitHub API呼び出し
- **増分同期**: 前回取得以降の差分データのみを効率的に取得
- **スケーラブル**: 複数リポジトリ・組織に対応
- **分析最適化**: DuckDB/Parquet形式でクエリパフォーマンスを最適化
- **コスト効率**: R2のエグレス無料を活用

### 1.3 ユースケース

- 開発者の生産性分析
- コードレビュー時間の可視化
- リポジトリアクティビティのトレンド分析
- チームコラボレーションメトリクス
- CI/CDパイプラインの成功率追跡

## 2. GitHubデータソース

### 2.1 GitHub Events API

**対象イベントタイプ**:

| イベント | API エンドポイント | 収集頻度 | データサイズ (概算) |
|---------|------------------|---------|-------------------|
| **Repository Events** | `/repos/{owner}/{repo}/events` | 15分 | 10-100 KB/リポジトリ |
| **Pull Requests** | `/repos/{owner}/{repo}/pulls` | 30分 | 50-500 KB/リポジトリ |
| **Issues** | `/repos/{owner}/{repo}/issues` | 30分 | 20-200 KB/リポジトリ |
| **Commits** | `/repos/{owner}/{repo}/commits` | 1時間 | 100 KB-2 MB/リポジトリ |
| **Workflows** | `/repos/{owner}/{repo}/actions/runs` | 30分 | 50-500 KB/リポジトリ |
| **Code Reviews** | `/repos/{owner}/{repo}/pulls/{number}/reviews` | 1時間 | 10-100 KB/PR |
| **Contributors** | `/repos/{owner}/{repo}/contributors` | 1日 | 10-50 KB/リポジトリ |

### 2.2 GitHub API制限

| プラン | レート制限 | 認証 | 備考 |
|-------|----------|------|------|
| **認証済み** | 5,000 リクエスト/時 | Personal Access Token | 推奨 |
| **GitHub App** | 15,000 リクエスト/時 | インストールトークン | 大規模組織向け |
| **未認証** | 60 リクエスト/時 | なし | 非推奨 |

**レート制限ヘッダー**:
- `X-RateLimit-Limit`: 制限値
- `X-RateLimit-Remaining`: 残りリクエスト数
- `X-RateLimit-Reset`: リセット時刻（UNIX timestamp）

### 2.3 データスキーマ例

#### Repository Events

```json
{
  "id": "12345678901",
  "type": "PushEvent",
  "actor": {
    "id": 123456,
    "login": "octocat",
    "avatar_url": "https://avatars.githubusercontent.com/u/123456"
  },
  "repo": {
    "id": 78910,
    "name": "octocat/Hello-World",
    "url": "https://api.github.com/repos/octocat/Hello-World"
  },
  "payload": {
    "push_id": 1234567890,
    "size": 1,
    "ref": "refs/heads/main",
    "commits": [...]
  },
  "created_at": "2025-01-01T12:00:00Z"
}
```

#### Pull Request

```json
{
  "id": 987654321,
  "number": 42,
  "state": "open",
  "title": "Add new feature",
  "user": {
    "login": "developer",
    "id": 111222
  },
  "created_at": "2025-01-01T10:00:00Z",
  "updated_at": "2025-01-01T14:00:00Z",
  "merged_at": null,
  "head": {
    "ref": "feature-branch",
    "sha": "abc123def456"
  },
  "base": {
    "ref": "main",
    "sha": "def456abc789"
  },
  "additions": 150,
  "deletions": 20,
  "changed_files": 5
}
```

## 3. アーキテクチャ設計

### 3.1 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub API                               │
│  - Repository Events      - Pull Requests     - Actions         │
│  - Issues                 - Commits           - Contributors    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Cloudflare Workers Cron                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  github-events-collector (15分ごと)                      │   │
│  │  github-pr-collector (30分ごと)                          │   │
│  │  github-commits-collector (1時間ごと)                    │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Data Processing Workers                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  - Rate Limit Management                                 │   │
│  │  - Data Transformation                                   │   │
│  │  - Deduplication                                         │   │
│  │  - Schema Validation                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────┼────────────┐
                ▼            ▼            ▼
┌──────────────────┐  ┌──────────┐  ┌─────────────────────────┐
│   Workers KV     │  │    D1    │  │     R2 Storage          │
│                  │  │          │  │                         │
│ - API Tokens     │  │- State   │  │ Medallion Architecture: │
│ - Rate Limits    │  │- Metadata│  │                         │
│ - Last Sync Time │  │- Config  │  │ bronze/                 │
│                  │  │          │  │   github_events/        │
└──────────────────┘  └──────────┘  │     year=2025/          │
                                    │       month=01/         │
                                    │         day=01/         │
                                    │   github_pulls/         │
                                    │   github_commits/       │
                                    │                         │
                                    │ silver/                 │
                                    │   github_events_clean/  │
                                    │   pr_metrics/           │
                                    │                         │
                                    │ gold/                   │
                                    │   developer_activity/   │
                                    │   repo_metrics/         │
                                    │   team_stats/           │
                                    └─────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   DuckDB Query Layer                            │
│  - R2 SQL (Native DuckDB integration)                           │
│  - Parquet file scanning                                        │
│  - Partitioned queries (year/month/day)                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Analytics & Visualization                      │
│  - Evidence Dashboard (Team Metrics)                            │
│  - marimo Notebooks (Ad-hoc Analysis)                           │
│  - dbt Transformations (Silver → Gold)                          │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 データフロー

#### 3.2.1 収集フロー

```
1. Workers Cron Trigger (15分/30分/1時間ごと)
        │
        ▼
2. KV: Last Sync Timeを取得
        │
        ▼
3. GitHub API: 増分データ取得
   - If-Modified-Since ヘッダー使用
   - ETags活用
        │
        ▼
4. Rate Limit Check (KVでトラッキング)
   - Remaining < 100 → スキップ
   - Remaining >= 100 → 続行
        │
        ▼
5. Data Transformation
   - JSON → Parquet変換
   - タイムゾーン正規化 (UTC)
   - Null値処理
   - スキーマ検証
        │
        ▼
6. R2へ書き込み
   - パーティション: year/month/day
   - ファイル命名: {event_type}_{timestamp}_{uuid}.parquet
        │
        ▼
7. D1: メタデータ更新
   - last_sync_time
   - records_count
   - file_path
        │
        ▼
8. KV: Last Sync Time更新
```

#### 3.2.2 変換フロー (dbt)

```
Bronze (Raw)
    │
    ├→ dbt: github_events_clean
    │   - 重複除去
    │   - 無効データフィルタ
    │   - カラム標準化
    │
    ▼
Silver (Cleaned)
    │
    ├→ dbt: pr_metrics
    │   - PR作成からマージまでの時間
    │   - レビュー時間
    │   - コメント数
    │
    ├→ dbt: commit_metrics
    │   - 1日あたりのコミット数
    │   - 変更行数統計
    │   - ファイルタイプ別分析
    │
    ▼
Gold (Aggregated)
    │
    ├→ developer_activity (開発者別)
    ├→ repo_metrics (リポジトリ別)
    ├→ team_stats (チーム別)
    └→ weekly_summary (週次サマリー)
```

### 3.3 ストレージ構造

#### R2バケット構成

```
github-data-lake/
├── bronze/
│   ├── github_events/
│   │   ├── year=2025/
│   │   │   ├── month=01/
│   │   │   │   ├── day=01/
│   │   │   │   │   ├── push_events_20250101_120000_abc123.parquet
│   │   │   │   │   ├── pull_request_events_20250101_120000_def456.parquet
│   │   │   │   │   └── ...
│   │   │   │   ├── day=02/
│   │   │   │   └── ...
│   │   │   └── month=02/
│   │   └── year=2024/
│   ├── github_pulls/
│   │   └── year=2025/...
│   ├── github_commits/
│   │   └── year=2025/...
│   └── github_workflows/
│       └── year=2025/...
│
├── silver/
│   ├── github_events_clean/
│   │   └── year=2025/...
│   ├── pr_metrics/
│   │   └── year=2025/...
│   └── commit_metrics/
│       └── year=2025/...
│
└── gold/
    ├── developer_activity/
    │   └── year=2025/...
    ├── repo_metrics/
    │   └── year=2025/...
    └── team_stats/
        └── year=2025/...
```

#### Parquet スキーマ (Events)

```sql
CREATE TABLE github_events (
    event_id VARCHAR PRIMARY KEY,
    event_type VARCHAR NOT NULL,
    actor_id BIGINT,
    actor_login VARCHAR,
    repo_id BIGINT,
    repo_name VARCHAR,
    payload JSON,
    created_at TIMESTAMP,
    org VARCHAR,
    -- パーティションキー
    year INTEGER,
    month INTEGER,
    day INTEGER,
    -- メタデータ
    ingested_at TIMESTAMP,
    source_file VARCHAR
);
```

#### Parquet スキーマ (Pull Requests)

```sql
CREATE TABLE github_pulls (
    pull_id BIGINT PRIMARY KEY,
    number INTEGER,
    repo_name VARCHAR,
    state VARCHAR,
    title VARCHAR,
    user_login VARCHAR,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    closed_at TIMESTAMP,
    merged_at TIMESTAMP,
    head_ref VARCHAR,
    base_ref VARCHAR,
    additions INTEGER,
    deletions INTEGER,
    changed_files INTEGER,
    commits INTEGER,
    comments INTEGER,
    review_comments INTEGER,
    -- 派生メトリクス
    time_to_merge_hours DOUBLE,
    time_to_first_review_hours DOUBLE,
    -- パーティション
    year INTEGER,
    month INTEGER,
    day INTEGER,
    -- メタデータ
    ingested_at TIMESTAMP
);
```

## 4. 実装詳細

### 4.1 Workers実装

#### 4.1.1 イベント収集Worker

**ファイル**: `src/workers/github-events-collector.ts`

```typescript
interface Env {
  GITHUB_TOKEN: string;
  GITHUB_DATA_BUCKET: R2Bucket;
  GITHUB_STATE_KV: KVNamespace;
  GITHUB_METADATA_DB: D1Database;
  GITHUB_ANALYTICS: AnalyticsEngineDataset;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const repos = await getTargetRepos(env);

    for (const repo of repos) {
      try {
        await collectEvents(repo, env);
      } catch (error) {
        console.error(`Failed to collect events for ${repo}:`, error);
        await logError(env, repo, error);
      }
    }
  }
};

async function collectEvents(repo: string, env: Env) {
  // 1. 前回同期時刻を取得
  const lastSync = await env.GITHUB_STATE_KV.get(`last_sync:${repo}`);

  // 2. レート制限チェック
  const rateLimit = await checkRateLimit(env);
  if (rateLimit.remaining < 100) {
    console.log('Rate limit low, skipping');
    return;
  }

  // 3. GitHub APIから増分データ取得
  const events = await fetchGitHubEvents(repo, lastSync, env.GITHUB_TOKEN);

  if (events.length === 0) {
    console.log('No new events');
    return;
  }

  // 4. Parquet形式に変換
  const parquetBuffer = await convertToParquet(events);

  // 5. R2に保存（パーティション構造）
  const now = new Date();
  const path = `bronze/github_events/year=${now.getUTCFullYear()}/month=${
    String(now.getUTCMonth() + 1).padStart(2, '0')
  }/day=${String(now.getUTCDate()).padStart(2, '0')}/events_${
    Date.now()
  }_${crypto.randomUUID()}.parquet`;

  await env.GITHUB_DATA_BUCKET.put(path, parquetBuffer);

  // 6. メタデータをD1に保存
  await env.GITHUB_METADATA_DB.prepare(`
    INSERT INTO ingestion_log (repo, event_type, count, file_path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(repo, 'events', events.length, path, now.toISOString()).run();

  // 7. 同期時刻を更新
  await env.GITHUB_STATE_KV.put(`last_sync:${repo}`, now.toISOString());

  // 8. メトリクスを記録
  env.GITHUB_ANALYTICS.writeDataPoint({
    blobs: ['github_ingestion', repo, 'events'],
    doubles: [events.length, parquetBuffer.byteLength],
    indexes: ['ingestion_timestamp']
  });
}
```

#### 4.1.2 GitHub API クライアント

**ファイル**: `src/workers/lib/github-client.ts`

```typescript
interface GitHubClientOptions {
  token: string;
  baseUrl?: string;
}

export class GitHubClient {
  private token: string;
  private baseUrl: string;

  constructor(options: GitHubClientOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl || 'https://api.github.com';
  }

  async fetchEvents(
    repo: string,
    since?: string,
    etag?: string
  ): Promise<{ events: any[]; etag: string; rateLimit: RateLimit }> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (since) {
      headers['If-Modified-Since'] = since;
    }

    if (etag) {
      headers['If-None-Match'] = etag;
    }

    const response = await fetch(
      `${this.baseUrl}/repos/${repo}/events`,
      { headers }
    );

    // レート制限情報を取得
    const rateLimit = {
      limit: parseInt(response.headers.get('X-RateLimit-Limit') || '0'),
      remaining: parseInt(response.headers.get('X-RateLimit-Remaining') || '0'),
      reset: parseInt(response.headers.get('X-RateLimit-Reset') || '0'),
    };

    // 304 Not Modified
    if (response.status === 304) {
      return { events: [], etag: etag || '', rateLimit };
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const events = await response.json();
    const newEtag = response.headers.get('ETag') || '';

    return { events, etag: newEtag, rateLimit };
  }

  async fetchPullRequests(
    repo: string,
    state: 'open' | 'closed' | 'all' = 'all',
    since?: string
  ): Promise<any[]> {
    const params = new URLSearchParams({
      state,
      sort: 'updated',
      direction: 'desc',
      per_page: '100',
    });

    if (since) {
      params.set('since', since);
    }

    const response = await fetch(
      `${this.baseUrl}/repos/${repo}/pulls?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github+json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return response.json();
  }

  async fetchCommits(
    repo: string,
    since?: string,
    until?: string
  ): Promise<any[]> {
    const params = new URLSearchParams({
      per_page: '100',
    });

    if (since) params.set('since', since);
    if (until) params.set('until', until);

    const response = await fetch(
      `${this.baseUrl}/repos/${repo}/commits?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github+json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return response.json();
  }
}
```

#### 4.1.3 Parquet変換

**ファイル**: `src/workers/lib/parquet-writer.ts`

```typescript
import { Table, vectorFromArray, tableToIPC } from 'apache-arrow';

export async function convertToParquet(events: any[]): Promise<Uint8Array> {
  // Apache Arrowを使ってParquet形式に変換
  const schema = {
    event_id: vectorFromArray(events.map(e => e.id)),
    event_type: vectorFromArray(events.map(e => e.type)),
    actor_id: vectorFromArray(events.map(e => e.actor.id)),
    actor_login: vectorFromArray(events.map(e => e.actor.login)),
    repo_id: vectorFromArray(events.map(e => e.repo.id)),
    repo_name: vectorFromArray(events.map(e => e.repo.name)),
    payload: vectorFromArray(events.map(e => JSON.stringify(e.payload))),
    created_at: vectorFromArray(events.map(e => new Date(e.created_at))),
    year: vectorFromArray(events.map(e => new Date(e.created_at).getUTCFullYear())),
    month: vectorFromArray(events.map(e => new Date(e.created_at).getUTCMonth() + 1)),
    day: vectorFromArray(events.map(e => new Date(e.created_at).getUTCDate())),
    ingested_at: vectorFromArray(events.map(() => new Date())),
  };

  const table = new Table(schema);
  const buffer = tableToIPC(table);

  return new Uint8Array(buffer);
}
```

### 4.2 D1スキーマ設計

**ファイル**: `migrations/0001_github_metadata.sql`

```sql
-- リポジトリ設定
CREATE TABLE repositories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL UNIQUE,
    owner VARCHAR(255) NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    sync_events BOOLEAN DEFAULT TRUE,
    sync_pulls BOOLEAN DEFAULT TRUE,
    sync_commits BOOLEAN DEFAULT TRUE,
    sync_workflows BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- インジェストログ
CREATE TABLE ingestion_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    count INTEGER NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size_bytes INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'success'
);

CREATE INDEX idx_ingestion_log_repo ON ingestion_log(repo);
CREATE INDEX idx_ingestion_log_created ON ingestion_log(created_at);

-- レート制限トラッキング
CREATE TABLE rate_limit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remaining INTEGER NOT NULL,
    reset_at TIMESTAMP NOT NULL,
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 同期状態管理
CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo VARCHAR(255) NOT NULL,
    sync_type VARCHAR(50) NOT NULL,
    last_sync_at TIMESTAMP,
    last_event_id VARCHAR(100),
    etag VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(repo, sync_type)
);

CREATE INDEX idx_sync_state_repo ON sync_state(repo);

-- エラーログ
CREATE TABLE error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo VARCHAR(255),
    worker_name VARCHAR(100),
    error_message TEXT,
    error_stack TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_error_log_created ON error_log(created_at);
```

### 4.3 Workers Cron設定

**ファイル**: `wrangler.toml`

```toml
name = "github-activity-pipeline"
main = "src/workers/github-events-collector.ts"
compatibility_date = "2025-01-01"

# イベント収集（15分ごと）
[triggers]
crons = ["*/15 * * * *"]

# R2バケット
[[r2_buckets]]
binding = "GITHUB_DATA_BUCKET"
bucket_name = "github-data-lake"

# KV（状態管理）
[[kv_namespaces]]
binding = "GITHUB_STATE_KV"
id = "github_state_kv_prod"

# D1（メタデータ）
[[d1_databases]]
binding = "GITHUB_METADATA_DB"
database_name = "github_metadata"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Analytics Engine
[[analytics_engine_datasets]]
binding = "GITHUB_ANALYTICS"

# 環境変数
[vars]
GITHUB_REPOS = '["owner1/repo1", "owner2/repo2"]'

# シークレット（wrangler secret putで設定）
# GITHUB_TOKEN
```

**追加のWorker設定** (`wrangler.github-pr-collector.toml`):

```toml
name = "github-pr-collector"
main = "src/workers/github-pr-collector.ts"
compatibility_date = "2025-01-01"

# PRデータ収集（30分ごと）
[triggers]
crons = ["*/30 * * * *"]

# 同じバインディングを使用
[[r2_buckets]]
binding = "GITHUB_DATA_BUCKET"
bucket_name = "github-data-lake"

[[kv_namespaces]]
binding = "GITHUB_STATE_KV"
id = "github_state_kv_prod"

[[d1_databases]]
binding = "GITHUB_METADATA_DB"
database_name = "github_metadata"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

[[analytics_engine_datasets]]
binding = "GITHUB_ANALYTICS"

[vars]
GITHUB_REPOS = '["owner1/repo1", "owner2/repo2"]'
```

## 5. dbt変換実装

### 5.1 dbtプロジェクト構成

```
dbt_project/
├── models/
│   ├── bronze/
│   │   └── _bronze_schema.yml
│   ├── silver/
│   │   ├── github_events_clean.sql
│   │   ├── pr_metrics.sql
│   │   ├── commit_metrics.sql
│   │   └── _silver_schema.yml
│   └── gold/
│       ├── developer_activity.sql
│       ├── repo_metrics.sql
│       ├── team_stats.sql
│       └── _gold_schema.yml
├── macros/
│   └── github_helpers.sql
└── dbt_project.yml
```

### 5.2 Silver Layer: PR Metrics

**ファイル**: `models/silver/pr_metrics.sql`

```sql
{{
  config(
    materialized='incremental',
    unique_key='pull_id',
    partition_by={
      'field': 'merged_at',
      'data_type': 'timestamp',
      'granularity': 'day'
    }
  )
}}

WITH pull_requests AS (
  SELECT
    pull_id,
    number,
    repo_name,
    state,
    title,
    user_login,
    created_at,
    updated_at,
    closed_at,
    merged_at,
    head_ref,
    base_ref,
    additions,
    deletions,
    changed_files,
    commits,
    comments,
    review_comments
  FROM read_parquet('s3://github-data-lake/bronze/github_pulls/**/*.parquet')
  {% if is_incremental() %}
  WHERE updated_at > (SELECT MAX(updated_at) FROM {{ this }})
  {% endif %}
),

enriched AS (
  SELECT
    *,
    -- 作成からマージまでの時間（時間単位）
    CASE
      WHEN merged_at IS NOT NULL THEN
        EXTRACT(EPOCH FROM (merged_at - created_at)) / 3600.0
      ELSE NULL
    END AS time_to_merge_hours,

    -- 作成からクローズまでの時間
    CASE
      WHEN closed_at IS NOT NULL THEN
        EXTRACT(EPOCH FROM (closed_at - created_at)) / 3600.0
      ELSE NULL
    END AS time_to_close_hours,

    -- 変更行数の合計
    additions + deletions AS total_changes,

    -- コードチャーン（削除/追加比率）
    CASE
      WHEN additions > 0 THEN
        CAST(deletions AS DOUBLE) / additions
      ELSE 0
    END AS code_churn_ratio,

    -- PRサイズカテゴリ
    CASE
      WHEN (additions + deletions) < 10 THEN 'XS'
      WHEN (additions + deletions) < 100 THEN 'S'
      WHEN (additions + deletions) < 500 THEN 'M'
      WHEN (additions + deletions) < 1000 THEN 'L'
      ELSE 'XL'
    END AS pr_size_category,

    -- 週末PR判定
    CASE
      WHEN EXTRACT(DOW FROM created_at) IN (0, 6) THEN TRUE
      ELSE FALSE
    END AS is_weekend_pr,

    CURRENT_TIMESTAMP AS processed_at
  FROM pull_requests
)

SELECT * FROM enriched
```

### 5.3 Gold Layer: Developer Activity

**ファイル**: `models/gold/developer_activity.sql`

```sql
{{
  config(
    materialized='table',
    partition_by={
      'field': 'date',
      'data_type': 'date',
      'granularity': 'day'
    }
  )
}}

WITH daily_commits AS (
  SELECT
    author_login AS developer,
    DATE(created_at) AS date,
    COUNT(*) AS commit_count,
    SUM(additions) AS lines_added,
    SUM(deletions) AS lines_deleted,
    COUNT(DISTINCT repo_name) AS repos_touched
  FROM read_parquet('s3://github-data-lake/bronze/github_commits/**/*.parquet')
  WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
  GROUP BY author_login, DATE(created_at)
),

daily_prs AS (
  SELECT
    user_login AS developer,
    DATE(created_at) AS date,
    COUNT(*) AS prs_created,
    COUNT(CASE WHEN merged_at IS NOT NULL THEN 1 END) AS prs_merged,
    AVG(time_to_merge_hours) AS avg_time_to_merge_hours,
    SUM(additions + deletions) AS total_code_changes
  FROM {{ ref('pr_metrics') }}
  WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
  GROUP BY user_login, DATE(created_at)
),

daily_reviews AS (
  SELECT
    reviewer_login AS developer,
    DATE(submitted_at) AS date,
    COUNT(*) AS reviews_submitted,
    COUNT(CASE WHEN state = 'APPROVED' THEN 1 END) AS reviews_approved,
    COUNT(CASE WHEN state = 'CHANGES_REQUESTED' THEN 1 END) AS reviews_changes_requested
  FROM read_parquet('s3://github-data-lake/bronze/github_reviews/**/*.parquet')
  WHERE submitted_at >= CURRENT_DATE - INTERVAL '90 days'
  GROUP BY reviewer_login, DATE(submitted_at)
),

combined AS (
  SELECT
    COALESCE(c.developer, p.developer, r.developer) AS developer,
    COALESCE(c.date, p.date, r.date) AS date,
    COALESCE(c.commit_count, 0) AS commits,
    COALESCE(c.lines_added, 0) AS lines_added,
    COALESCE(c.lines_deleted, 0) AS lines_deleted,
    COALESCE(c.repos_touched, 0) AS repos_touched,
    COALESCE(p.prs_created, 0) AS prs_created,
    COALESCE(p.prs_merged, 0) AS prs_merged,
    COALESCE(p.avg_time_to_merge_hours, 0) AS avg_pr_merge_time_hours,
    COALESCE(p.total_code_changes, 0) AS total_pr_changes,
    COALESCE(r.reviews_submitted, 0) AS reviews_submitted,
    COALESCE(r.reviews_approved, 0) AS reviews_approved,
    COALESCE(r.reviews_changes_requested, 0) AS reviews_changes_requested
  FROM daily_commits c
  FULL OUTER JOIN daily_prs p
    ON c.developer = p.developer AND c.date = p.date
  FULL OUTER JOIN daily_reviews r
    ON COALESCE(c.developer, p.developer) = r.developer
    AND COALESCE(c.date, p.date) = r.date
)

SELECT
  developer,
  date,
  commits,
  lines_added,
  lines_deleted,
  lines_added + lines_deleted AS total_lines_changed,
  repos_touched,
  prs_created,
  prs_merged,
  CASE
    WHEN prs_created > 0 THEN
      CAST(prs_merged AS DOUBLE) / prs_created
    ELSE 0
  END AS pr_merge_rate,
  avg_pr_merge_time_hours,
  total_pr_changes,
  reviews_submitted,
  reviews_approved,
  reviews_changes_requested,

  -- アクティビティスコア（重み付け合計）
  (commits * 1.0) +
  (prs_created * 3.0) +
  (prs_merged * 5.0) +
  (reviews_submitted * 2.0) +
  (lines_added / 100.0) AS activity_score,

  CURRENT_TIMESTAMP AS processed_at
FROM combined
ORDER BY date DESC, developer
```

## 6. DuckDB分析クエリ

### 6.1 R2 SQLでの分析

```sql
-- 過去30日の開発者別アクティビティランキング
SELECT
  developer,
  SUM(commits) AS total_commits,
  SUM(prs_created) AS total_prs,
  SUM(prs_merged) AS total_prs_merged,
  SUM(reviews_submitted) AS total_reviews,
  SUM(lines_added + lines_deleted) AS total_lines_changed,
  AVG(activity_score) AS avg_activity_score
FROM read_parquet('s3://github-data-lake/gold/developer_activity/**/*.parquet')
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY developer
ORDER BY avg_activity_score DESC
LIMIT 20;

-- リポジトリ別PR統計（過去90日）
SELECT
  repo_name,
  COUNT(*) AS total_prs,
  COUNT(CASE WHEN merged_at IS NOT NULL THEN 1 END) AS merged_prs,
  AVG(time_to_merge_hours) AS avg_merge_time_hours,
  AVG(additions + deletions) AS avg_pr_size,
  AVG(review_comments) AS avg_review_comments
FROM read_parquet('s3://github-data-lake/silver/pr_metrics/**/*.parquet')
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY repo_name
ORDER BY total_prs DESC;

-- 週次トレンド分析
SELECT
  DATE_TRUNC('week', date) AS week,
  COUNT(DISTINCT developer) AS active_developers,
  SUM(commits) AS total_commits,
  SUM(prs_merged) AS total_prs_merged,
  AVG(avg_pr_merge_time_hours) AS avg_merge_time
FROM read_parquet('s3://github-data-lake/gold/developer_activity/**/*.parquet')
WHERE date >= CURRENT_DATE - INTERVAL '180 days'
GROUP BY DATE_TRUNC('week', date)
ORDER BY week DESC;

-- PRサイズ別マージ率
SELECT
  pr_size_category,
  COUNT(*) AS total_prs,
  COUNT(CASE WHEN merged_at IS NOT NULL THEN 1 END) AS merged_count,
  CAST(COUNT(CASE WHEN merged_at IS NOT NULL THEN 1 END) AS DOUBLE) / COUNT(*) * 100 AS merge_rate_pct,
  AVG(time_to_merge_hours) AS avg_merge_time_hours
FROM read_parquet('s3://github-data-lake/silver/pr_metrics/**/*.parquet')
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY pr_size_category
ORDER BY
  CASE pr_size_category
    WHEN 'XS' THEN 1
    WHEN 'S' THEN 2
    WHEN 'M' THEN 3
    WHEN 'L' THEN 4
    WHEN 'XL' THEN 5
  END;
```

### 6.2 marimoノートブック例

**ファイル**: `notebooks/github_activity_analysis.py`

```python
import marimo as mo
import duckdb
import pandas as pd
import plotly.express as px

app = mo.App()

@app.cell
def setup_duckdb():
    """DuckDB接続とR2設定"""
    conn = duckdb.connect()

    # R2認証情報設定
    conn.execute("""
        CREATE SECRET r2_secret (
            TYPE S3,
            KEY_ID 'your_r2_access_key_id',
            SECRET 'your_r2_secret_access_key',
            ENDPOINT 'https://your_account_id.r2.cloudflarestorage.com'
        );
    """)

    return conn

@app.cell
def load_developer_activity(conn):
    """開発者アクティビティデータの読み込み"""
    query = """
    SELECT *
    FROM read_parquet('s3://github-data-lake/gold/developer_activity/**/*.parquet')
    WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    ORDER BY date DESC, activity_score DESC
    """

    df = conn.execute(query).df()
    return df

@app.cell
def plot_activity_trend(df):
    """アクティビティトレンドの可視化"""
    daily_stats = df.groupby('date').agg({
        'commits': 'sum',
        'prs_merged': 'sum',
        'reviews_submitted': 'sum',
        'activity_score': 'mean'
    }).reset_index()

    fig = px.line(
        daily_stats,
        x='date',
        y=['commits', 'prs_merged', 'reviews_submitted'],
        title='Daily Activity Trends (Last 30 Days)',
        labels={'value': 'Count', 'variable': 'Metric'}
    )

    return mo.ui.plotly(fig)

@app.cell
def top_contributors(df):
    """トップコントリビューター"""
    top_devs = df.groupby('developer').agg({
        'commits': 'sum',
        'prs_merged': 'sum',
        'reviews_submitted': 'sum',
        'activity_score': 'mean'
    }).reset_index().sort_values('activity_score', ascending=False).head(10)

    return mo.ui.table(top_devs)

if __name__ == "__main__":
    app.run()
```

## 7. 監視とアラート

### 7.1 パイプライン監視

#### Workers Analytics Engine

```typescript
// メトリクス記録
env.GITHUB_ANALYTICS.writeDataPoint({
  blobs: [
    'github_ingestion',
    repo,
    'events',
    status // 'success' or 'error'
  ],
  doubles: [
    recordCount,
    fileSizeBytes,
    apiCallDuration,
    rateLimit.remaining
  ],
  indexes: ['ingestion_timestamp']
});
```

#### 監視クエリ

```sql
-- 直近1時間のインジェスト成功率
SELECT
  blob1 AS pipeline_type,
  blob2 AS repo,
  COUNT(*) AS total_runs,
  SUM(CASE WHEN blob4 = 'success' THEN 1 ELSE 0 END) AS successful_runs,
  AVG(double1) AS avg_records_ingested,
  AVG(double4) AS avg_rate_limit_remaining
FROM GITHUB_ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '1 hour'
GROUP BY blob1, blob2;

-- レート制限アラート
SELECT
  blob2 AS repo,
  MIN(double4) AS min_rate_limit_remaining,
  COUNT(*) AS api_calls
FROM GITHUB_ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '1 hour'
  AND double4 < 500
GROUP BY blob2;
```

### 7.2 dbt + Elementary監視

**ファイル**: `models/silver/pr_metrics.yml`

```yaml
version: 2

models:
  - name: pr_metrics
    description: "Pull Request metrics and statistics"

    meta:
      owner: "data-engineering"

    tests:
      # 重複チェック
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns:
            - pull_id
            - repo_name

      # データ鮮度チェック
      - elementary.freshness_anomalies:
          timestamp_column: updated_at
          time_bucket:
            period: hour
            count: 1

    columns:
      - name: pull_id
        description: "Unique pull request ID"
        tests:
          - not_null
          - unique

      - name: time_to_merge_hours
        description: "Time from PR creation to merge in hours"
        tests:
          - elementary.all_columns_anomalies:
              column_anomalies:
                - zero_count
                - zero_percent
          # 異常値検出（マージ時間が24時間未満であることを期待）
          - dbt_expectations.expect_column_values_to_be_between:
              min_value: 0
              max_value: 168  # 1週間
              row_condition: "merged_at IS NOT NULL"

      - name: pr_size_category
        description: "PR size category (XS, S, M, L, XL)"
        tests:
          - accepted_values:
              values: ['XS', 'S', 'M', 'L', 'XL']
```

### 7.3 アラート設定

#### Cloudflare Workers アラート

```typescript
// エラー時にSlack通知
async function sendAlert(error: Error, repo: string, env: Env) {
  const webhookUrl = env.SLACK_WEBHOOK_URL;

  const message = {
    text: `🚨 GitHub Activity Pipeline Error`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Repository:* ${repo}\n*Error:* ${error.message}`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Timestamp: ${new Date().toISOString()}`
          }
        ]
      }
    ]
  };

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });
}
```

## 8. セキュリティとコンプライアンス

### 8.1 認証・認可

#### GitHub Token管理

```bash
# Workers Secretとして設定
wrangler secret put GITHUB_TOKEN

# GitHub App使用時
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY
```

#### アクセス制御

- **R2バケット**: Cloudflare Access経由でのみアクセス
- **D1データベース**: Service Bindingsで制限
- **Analytics Dashboard**: Cloudflare Access + IdP統合

### 8.2 データ保護

#### 個人情報の取り扱い

- **Email**: ハッシュ化してから保存（オプション）
- **名前**: 公開情報のみ収集
- **削除権**: GDPR対応のためのデータ削除フロー実装

```typescript
// Email匿名化（オプション）
function anonymizeEmail(email: string): string {
  const hash = crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(email)
  );
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}
```

### 8.3 監査ログ

```sql
-- すべてのアクセスをログに記録
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id VARCHAR(100),
    action VARCHAR(50),
    resource VARCHAR(200),
    ip_address VARCHAR(45),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
```

## 9. コスト見積もり

### 9.1 Cloudflareサービスコスト

**前提条件**:
- リポジトリ数: 10
- イベント収集頻度: 15分ごと
- PRデータ収集頻度: 30分ごと
- 月間データ量: 約50 GB（圧縮後）

| サービス | 使用量 | コスト（月額） | 備考 |
|---------|--------|--------------|------|
| **Workers** | 約14,000リクエスト/月 | $0 | Free tierで十分 |
| **Workers CPU Time** | 約50秒/月 | $0 | Free tierで十分 |
| **R2 Storage** | 50 GB | $0.75 | $0.015/GB |
| **R2 Class A Operations** | 約14,000回/月 | $0.63 | $0.0045/1000 |
| **R2 Class B Operations** | 約1,000回/月 | $0.00 | $0.00036/1000 |
| **D1 Storage** | 100 MB | $0 | Free tier 5GB |
| **D1 Reads** | 約10,000回/月 | $0 | Free tier 500万/月 |
| **KV Reads** | 約14,000回/月 | $0 | Free tier 10万/月 |
| **KV Writes** | 約14,000回/月 | $0.70 | $0.05/1000 |
| **Analytics Engine** | 約14,000 data points/月 | $0 | Free tier 1000万/月 |
| **合計** | - | **約$2.08/月** | - |

### 9.2 GitHub APIコスト

- **無料**: GitHub APIは無料（レート制限内）
- **GitHub Enterprise**: 追加のレート制限が必要な場合

### 9.3 スケーリング時のコスト

**100リポジトリの場合**:
- R2 Storage (500 GB): $7.50/月
- R2 Operations: $6.30/月
- KV Writes: $7.00/月
- **合計**: 約$21/月

**1000リポジトリの場合**:
- R2 Storage (5 TB): $75/月
- R2 Operations: $63/月
- KV Writes: $70/月
- Workers (有料プラン): $5/月
- **合計**: 約$213/月

### 9.4 従来のクラウドとの比較

**AWS同等構成**:
- S3 (50 GB + リクエスト): $5/月
- **S3 Egress (50 GB)**: $4.5/月
- Lambda: $3/月
- DynamoDB: $5/月
- CloudWatch: $3/月
- **合計**: 約$20.5/月

**Cloudflareの優位性**:
- **90%コスト削減**: $2 vs $20.5
- エグレス無料でさらに拡大時に差が開く

## 10. 実装ロードマップ

### Phase 1: 基本実装（2週間）

- [x] **Week 1**: 基盤セットアップ
  - [ ] Wranglerプロジェクト作成
  - [ ] D1データベース作成・マイグレーション
  - [ ] R2バケット作成
  - [ ] KVネームスペース作成
  - [ ] GitHub Token設定

- [ ] **Week 2**: コア機能実装
  - [ ] GitHub APIクライアント実装
  - [ ] イベント収集Worker実装
  - [ ] Parquet変換ロジック実装
  - [ ] R2書き込み実装
  - [ ] Workers Cron設定

### Phase 2: データ変換（1週間）

- [ ] **Week 3**: dbt実装
  - [ ] dbtプロジェクトセットアップ
  - [ ] Silverモデル実装 (pr_metrics, commit_metrics)
  - [ ] Goldモデル実装 (developer_activity, repo_metrics)
  - [ ] Elementary統合

### Phase 3: 追加データソース（1週間）

- [ ] **Week 4**: 拡張
  - [ ] PR収集Worker実装
  - [ ] Commits収集Worker実装
  - [ ] Workflows収集Worker実装
  - [ ] Code Reviews収集Worker実装

### Phase 4: 分析・可視化（1週間）

- [ ] **Week 5**: 分析基盤
  - [ ] marimoノートブック作成
  - [ ] Evidenceダッシュボード実装
  - [ ] DuckDBクエリ最適化

### Phase 5: 監視・最適化（1週間）

- [ ] **Week 6**: 本番化
  - [ ] Analytics Engine統合
  - [ ] アラート設定
  - [ ] エラーハンドリング強化
  - [ ] パフォーマンステスト
  - [ ] ドキュメント整備

## 11. トラブルシューティング

### 11.1 よくある問題

#### GitHub APIレート制限超過

**症状**:
```
Error: API rate limit exceeded (403)
```

**解決策**:
1. KVでレート制限状態を確認
2. リクエスト頻度を調整
3. GitHub Appに移行（15,000リクエスト/時）
4. 複数のトークンでロードバランス

```typescript
// レート制限チェック
async function shouldSkipDueToRateLimit(env: Env): Promise<boolean> {
  const rateLimitStr = await env.GITHUB_STATE_KV.get('rate_limit');
  if (!rateLimitStr) return false;

  const rateLimit = JSON.parse(rateLimitStr);
  if (rateLimit.remaining < 100) {
    const resetTime = new Date(rateLimit.reset * 1000);
    if (resetTime > new Date()) {
      console.log(`Rate limit low, waiting until ${resetTime}`);
      return true;
    }
  }

  return false;
}
```

#### Parquet変換エラー

**症状**:
```
Error: Failed to convert to Parquet
```

**解決策**:
1. スキーマの型不一致を確認
2. Null値処理を追加
3. データサイズを制限（バッチ処理）

```typescript
// Null値処理
function sanitizeEvent(event: any) {
  return {
    ...event,
    actor: event.actor || { id: 0, login: 'unknown' },
    repo: event.repo || { id: 0, name: 'unknown' },
    payload: event.payload || {},
  };
}
```

#### R2書き込み失敗

**症状**:
```
Error: R2 PUT failed (500)
```

**解決策**:
1. ファイルサイズを確認（最大5TB）
2. リトライロジック実装
3. マルチパートアップロード使用（大きなファイル）

```typescript
// リトライロジック
async function putWithRetry(
  bucket: R2Bucket,
  key: string,
  value: Uint8Array,
  maxRetries = 3
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await bucket.put(key, value);
      return;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

### 11.2 デバッグ方法

#### Workers Logsの確認

```bash
# リアルタイムログ
wrangler tail github-events-collector

# 特定の期間のログ
wrangler tail github-events-collector --since 1h
```

#### D1データ確認

```bash
# メタデータ確認
wrangler d1 execute github_metadata --command "SELECT * FROM ingestion_log ORDER BY created_at DESC LIMIT 10"

# エラーログ確認
wrangler d1 execute github_metadata --command "SELECT * FROM error_log ORDER BY created_at DESC LIMIT 10"
```

#### R2ファイル確認

```bash
# ファイル一覧
wrangler r2 object list github-data-lake --prefix "bronze/github_events/"

# ファイルダウンロード
wrangler r2 object get github-data-lake "bronze/github_events/year=2025/month=01/day=01/events_xxx.parquet" --file ./test.parquet

# DuckDBで検証
duckdb
D SELECT COUNT(*) FROM read_parquet('test.parquet');
```

## 12. 今後の拡張

### 12.1 短期（3ヶ月）

- [ ] **リアルタイムイベント**: Webhooksによる即時データ取り込み
- [ ] **コードレビュー分析**: 詳細なレビューメトリクス
- [ ] **CI/CDパイプライン分析**: Actions実行時間・成功率
- [ ] **依存関係分析**: リポジトリ間の依存関係グラフ

### 12.2 中期（6ヶ月）

- [ ] **機械学習予測**: PR マージ時間予測
- [ ] **異常検知**: 開発パターンの異常検出
- [ ] **レコメンデーション**: レビュアー推薦システム
- [ ] **ナレッジグラフ**: コードベース知識マップ

### 12.3 長期（12ヶ月）

- [ ] **マルチソース統合**: Jira、Slack、Linear等との連携
- [ ] **生成AI統合**: コミットメッセージ分析・要約
- [ ] **リアルタイムダッシュボード**: Durable Objectsによる即時更新
- [ ] **外部公開API**: 分析データのAPI提供

## 13. 参考資料

### 13.1 GitHub API

- [GitHub REST API Documentation](https://docs.github.com/en/rest)
- [GitHub Events API](https://docs.github.com/en/rest/activity/events)
- [Rate Limiting](https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limiting)

### 13.2 Cloudflare

- [Workers Documentation](https://developers.cloudflare.com/workers/)
- [R2 Storage](https://developers.cloudflare.com/r2/)
- [D1 Database](https://developers.cloudflare.com/d1/)
- [Workers KV](https://developers.cloudflare.com/kv/)
- [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)

### 13.3 DuckDB & Parquet

- [DuckDB Documentation](https://duckdb.org/docs/)
- [Parquet Format](https://parquet.apache.org/docs/)
- [Apache Arrow](https://arrow.apache.org/docs/)

### 13.4 dbt

- [dbt Documentation](https://docs.getdbt.com/)
- [Elementary Data Observability](https://docs.elementary-data.com/)

## 14. まとめ

### 14.1 主な特徴

- **低コスト**: 月額$2〜で運用可能（10リポジトリ）
- **スケーラブル**: 1000リポジトリでも月額$213
- **リアルタイム**: 15分ごとの自動更新
- **分析最適化**: DuckDB/Parquet形式で高速クエリ
- **保守性**: サーバーレスで運用負荷最小

### 14.2 推奨構成

| 規模 | リポジトリ数 | 収集頻度 | 月額コスト | 備考 |
|------|------------|---------|----------|------|
| **Small** | 1-10 | 15分 | $2-5 | Free tier活用 |
| **Medium** | 10-100 | 15分 | $5-25 | Workers有料プラン推奨 |
| **Large** | 100-1000 | 15分 | $25-250 | GitHub App推奨 |
| **Enterprise** | 1000+ | 5-15分 | $250+ | 専用インフラ検討 |

### 14.3 次のステップ

1. **Phase 1実装**: Workers + R2の基本パイプライン構築
2. **データ検証**: 1週間のデータ収集・検証
3. **dbt統合**: Silver/Goldレイヤー実装
4. **ダッシュボード**: Evidence/marimoで可視化
5. **本番化**: 監視・アラート設定

---

**最終更新**: 2026-01-01
**バージョン**: 1.0
**著者**: Data Engineering Team
