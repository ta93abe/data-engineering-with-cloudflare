# Evidence - コスト監視ダッシュボード実装ガイド

Evidenceを使用したCloudflareデータ基盤のコスト監視・可視化ダッシュボード構築ガイド。

## 📋 目次

1. [Evidenceとは](#evidenceとは)
2. [アーキテクチャ](#アーキテクチャ)
3. [セットアップ](#セットアップ)
4. [コストデータ収集](#コストデータ収集)
5. [ダッシュボード実装](#ダッシュボード実装)
6. [Cloudflare Pagesデプロイ](#cloudflare-pagesデプロイ)
7. [自動更新設定](#自動更新設定)

---

## Evidenceとは

**Evidence**は、SQLとMarkdownでビジネスインテリジェンスレポートを構築できるオープンソースのBIツールです。

### 特徴

- ✅ **SQLベース**: 複雑なコードなしでデータ分析
- ✅ **Markdown**: ドキュメントのようにレポート作成
- ✅ **Git-friendly**: .mdファイルでバージョン管理
- ✅ **静的サイト生成**: Cloudflare Pagesに最適
- ✅ **DuckDB対応**: R2データを直接クエリ

### ユースケース

- Cloudflareサービスのコスト追跡
- Workers実行コスト分析
- R2ストレージコスト監視
- Vectorize使用量レポート
- Analytics Engine利用統計

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Billing API                          │
│  - Workers実行コスト                                          │
│  - R2ストレージ・リクエストコスト                               │
│  - Vectorizeクエリコスト                                      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           Workers Cron (コストデータ収集)                      │
│  - 日次でBilling APIからデータ取得                             │
│  - ParquetフォーマットでR2に保存                               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  R2 (コストデータレイク)                       │
│  s3://cost-data/                                            │
│    └── billing/                                             │
│         ├── 2025-01-01.parquet                              │
│         ├── 2025-01-02.parquet                              │
│         └── ...                                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Evidence (DuckDB + SQL)                         │
│  - R2データをDuckDBで読み取り                                 │
│  - SQLでコスト分析クエリ                                       │
│  - Markdownでダッシュボード作成                                │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           Cloudflare Pages (ダッシュボード)                   │
│  - 静的サイトとしてホスティング                                 │
│  - Cloudflare Accessで保護                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## セットアップ

### 1. Evidenceインストール

```bash
# プロジェクトディレクトリ作成
mkdir -p evidence-dashboard
cd evidence-dashboard

# Evidenceプロジェクト初期化
npx degit evidence-dev/template my-cost-dashboard
cd my-cost-dashboard

# 依存関係インストール
npm install
```

### 2. DuckDB + R2設定

```javascript
// evidence.config.yaml
databases:
  cloudflare_costs:
    type: duckdb
    filename: ':memory:'
    extensions:
      - httpfs
    settings:
      s3_region: auto
      s3_endpoint: '${R2_ENDPOINT}'
      s3_access_key_id: '${R2_ACCESS_KEY_ID}'
      s3_secret_access_key: '${R2_SECRET_ACCESS_KEY}'
```

### 3. 環境変数設定

```bash
# .env
R2_ENDPOINT=https://xxxxx.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=cost-data
```

---

## コストデータ収集

### Workers Cronでコストデータ収集

```javascript
// workers/cost-collector/index.js

/**
 * Cloudflare Billing APIからコストデータを取得してR2に保存
 */

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(collectCostData(env));
  },

  async fetch(request, env) {
    // 手動トリガー用
    if (request.url.includes('/collect')) {
      await collectCostData(env);
      return new Response('Cost data collected', { status: 200 });
    }
    return new Response('OK', { status: 200 });
  }
};

async function collectCostData(env) {
  const today = new Date().toISOString().split('T')[0];

  try {
    // 1. Cloudflare Analytics APIからデータ取得
    const analyticsData = await fetchCloudflareAnalytics(env);

    // 2. コスト計算
    const costData = calculateCosts(analyticsData);

    // 3. Parquet形式でR2に保存
    await saveCostDataToR2(env, costData, today);

    console.log(`Cost data saved for ${today}`);
  } catch (error) {
    console.error('Error collecting cost data:', error);
  }
}

async function fetchCloudflareAnalytics(env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;

  // Workers Analytics
  const workersResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: `
          SELECT
            toDate(timestamp) as date,
            blob1 as worker_name,
            COUNT(*) as requests,
            SUM(double1) as total_cpu_time_ms
          FROM ANALYTICS_DATASET
          WHERE timestamp >= NOW() - INTERVAL '1' DAY
          GROUP BY date, worker_name
        `
      })
    }
  );

  const workersData = await workersResponse.json();

  // R2 Storage (Cloudflare API経由)
  const r2Response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`,
    {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    }
  );

  const r2Data = await r2Response.json();

  return {
    workers: workersData.data,
    r2: r2Data.result
  };
}

function calculateCosts(analyticsData) {
  const costs = [];
  const today = new Date().toISOString().split('T')[0];

  // Workers コスト計算
  // 有料プラン: $5/月 + $0.50 per million requests + $0.02 per million GB-s CPU time
  for (const worker of analyticsData.workers) {
    const requestCost = (worker.requests / 1_000_000) * 0.50;
    const cpuCost = (worker.total_cpu_time_ms / 1000 / 1_000_000) * 0.02;

    costs.push({
      date: today,
      service: 'Workers',
      resource: worker.worker_name,
      metric: 'requests',
      quantity: worker.requests,
      unit_cost: 0.50,
      total_cost: requestCost + cpuCost,
      currency: 'USD'
    });
  }

  // R2 ストレージコスト計算
  // $0.015 per GB-month stored
  for (const bucket of analyticsData.r2) {
    const storageCost = (bucket.size_bytes / 1_000_000_000) * 0.015 / 30; // 日割り

    costs.push({
      date: today,
      service: 'R2',
      resource: bucket.name,
      metric: 'storage_gb',
      quantity: bucket.size_bytes / 1_000_000_000,
      unit_cost: 0.015,
      total_cost: storageCost,
      currency: 'USD'
    });
  }

  return costs;
}

async function saveCostDataToR2(env, costData, date) {
  // JSONをParquet形式に変換（簡易版はJSON保存）
  const jsonData = JSON.stringify(costData, null, 2);

  const key = `billing/${date}.json`;

  await env.COST_DATA_BUCKET.put(key, jsonData, {
    httpMetadata: {
      contentType: 'application/json'
    },
    customMetadata: {
      collected_at: new Date().toISOString()
    }
  });
}
```

### wrangler設定

```toml
# wrangler-cost-collector.toml

name = "cost-collector"
main = "workers/cost-collector/index.js"
compatibility_date = "2024-01-01"

# Cron設定（毎日1回実行）
[triggers]
crons = ["0 1 * * *"]

# R2 Binding
[[r2_buckets]]
binding = "COST_DATA_BUCKET"
bucket_name = "cost-data"

# 環境変数
[vars]
CLOUDFLARE_ACCOUNT_ID = "your-account-id"

# Secrets
# wrangler secret put CLOUDFLARE_API_TOKEN
```

---

## ダッシュボード実装

### ディレクトリ構造

```
evidence-dashboard/
├── pages/
│   ├── index.md                    # トップページ
│   ├── workers-cost.md             # Workers コスト詳細
│   ├── r2-cost.md                  # R2 コスト詳細
│   └── cost-trends.md              # コストトレンド分析
├── sources/
│   └── cloudflare_costs/
│       ├── daily_costs.sql         # 日次コスト
│       ├── monthly_summary.sql     # 月次サマリー
│       └── service_breakdown.sql   # サービス別内訳
├── components/
│   └── cost_chart.svelte           # カスタムチャート
├── static/
│   └── logo.png
└── evidence.config.yaml
```

### ページ例: index.md

```markdown
---
title: Cloudflare Cost Dashboard
---

# 💰 Cloudflare コスト監視ダッシュボード

最終更新: {new Date().toISOString()}

## 📊 月次コスト概要

```sql monthly_total
SELECT
  DATE_TRUNC('month', date) as month,
  SUM(total_cost) as total_monthly_cost
FROM read_json_auto('s3://cost-data/billing/*.json')
WHERE date >= CURRENT_DATE - INTERVAL '3' MONTH
GROUP BY month
ORDER BY month DESC
LIMIT 3
```

<BigValue
  data={monthly_total}
  value=total_monthly_cost
  title="今月の総コスト"
  fmt='usd'
/>

## 📈 サービス別コスト内訳

```sql service_breakdown
SELECT
  service,
  SUM(total_cost) as cost,
  COUNT(DISTINCT resource) as resource_count
FROM read_json_auto('s3://cost-data/billing/*.json')
WHERE date >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY service
ORDER BY cost DESC
```

<BarChart
  data={service_breakdown}
  x=service
  y=cost
  title="過去30日間のサービス別コスト"
  yFmt='usd'
/>

## 🔍 コスト上位リソース

```sql top_resources
SELECT
  service,
  resource,
  SUM(total_cost) as total_cost,
  AVG(total_cost) as avg_daily_cost
FROM read_json_auto('s3://cost-data/billing/*.json')
WHERE date >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY service, resource
ORDER BY total_cost DESC
LIMIT 10
```

<DataTable data={top_resources}>
  <Column id=service />
  <Column id=resource />
  <Column id=total_cost fmt='usd' />
  <Column id=avg_daily_cost fmt='usd' />
</DataTable>

## 📅 日次コストトレンド

```sql daily_trend
SELECT
  date,
  service,
  SUM(total_cost) as daily_cost
FROM read_json_auto('s3://cost-data/billing/*.json')
WHERE date >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY date, service
ORDER BY date, service
```

<LineChart
  data={daily_trend}
  x=date
  y=daily_cost
  series=service
  title="日次コストトレンド（サービス別）"
  yFmt='usd'
/>

## 💡 コスト削減の提案

```sql cost_anomalies
SELECT
  date,
  service,
  resource,
  total_cost,
  LAG(total_cost) OVER (PARTITION BY service, resource ORDER BY date) as prev_cost,
  ((total_cost - LAG(total_cost) OVER (PARTITION BY service, resource ORDER BY date))
    / LAG(total_cost) OVER (PARTITION BY service, resource ORDER BY date) * 100) as pct_change
FROM read_json_auto('s3://cost-data/billing/*.json')
WHERE date >= CURRENT_DATE - INTERVAL '7' DAY
QUALIFY ABS(pct_change) > 50 -- 50%以上の変動
ORDER BY ABS(pct_change) DESC
LIMIT 5
```

<Alert status='warning'>
  <DataTable data={cost_anomalies}>
    <Column id=date />
    <Column id=service />
    <Column id=resource />
    <Column id=total_cost fmt='usd' />
    <Column id=pct_change fmt='pct1' />
  </DataTable>
</Alert>
```

### ページ例: workers-cost.md

```markdown
---
title: Workers Cost Analysis
---

# ⚡ Workers コスト分析

## Workers別実行コスト

```sql workers_cost
SELECT
  resource as worker_name,
  SUM(CASE WHEN metric = 'requests' THEN quantity ELSE 0 END) as total_requests,
  SUM(CASE WHEN metric = 'cpu_time' THEN quantity ELSE 0 END) as total_cpu_ms,
  SUM(total_cost) as total_cost
FROM read_json_auto('s3://cost-data/billing/*.json')
WHERE service = 'Workers'
  AND date >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY worker_name
ORDER BY total_cost DESC
```

<DataTable data={workers_cost} rows=20>
  <Column id=worker_name />
  <Column id=total_requests fmt='num0' />
  <Column id=total_cpu_ms fmt='num0' />
  <Column id=total_cost fmt='usd' />
</DataTable>

## リクエスト単価分析

```sql cost_per_request
SELECT
  resource as worker_name,
  SUM(total_cost) / NULLIF(SUM(quantity), 0) * 1000 as cost_per_1k_requests
FROM read_json_auto('s3://cost-data/billing/*.json')
WHERE service = 'Workers' AND metric = 'requests'
  AND date >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY worker_name
HAVING SUM(quantity) > 1000  -- 最低1000リクエスト
ORDER BY cost_per_1k_requests DESC
LIMIT 10
```

<BarChart
  data={cost_per_request}
  x=worker_name
  y=cost_per_1k_requests
  title="Worker別 1000リクエストあたりコスト"
  yFmt='usd'
/>
```

---

## Cloudflare Pagesデプロイ

### 1. ビルド設定

```json
// package.json
{
  "name": "evidence-cost-dashboard",
  "scripts": {
    "dev": "evidence dev",
    "build": "evidence build:strict",
    "sources": "evidence sources"
  },
  "dependencies": {
    "@evidence-dev/evidence": "^23.0.0",
    "@evidence-dev/duckdb": "^1.0.0"
  }
}
```

### 2. GitHub Actions

```yaml
# .github/workflows/evidence-dashboard.yml

name: Evidence Cost Dashboard

on:
  workflow_dispatch:
  schedule:
    - cron: '0 2 * * *'  # 毎日2:00 UTC

jobs:
  build-deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: evidence-dashboard/package-lock.json

      - name: Install dependencies
        working-directory: evidence-dashboard
        run: npm ci

      - name: Build Evidence
        working-directory: evidence-dashboard
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        run: npm run build

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy evidence-dashboard/build --project-name=cost-dashboard --branch=main
```

### 3. Cloudflare Accessで保護

```bash
# Cloudflare Dashboard > Zero Trust > Access > Applications

Application name: Cost Dashboard
Domain: cost-dashboard.pages.dev
Policy: Allow company employees (@yourcompany.com)
```

---

## 自動更新設定

### Workers Cron設定

```toml
# wrangler.toml

[triggers]
crons = ["0 1 * * *"]  # 毎日1:00 UTCにコストデータ収集
```

### Evidence再ビルド

GitHub Actionsで毎日自動ビルド・デプロイ（上記YAML参照）

---

## 高度な機能

### 1. コスト予測

```sql cost_forecast
WITH daily_costs AS (
  SELECT
    date,
    SUM(total_cost) as daily_total
  FROM read_json_auto('s3://cost-data/billing/*.json')
  WHERE date >= CURRENT_DATE - INTERVAL '30' DAY
  GROUP BY date
)
SELECT
  CURRENT_DATE + INTERVAL (row_number() OVER ()) DAY as forecast_date,
  AVG(daily_total) OVER (ORDER BY date ROWS BETWEEN 7 PRECEDING AND CURRENT ROW) as predicted_cost
FROM daily_costs
LIMIT 7  -- 7日間の予測
```

### 2. アラート設定

```javascript
// workers/cost-alert/index.js

export default {
  async scheduled(event, env, ctx) {
    const todayCost = await getTodayCost(env);
    const avgCost = await getAverageCost(env);

    if (todayCost > avgCost * 1.5) {
      // Slackにアラート送信
      await sendSlackAlert(env, {
        text: `⚠️ Cost Alert: Today's cost ($${todayCost}) is 50% higher than average ($${avgCost})`
      });
    }
  }
};
```

### 3. カスタムメトリクス

```sql custom_metrics
-- コスト効率指標（リクエストあたりコスト）
SELECT
  resource,
  SUM(total_cost) / SUM(quantity) as cost_per_request
FROM read_json_auto('s3://cost-data/billing/*.json')
WHERE service = 'Workers' AND metric = 'requests'
GROUP BY resource
```

---

## ベストプラクティス

### 1. データ保持期間

```javascript
// 90日より古いデータを削除
async function cleanupOldData(env) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);

  const objects = await env.COST_DATA_BUCKET.list({
    prefix: 'billing/'
  });

  for (const object of objects.objects) {
    const fileDate = new Date(object.key.replace('billing/', '').replace('.json', ''));
    if (fileDate < cutoffDate) {
      await env.COST_DATA_BUCKET.delete(object.key);
    }
  }
}
```

### 2. パフォーマンス最適化

```sql
-- DuckDBでのパーティション活用
SELECT *
FROM read_json_auto('s3://cost-data/billing/2025-*.json')
-- 年月でフィルタリング
```

### 3. セキュリティ

- Cloudflare Accessで認証
- API TokenはWorkers Secretsで管理
- R2バケットはプライベート設定

---

## トラブルシューティング

### DuckDB接続エラー

```bash
# httpfs拡張が読み込まれているか確認
INSTALL httpfs;
LOAD httpfs;
```

### R2認証エラー

```bash
# 環境変数を確認
echo $R2_ACCESS_KEY_ID
echo $R2_SECRET_ACCESS_KEY
```

---

## 参考リンク

- [Evidence Documentation](https://docs.evidence.dev/)
- [DuckDB Documentation](https://duckdb.org/docs/)
- [Cloudflare Billing API](https://developers.cloudflare.com/api/)

---

最終更新: 2025-12-26
