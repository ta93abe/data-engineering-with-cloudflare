# GitHub Analytics Platform on Cloudflare

CloudflareをベースとしたGitHubデータ分析プラットフォームの開発ガイド

## プロジェクト概要

GitHubリポジトリのメトリクスを自動収集・変換・可視化する、フルマネージドなデータ基盤です。

### アーキテクチャ

```
┌─────────────────┐
│ GitHub API      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│ Cloudflare Workers (Data Ingestion)                │
│  ┌──────────────┐      ┌──────────────────────────┐│
│  │  Scheduler   │──┬──►│ Queue                    ││
│  │  (Cron)      │  │   └──────┬───────────────────┘│
│  └──────────────┘  │          │                     │
│                    │          ▼                     │
│                    │   ┌──────────────────────────┐│
│                    │   │ Fetcher (Consumer x N)   ││
│                    │   └──────┬───────────────────┘│
│                    │          │                     │
│                    ▼          ▼                     │
│            ┌──────────────────────────────┐        │
│            │ Workers KV (Metadata Cache)  │        │
│            └──────────────────────────────┘        │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ R2 (Data Lake)  │
                │ Raw JSON        │
                │ Hive Partition  │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ dbt Transform   │
                │ Raw → Staging   │
                │     → Marts     │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ DuckDB          │
                │ (Analytics DB)  │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Evidence.dev    │
                │ (BI Dashboard)  │
                └─────────────────┘
```

### 主な特徴

- **エッジファースト**: Workers上でスケーラブルなデータ取り込み
- **Queue駆動**: 並列処理による高速データ収集
- **Hiveパーティション**: `year=YYYY/month=MM/day=DD` 形式でR2に効率的に保存
- **Medallion Architecture**: Raw → Staging → Marts の3層データモデル
- **コード化**: Infrastructure as Code (Terraform) + Data as Code (dbt)
- **データ品質**: dbt testsによる品質保証

## 技術スタック

### データ取り込み層

| 技術 | 用途 | 実装状況 |
|------|------|---------|
| **Cloudflare Workers** | Scheduler + Fetcher | ✅ 実装済み |
| **Cloudflare Queues** | メッセージキュー | ✅ 実装済み |
| **Workers KV** | メタデータキャッシュ | ✅ 実装済み |
| **R2** | Data Lake (Raw JSON) | ✅ 実装済み |
| **Analytics Engine** | パイプラインメトリクス | ✅ 実装済み |
| **TypeScript** | Workers実装言語 | ✅ 実装済み |
| **Vitest** | ユニットテスト | ✅ 実装済み |

### インフラ管理

| 技術 | 用途 | 実装状況 |
|------|------|---------|
| **Terraform** | IaC (全リソース定義) | ✅ 実装済み |
| **Makefile** | タスク自動化 | ✅ 実装済み |
| **Wrangler** | Workers CLI | ✅ 実装済み |

### データ変換層

| 技術 | 用途 | 実装状況 |
|------|------|---------|
| **dbt-core** | データ変換フレームワーク | ✅ 実装済み |
| **dbt-duckdb** | DuckDBアダプター | ✅ 実装済み |
| **DuckDB** | 分析用データベース | ✅ 実装済み |
| **dbt seeds** | 開発用ダミーデータ | ✅ 実装済み |

### 可視化層

| 技術 | 用途 | 実装状況 |
|------|------|---------|
| **Evidence.dev** | BIダッシュボード | ✅ 実装済み |
| **pnpm** | パッケージマネージャー | ✅ 実装済み |

## プロジェクト構造

```
data-engineering-with-cloudflare/
├── .claude/
│   └── CLAUDE.md                      # このファイル
│
├── docs/
│   ├── architecture-design.md         # アーキテクチャ詳細設計
│   ├── github-workers-testing.md      # テスト戦略ガイド
│   └── SETUP_TODO.md                  # セットアップ手順（手動作業）
│
├── workers/
│   ├── github-scheduler/              # スケジューラーWorker
│   │   ├── src/index.ts              # メインロジック
│   │   ├── test/index.test.ts        # Vitestテスト
│   │   ├── wrangler.toml             # Wrangler設定
│   │   ├── package.json              # 依存関係
│   │   └── vitest.config.ts          # テスト設定
│   │
│   └── github-fetcher/                # フェッチャーWorker
│       ├── src/index.ts              # メインロジック
│       ├── test/index.test.ts        # Vitestテスト
│       ├── wrangler.toml             # Wrangler設定
│       ├── package.json              # 依存関係
│       └── vitest.config.ts          # テスト設定
│
├── terraform/
│   ├── main.tf                        # Cloudflareリソース定義
│   ├── variables.tf                   # 変数定義
│   ├── outputs.tf                     # 出力定義
│   ├── terraform.tfvars.example       # 設定例
│   └── .terraform.lock.hcl           # ロックファイル
│
├── dbt_github/
│   ├── dbt_project.yml               # dbtプロジェクト設定
│   ├── packages.yml                   # dbt依存パッケージ
│   ├── profiles.yml                   # DB接続設定
│   │
│   ├── seeds/                         # 開発用シードデータ
│   │   ├── repositories.csv
│   │   ├── issues.csv
│   │   ├── pull_requests.csv
│   │   ├── commits.csv
│   │   ├── stargazers.csv
│   │   ├── releases.csv
│   │   └── workflow_runs.csv
│   │
│   ├── models/
│   │   ├── staging/                   # Stagingレイヤー（View）
│   │   │   ├── _sources.yml          # Rawデータソース定義
│   │   │   ├── stg_github__repositories.sql
│   │   │   ├── stg_github__issues.sql
│   │   │   ├── stg_github__pull_requests.sql
│   │   │   ├── stg_github__commits.sql
│   │   │   ├── stg_github__stargazers.sql
│   │   │   ├── stg_github__releases.sql
│   │   │   └── stg_github__workflow_runs.sql
│   │   │
│   │   └── marts/                     # Martsレイヤー（Table）
│   │       ├── dimensions/
│   │       │   ├── dim_repositories.sql
│   │       │   └── dim_contributors.sql
│   │       │
│   │       ├── facts/
│   │       │   ├── fct_repository_activity.sql
│   │       │   ├── fct_issue_lifecycle.sql
│   │       │   ├── fct_pr_metrics.sql
│   │       │   └── fct_commit_stats.sql
│   │       │
│   │       └── aggregations/
│   │           └── agg_daily_metrics.sql  # Incremental
│   │
│   └── target/
│       └── github_analytics.duckdb    # 生成されるDuckDBファイル
│
├── evidence_dashboard/
│   ├── package.json                   # Evidence.dev設定
│   ├── evidence.config.yaml           # データソース設定
│   │
│   └── pages/                         # ダッシュボードページ
│       ├── index.md                   # 概要ダッシュボード
│       ├── repositories.md            # リポジトリ分析
│       ├── issues.md                  # Issue分析
│       ├── pull-requests.md           # PR分析
│       ├── contributors.md            # コントリビューター分析
│       ├── cicd.md                    # CI/CD分析
│       └── growth.md                  # 成長トレンド分析
│
├── .github/
│   └── workflows/
│       └── test-workers.yml           # CI/CD: テスト自動実行
│
├── Makefile                           # タスク自動化
└── README.md                          # プロジェクト概要
```

## クイックスタート

### 1. ローカルでダッシュボードを確認（最速）

```bash
# dbt: シードデータロード & モデル実行
cd dbt_github
dbt deps
dbt seed
dbt run

# Evidence.dev: ダッシュボード起動
cd ../evidence_dashboard
pnpm install
pnpm dev
# → http://localhost:3000 でダッシュボード確認
```

### 2. Workers開発環境セットアップ

```bash
# 依存関係インストール
cd workers/github-scheduler
npm install

cd ../github-fetcher
npm install

# テスト実行
npm test

# ローカル開発サーバー起動
wrangler dev
```

### 3. 本番環境デプロイ

詳細は `docs/SETUP_TODO.md` を参照:

```bash
# 1. API Token取得（Cloudflare + GitHub）
# 2. Terraform実行
cd terraform
terraform init
terraform apply

# 3. Secrets登録
cd ../workers/github-scheduler
wrangler secret put GITHUB_TOKEN

cd ../github-fetcher
wrangler secret put GITHUB_TOKEN

# 4. Workers デプロイ
make deploy-prod
```

## 開発ガイドライン

### Workers開発

#### Scheduler Worker の役割

```typescript
// 1. GitHub APIから全リポジトリリストを取得
const repos = await fetchAllRepositories(env.GITHUB_TOKEN);

// 2. 各リポジトリをQueueにバッチ送信
await env.GITHUB_QUEUE.sendBatch(messages);

// 3. メタデータをKVに保存
await env.METADATA_KV.put(`last_run`, timestamp);

// 4. Analytics Engineにメトリクス記録
env.ANALYTICS.writeDataPoint({ ... });
```

#### Fetcher Worker の役割

```typescript
// 1. Queueからメッセージ受信
export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      // 2. GitHub APIから詳細データ取得
      const data = await fetchRepositoryDetails(repo);

      // 3. R2にHive形式で保存
      // data-lake-raw/repositories/year=2025/month=01/day=03/repo_123.json
      await env.DATA_LAKE_RAW.put(key, JSON.stringify(data));
    }
  }
}
```

#### ベストプラクティス

```typescript
// ✅ Good: 環境変数から読み取り
const token = env.GITHUB_TOKEN;

// ✅ Good: 適切なエラーハンドリング
try {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }
} catch (error) {
  console.error('Fetch error:', error);
  message.retry(); // Queue再試行
}

// ✅ Good: レート制限対応
const remaining = response.headers.get('X-RateLimit-Remaining');
if (parseInt(remaining) < 100) {
  await env.METADATA_KV.put('rate_limit_warning', 'true');
}

// ✅ Good: Hiveパーティション
const date = new Date();
const key = `repositories/year=${date.getFullYear()}/month=${String(date.getMonth() + 1).padStart(2, '0')}/day=${String(date.getDate()).padStart(2, '0')}/repo_${id}.json`;
```

### テスト戦略

#### テスト実行

```bash
# 全テスト実行
npm test

# watchモード
npm run test:watch

# カバレッジ
npm run test:coverage
```

#### テスト例

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('GitHub Scheduler', () => {
  it('should fetch repositories and send to queue', async () => {
    const mockEnv = createMockEnv();
    const request = new Request('https://example.com/trigger');

    const response = await worker.fetch(request, mockEnv);

    expect(response.status).toBe(200);
    expect(mockEnv.GITHUB_QUEUE.sendBatch).toHaveBeenCalled();
  });
});
```

カバレッジ目標:
- **Lines**: 80%+
- **Functions**: 80%+
- **Branches**: 75%+

### dbt開発

#### プロジェクト構成

1. **Staging Layer** (View)
   - Rawデータのクレンジング・正規化
   - 重複排除（`qualify row_number()`）
   - カラムリネーム

2. **Marts Layer** (Table)
   - **Dimensions**: マスターテーブル（リポジトリ、コントリビューター）
   - **Facts**: トランザクションテーブル（アクティビティ、Issue、PR、コミット）
   - **Aggregations**: 集計テーブル（日次メトリクス）

#### 開発ワークフロー

```bash
# モデル作成・変更後
dbt run --select stg_github__new_model

# テスト実行
dbt test --select stg_github__new_model

# ドキュメント生成
dbt docs generate
dbt docs serve
```

#### モデル例

```sql
-- models/staging/stg_github__repositories.sql
with source as (
    select * from {{ source('github_raw', 'repositories') }}
),
renamed as (
    select
        id as repository_id,
        full_name as repository_full_name,
        -- ... カラムリネーム
    from source
),
deduped as (
    select *
    from renamed
    qualify row_number() over (
        partition by repository_id
        order by extracted_at desc
    ) = 1
)
select * from deduped
```

### Evidence.dev開発

#### ページ作成

```markdown
---
title: New Analysis Page
---

# New Analysis

\```sql repos_summary
select
  count(*) as total_repos,
  avg(current_stars) as avg_stars
from marts.dim_repositories
\```

<BigValue
  data={repos_summary}
  value=total_repos
  title="Total Repositories"
/>

<LineChart
  data={daily_trend}
  x=date
  y=stars
  title="Star Growth"
/>
```

#### 開発サーバー

```bash
cd evidence_dashboard
pnpm dev  # http://localhost:3000

# ビルド
pnpm build
```

## Cloudflare固有の考慮事項

### リソース制限

| リソース | 制限値 | 本プロジェクトでの対策 |
|---------|--------|---------------------|
| Workers CPU時間 | 50ms (Free) / 30秒 (Paid) | Queue使用で処理分散 |
| Workers メモリ | 128MB | ページネーション処理 |
| Queue メッセージサイズ | 128KB | リポジトリIDのみ送信 |
| R2 オブジェクトサイズ | 5TB | 個別JSONファイル保存 |
| KV 読み取り | 無制限（低レイテンシ） | メタデータキャッシュ |
| KV 書き込み | 課金対象 | 最小限の更新頻度 |

### コスト最適化

1. **R2のエグレス無料**: S3比較で大幅コスト削減
2. **Queue活用**: Workers実行時間を最小化
3. **KV読み取り重視**: キャッシュで外部API呼び出し削減
4. **Hiveパーティション**: 効率的なデータスキャン

## Makefileコマンド

```bash
# セットアップ
make setup              # 初期セットアップ
make install            # 依存関係インストール

# テスト
make test               # 全Worker テスト
make test-scheduler     # Schedulerテスト
make test-fetcher       # Fetcherテスト
make test-coverage      # カバレッジ

# Terraform
make tf-init            # Terraform初期化
make tf-plan            # 実行計画確認
make tf-apply           # リソース作成
make tf-destroy         # リソース削除

# デプロイ
make deploy-dev         # 開発環境デプロイ
make deploy-prod        # 本番環境デプロイ
make deploy-scheduler   # Schedulerのみ
make deploy-fetcher     # Fetcherのみ

# dbt
make dbt-run            # dbtモデル実行
make dbt-test           # dbtテスト

# 監視
make logs-scheduler     # Schedulerログ
make logs-fetcher       # Fetcherログ
make tail-scheduler     # リアルタイムログ

# クリーンアップ
make clean              # ビルドアーティファクト削除
```

## トラブルシューティング

### Workers CPU時間超過

**症状**: `Error: CPU time limit exceeded`

**解決策**:
```typescript
// ❌ Bad: 同期的な大量処理
for (const repo of repos) {
  await processRepository(repo);
}

// ✅ Good: Queue経由で並列処理
await env.GITHUB_QUEUE.sendBatch(
  repos.map(repo => ({ body: { repo } }))
);
```

### GitHub API Rate Limit

**症状**: `403 rate limit exceeded`

**解決策**:
```typescript
// Personal Access Tokenを使用（5000 req/hour）
// wrangler secret put GITHUB_TOKEN

// レート制限チェック
const remaining = response.headers.get('X-RateLimit-Remaining');
if (parseInt(remaining) < 100) {
  console.warn('Rate limit approaching');
}
```

### dbt DuckDB接続エラー

**症状**: `DuckDB database not found`

**解決策**:
```bash
# dbtを先に実行してDBを生成
cd dbt_github
dbt seed
dbt run

# Evidence.devはそのDBを参照
cd ../evidence_dashboard
pnpm dev
```

### R2 Access Denied

**症状**: `R2 bucket access denied`

**解決策**:
```bash
# Terraform出力のバケットIDを確認
terraform output

# wrangler.tomlのbucket_nameを更新
[[r2_buckets]]
binding = "DATA_LAKE_RAW"
bucket_name = "data-lake-raw"  # Terraform出力値
```

## プロジェクト進捗状況

### ✅ Phase 1: データ取り込み基盤（完了）

- [x] アーキテクチャ設計 (`docs/architecture-design.md`)
- [x] Scheduler Worker実装
- [x] Fetcher Worker実装
- [x] Queue駆動アーキテクチャ
- [x] R2 Hiveパーティション
- [x] Workers KVメタデータ管理
- [x] Analytics Engine統合
- [x] Vitestテスト実装（80%+ coverage）
- [x] Terraform IaC
- [x] Makefile自動化
- [x] CI/CD (GitHub Actions)

### ✅ Phase 2: データ変換（完了）

- [x] dbtプロジェクトセットアップ
- [x] DuckDB統合
- [x] Seedデータ作成（7種類）
- [x] Stagingモデル実装（7モデル）
- [x] Dimensionモデル実装（2モデル）
- [x] Factモデル実装（4モデル）
- [x] Incrementalモデル実装（1モデル）
- [x] dbt testsによる品質保証

### ✅ Phase 3: データ可視化（完了）

- [x] Evidence.devセットアップ
- [x] DuckDB接続設定
- [x] ダッシュボード実装（7ページ）
  - [x] 概要ダッシュボード
  - [x] リポジトリ分析
  - [x] Issue分析
  - [x] PR分析
  - [x] コントリビューター分析
  - [x] CI/CD分析
  - [x] 成長トレンド分析

### 🔲 Phase 4: 本番運用（未着手）

- [ ] Cloudflare本番デプロイ
- [ ] 実データ取得テスト
- [ ] アラート設定
- [ ] コスト監視

### 🔲 Phase 5: 拡張機能（未着手）

- [ ] Elementary データ品質監視
- [ ] Durable Objects（リアルタイム処理）
- [ ] Hyperdrive（外部DB連携）
- [ ] 高度な分析機能

## 参考リソース

### 公式ドキュメント

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [R2 Storage](https://developers.cloudflare.com/r2/)
- [Workers KV](https://developers.cloudflare.com/kv/)
- [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### データツール

- [dbt Documentation](https://docs.getdbt.com/)
- [dbt-duckdb](https://github.com/duckdb/dbt-duckdb)
- [DuckDB](https://duckdb.org/)
- [Evidence.dev](https://evidence.dev/)

### このプロジェクト

- `docs/architecture-design.md` - 詳細設計
- `docs/github-workers-testing.md` - テスト戦略
- `docs/SETUP_TODO.md` - セットアップ手順
- `README.md` - プロジェクト概要

## 貢献ガイドライン

1. **ブランチ戦略**: feature/機能名 でブランチ作成
2. **コミットメッセージ**: Conventional Commits形式
   ```
   feat: Add new dashboard page
   fix: Resolve rate limit handling
   test: Add Fetcher Worker tests
   docs: Update setup guide
   ```
3. **テスト**: 新機能は必ずテスト追加
4. **ドキュメント**: 重要な変更はCLAUDE.md更新

---

**最終更新**: 2026-01-03
**プロジェクトステータス**: Phase 1-3 完了、Phase 4 準備中
