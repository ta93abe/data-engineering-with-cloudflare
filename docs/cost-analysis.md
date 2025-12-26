# Cloudflare Data Platform コスト分析

**最終更新: 2025年12月25日**

このドキュメントでは、R2 Data Catalog + Icebergベースのデータ基盤の料金を固定費と変動費に分けて詳しく分析します。

---

## 📊 料金体系サマリー

### 固定費（月額）

| サービス | プラン | 料金 | 備考 |
|---------|--------|------|------|
| **Cloudflare Account** | Free / Pro | **$0 - $20** | Workers有料プラン必要な場合 |
| **GitHub** | Free / Team | **$0 - $4/user** | Actions無料枠で十分な場合は$0 |
| **Evidence.dev** | Free / Pro | **$0 - $20** | Cloudflare Pagesで自己ホスト可能 |
| **DuckDB** | オープンソース | **$0** | ローカル実行 |
| **dbt Core** | オープンソース | **$0** | GitHub Actionsで実行 |
| **合計（最小構成）** | - | **$0/月** | 全て無料プランで運用可能 |
| **合計（推奨構成）** | - | **$5-25/月** | Workers Paidプラン推奨 |

### 変動費（従量課金）

| サービス | 単位 | 料金 | 無料枠 |
|---------|------|------|--------|
| **Workers Requests** | 100万リクエスト | $0.50 | 10万/日（300万/月） |
| **Workers CPU Time** | 100万GB-sec | $12.50 | Free: 10ms, Paid: 30s |
| **R2 Storage** | GB/月 | $0.015 | 10GB |
| **R2 Class A Operations** | 100万回 | $4.50 | 100万/月 |
| **R2 Class B Operations** | 100万回 | $0.36 | 1000万/月 |
| **R2 Data Catalog** | - | **$0 (ベータ)** | ベータ期間中無料 |
| **D1 Storage** | GB/月 | $0.75 | 5GB |
| **D1 Read** | 100万行 | $0.001 | 2500万/日 |
| **D1 Write** | 100万行 | $1.00 | 5万/日 |
| **KV Storage** | GB/月 | $0.50 | 1GB |
| **KV Reads** | 100万回 | $0.50 | 1000万/日 |
| **KV Writes** | 100万回 | $5.00 | 100万/日 |
| **Analytics Engine** | 100万行 | $0.25 | 1000万行/月 |

---

## 💰 想定コストシミュレーション

### シナリオ1: スタートアップ（小規模）

**想定利用量:**
- Workersリクエスト: 10万/日（300万/月）
- データ量: 50GB
- dltパイプライン: 1時間ごと（月720回）
- ユーザー数: 10人（ダッシュボード閲覧）

#### 固定費

```
Cloudflareアカウント: $0 (Freeプラン)
GitHub: $0 (Freeプラン、Actions 2,000分/月まで無料)
その他ツール: $0 (全てオープンソース)

合計固定費: $0/月
```

#### 変動費

```
【Workers】
- Requests: 300万/月 → 無料枠内 = $0
- CPU Time: 720回 × 5秒 = 3,600秒 → 無料枠内 = $0

【R2 Storage】
- Storage: 50GB × $0.015 = $0.75
- Class A (PUT): 720回 → 無料枠内 = $0
- Class B (GET): 7,200回 → 無料枠内 = $0

【R2 Data Catalog】
- ベータ版: $0

【D1】
- Storage: 1GB × $0.75 = $0.75
- Read: 100万行 → 無料枠内 = $0
- Write: 1万行 → 無料枠内 = $0

【KV】
- Storage: 0.1GB × $0.50 = $0.05
- Reads: 10万回 → 無料枠内 = $0
- Writes: 720回 → 無料枠内 = $0

【Analytics Engine】
- Write: 10万行 → 無料枠内 = $0

合計変動費: $1.55/月
```

**月額合計: $1.55**

---

### シナリオ2: 中規模スタートアップ

**想定利用量:**
- Workersリクエスト: 100万/日（3,000万/月）
- データ量: 500GB
- dltパイプライン: 15分ごと（月2,880回）
- ユーザー数: 100人

#### 固定費

```
Cloudflareアカウント: $5 (Workers Paid - Bundled)
GitHub: $0 (Freeプラン)
その他ツール: $0

合計固定費: $5/月
```

#### 変動費

```
【Workers】
- Requests: 3,000万 - 300万(無料) = 2,700万 → 27 × $0.50 = $13.50
- CPU Time: 2,880回 × 10秒 = 28,800秒 = 0.008 GB-sec → 無料枠内 = $0

【R2 Storage】
- Storage: 500GB × $0.015 = $7.50
- Class A (PUT): 2,880回 + α → 無料枠内 = $0
- Class B (GET): 100万回 → 無料枠内 = $0

【R2 Data Catalog】
- ベータ版: $0

【D1】
- Storage: 5GB × $0.75 = $3.75
- Read: 1,000万行 → 無料枠内 = $0
- Write: 10万行 → 無料枠内 = $0

【KV】
- Storage: 1GB × $0.50 = $0.50
- Reads: 1,000万回 → 無料枠内 = $0
- Writes: 2,880回 → 無料枠内 = $0

【Analytics Engine】
- Write: 500万行 → 無料枠内 = $0

合計変動費: $25.25/月
```

**月額合計: $30.25**

---

### シナリオ3: 成長企業（大規模）

**想定利用量:**
- Workersリクエスト: 1,000万/日（3億/月）
- データ量: 2TB
- dltパイプライン: 5分ごと（月8,640回）
- ユーザー数: 1,000人

#### 固定費

```
Cloudflareアカウント: $25 (Workers Paid - Unbound)
GitHub Team: $4/user × 5 = $20
その他ツール: $0

合計固定費: $45/月
```

#### 変動費

```
【Workers】
- Requests: 3億 - 300万(無料) = 2.97億 → 297 × $0.50 = $148.50
- CPU Time: 8,640回 × 15秒 = 129,600秒 = 0.036 GB-sec → 無料枠内 = $0

【R2 Storage】
- Storage: 2,000GB × $0.015 = $30.00
- Class A (PUT): 8,640回 + α → 無料枠内 = $0
- Class B (GET): 1,000万回 → 無料枠内 = $0

【R2 Data Catalog】
- ベータ版: $0 (GA後は$5-10想定)

【D1】
- Storage: 10GB × $0.75 = $7.50
- Read: 1億行 → (100,000 - 25,000) × $0.001 = $0.08
- Write: 50万行 → (50 - 5) × $1.00 = $45.00

【KV】
- Storage: 5GB × $0.50 = $2.50
- Reads: 5,000万回 → (50 - 10) × $0.50 = $20.00
- Writes: 100万回 → 無料枠内 = $0

【Analytics Engine】
- Write: 5,000万行 → (50 - 10) × $0.25 = $10.00

合計変動費: $263.58/月
```

**月額合計: $308.58**

---

## 📈 コスト内訳グラフ（シナリオ別）

### スタートアップ（$1.55/月）

```
R2 Storage: 48.4% ($0.75)
D1 Storage: 48.4% ($0.75)
KV Storage: 3.2% ($0.05)
その他: 0% (無料枠内)
```

### 中規模（$30.25/月）

```
Workers Requests: 44.6% ($13.50)
R2 Storage: 24.8% ($7.50)
固定費: 16.5% ($5.00)
D1 Storage: 12.4% ($3.75)
KV Storage: 1.7% ($0.50)
```

### 大規模（$308.58/月）

```
Workers Requests: 48.1% ($148.50)
D1 Write: 14.6% ($45.00)
固定費: 14.6% ($45.00)
R2 Storage: 9.7% ($30.00)
KV Reads: 6.5% ($20.00)
Analytics Engine: 3.2% ($10.00)
D1 Storage: 2.4% ($7.50)
KV Storage: 0.8% ($2.50)
その他: 0.1%
```

---

## 🔍 詳細分析: サービス別

### 1. Cloudflare Workers

**料金構造:**

| プラン | 月額 | リクエスト無料枠 | CPU時間 | 備考 |
|--------|------|-----------------|---------|------|
| Free | $0 | 10万/日 | 10ms | 開発・小規模向け |
| Paid (Bundled) | $5 | 1,000万/月 | 50ms | 中規模向け |
| Paid (Unbound) | $25 | 100万/月 | 400,000 GB-sec | 大規模・CPU集約 |

**超過料金:**
- リクエスト: $0.50 / 100万リクエスト
- CPU Time (Unbound): $12.50 / 100万 GB-sec

**Python Workers考慮:**
- dlt-iceberg-pipeline: 1実行10-30秒想定
- iceberg-converter: 1実行5-15秒想定
- 月間実行回数によって大きく変動

**最適化ポイント:**
- Cron Triggersを使って実行頻度を調整
- バッチサイズを増やして実行回数削減
- CPU集約的な処理はGitHub Actionsへ移行検討

---

### 2. R2 Object Storage

**料金構造:**

| 項目 | 料金 | 無料枠 |
|------|------|--------|
| Storage | $0.015/GB/月 | 10GB |
| Class A Operations (PUT, DELETE) | $4.50/100万 | 100万/月 |
| Class B Operations (GET, LIST) | $0.36/100万 | 1,000万/月 |
| **Egress (データ転送)** | **$0** | **無制限！** |

**R2の最大メリット:**
- エグレス無料 → S3比で大幅コスト削減
- 例: 月100GB転送 → S3なら$9、R2なら$0

**コスト見積もり例:**

```python
# 月間データ量
data_volume_gb = 500

# 月間増加量（dltパイプライン）
monthly_growth_gb = 50

# 年間コスト
annual_storage_cost = (data_volume_gb + monthly_growth_gb * 6) * 0.015 * 12
# = (500 + 300) * 0.015 * 12 = $144/年

# S3との比較（エグレス100GB/月想定）
s3_storage = 800 * 0.023 * 12  # $221
s3_egress = 100 * 9 * 12       # $10,800
s3_total = s3_storage + s3_egress  # $11,021

# R2
r2_storage = 800 * 0.015 * 12  # $144
r2_egress = 0                  # $0
r2_total = r2_storage          # $144

# 削減額: $10,877/年 (98.7%削減！)
```

---

### 3. R2 Data Catalog（Iceberg）

**現在の料金:**
- **ベータ期間中: $0**
- GA後の料金: 未発表（30日前通知）

**想定料金（GA後）:**

| 項目 | 予想料金 | 根拠 |
|------|---------|------|
| Catalog管理 | $5-10/月 | AWS Glueの1/10程度 |
| メタデータストレージ | $0.01/GB/月 | R2料金に含まれる可能性 |
| API呼び出し | $0.10/100万 | 低頻度アクセス想定 |

**参考: 他社料金**
- AWS Glue Data Catalog: $1.00/100万オブジェクト + $1.00/100万リクエスト
- Azure Purview: $0.30/GB/月（メタデータ）
- Cloudflareは1/5〜1/10を目指す可能性

**リスク対策:**
- ベータ期間中に十分テスト
- GA後料金発表を待ってから本番投入判断
- フォールバックプラン（PyIcebergローカルカタログ）を用意

---

### 4. D1 Database

**料金構造:**

| 項目 | 料金 | 無料枠/日 | 無料枠/月 |
|------|------|----------|----------|
| Storage | $0.75/GB/月 | - | 5GB |
| Read Units | $0.001/100万行 | 2,500万 | 7.5億 |
| Write Units | $1.00/100万行 | 5万 | 150万 |

**無料枠が非常に大きい:**
- Read: 月7.5億行まで無料
- Write: 月150万行まで無料

**コスト発生ケース:**
- 大量の書き込み（1日5万行超え）
- ストレージ5GB超え

**最適化:**
- メタデータのみD1に保存
- 大量データはR2 Icebergへ
- 集計結果のキャッシュに活用

---

### 5. Workers KV

**料金構造:**

| 項目 | 料金 | 無料枠/日 | 無料枠/月 |
|------|------|----------|----------|
| Storage | $0.50/GB/月 | - | 1GB |
| Read Operations | $0.50/100万 | 1,000万 | 3億 |
| Write Operations | $5.00/100万 | 100万 | 3,000万 |
| Delete/List Operations | $5.00/100万 | 100万 | 3,000万 |

**KVの最大の注意点:**
- **Write が高額** ($5/100万)
- Read は安価（$0.50/100万）

**推奨利用パターン:**
- 低頻度更新、高頻度読み取りデータ
- キャッシュレイヤーとして活用
- dlt状態管理、設定値保存

**アンチパターン:**
- リアルタイムイベントの書き込み → Analytics Engine推奨
- 頻繁に更新されるデータ → D1推奨

---

### 6. Analytics Engine

**料金構造:**

| 項目 | 料金 | 無料枠/月 |
|------|------|----------|
| Write | $0.25/100万行 | 1,000万行 |

**最もコストパフォーマンスが高い:**
- 無料枠: 月1,000万行
- 超過後も$0.25/100万行 = 激安

**推奨利用:**
- リアルタイムメトリクス
- イベントログ
- アクセスログ

**クエリ:**
- Workers Analytics Engineで集計
- R2 SQLでも分析可能

---

### 7. 外部サービス

#### GitHub Actions

**無料枠:**
- Public repo: 無制限
- Private repo: 2,000分/月

**超過料金:**
- Linux: $0.008/分
- Windows: $0.016/分
- macOS: $0.08/分

**想定コスト:**
- dltパイプライン（15分ごと）: 月2,880回 × 5分 = 14,400分
- 無料枠超過: 14,400 - 2,000 = 12,400分 → $99.20/月

**最適化:**
- Cloudflare Workflows への移行検討
- 実行頻度を調整（1時間ごと → 6時間ごと）
- セルフホストランナー利用

#### DuckDB

**完全無料:**
- オープンソース
- ローカル実行
- クラウド料金なし

#### dbt Core

**完全無料:**
- オープンソース
- GitHub Actionsで実行
- dbt Cloud不要

---

## 🎯 コスト最適化戦略

### 即効性のある施策

#### 1. Workers実行頻度の調整

```toml
# wrangler.toml
[[workers.triggers.crons]]
# Before: 15分ごと (月2,880回)
# crons = ["*/15 * * * *"]

# After: 1時間ごと (月720回)
crons = ["0 * * * *"]

# コスト削減: Workers CPU時間 75%減
```

#### 2. R2パーティション最適化

```python
# dltパイプライン
# Before: 時間別パーティション (月720パーティション)
layout = "{table}/year={year}/month={month}/day={day}/hour={hour}/{file_id}.{ext}"

# After: 日別パーティション (月30パーティション)
layout = "{table}/year={year}/month={month}/day={day}/{file_id}.{ext}"

# メリット: メタデータサイズ削減、クエリ高速化
```

#### 3. KV書き込み削減

```javascript
// Before: 毎回書き込み
await env.KV.put(`state:${pipeline}`, state);

// After: 変更時のみ書き込み
const current = await env.KV.get(`state:${pipeline}`);
if (current !== state) {
  await env.KV.put(`state:${pipeline}`, state);
}

// コスト削減: KV Write 50-80%減
```

#### 4. データライフサイクル管理

```javascript
// workers/lifecycle/archive_old_data.js
export default {
  async scheduled(event, env) {
    // 90日以上経過したRawデータを削除
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await deleteOldObjects(env.RAW_BUCKET, ninetyDaysAgo);
  }
}

// コスト削減: R2 Storage 30-50%減
```

### 中長期的な施策

#### 5. Incremental dbtモデル

```sql
-- models/marts/fct_daily_metrics.sql
{{ config(
    materialized='incremental',
    unique_key='date'
) }}

SELECT ...
FROM {{ ref('stg_events') }}
{% if is_incremental() %}
WHERE event_date > (SELECT MAX(date) FROM {{ this }})
{% endif %}

-- コスト削減: dbt実行時間 70-90%減
```

#### 6. Workflowsへの移行

```python
# Cloudflare Workflows (Beta)
# GitHub Actions の代替

from cloudflare import workflow

@workflow.task
async def run_dlt_pipeline():
    # dltパイプライン実行
    pass

@workflow.task
async def run_dbt_models():
    # dbtモデル実行
    pass

# メリット: GitHub Actions料金 $0化
```

---

## 💡 コスト試算ツール

### Excel/Google Sheets計算式

```
【月額コスト計算】

=固定費 + 変動費

【固定費】
=IF(Workersプラン="Free", 0, IF(Workersプラン="Bundled", 5, 25))

【変動費】
=Workers料金 + R2料金 + D1料金 + KV料金 + AnalyticsEngine料金

【Workers料金】
=MAX(0, (月間リクエスト数 - 無料枠) / 1000000 * 0.5)

【R2料金】
=MAX(0, データ量GB - 10) * 0.015

【D1料金】
=MAX(0, ストレージGB - 5) * 0.75
 + MAX(0, (月間Read行数 - 750000000) / 1000000 * 0.001)
 + MAX(0, (月間Write行数 - 1500000) / 1000000 * 1.0)
```

### Python コスト計算スクリプト

```python
# scripts/cost_calculator.py

def calculate_monthly_cost(
    workers_requests_per_month: int,
    r2_storage_gb: int,
    d1_storage_gb: int = 1,
    d1_read_rows: int = 1_000_000,
    d1_write_rows: int = 10_000,
    kv_storage_gb: float = 0.1,
    kv_reads: int = 100_000,
    kv_writes: int = 1_000,
    analytics_engine_writes: int = 100_000,
    workers_plan: str = "free"  # "free", "bundled", "unbound"
):
    """月額コスト計算"""

    # 固定費
    fixed_cost = {
        "free": 0,
        "bundled": 5,
        "unbound": 25
    }[workers_plan]

    # Workers
    free_requests = {
        "free": 3_000_000,  # 10万/日 × 30
        "bundled": 10_000_000,
        "unbound": 1_000_000
    }[workers_plan]

    workers_cost = max(0, (workers_requests_per_month - free_requests) / 1_000_000 * 0.5)

    # R2
    r2_cost = max(0, r2_storage_gb - 10) * 0.015

    # D1
    d1_storage_cost = max(0, d1_storage_gb - 5) * 0.75
    d1_read_cost = max(0, (d1_read_rows - 750_000_000) / 1_000_000 * 0.001)
    d1_write_cost = max(0, (d1_write_rows - 1_500_000) / 1_000_000 * 1.0)
    d1_cost = d1_storage_cost + d1_read_cost + d1_write_cost

    # KV
    kv_storage_cost = max(0, kv_storage_gb - 1) * 0.5
    kv_read_cost = max(0, (kv_reads - 300_000_000) / 1_000_000 * 0.5)
    kv_write_cost = max(0, (kv_writes - 30_000_000) / 1_000_000 * 5.0)
    kv_cost = kv_storage_cost + kv_read_cost + kv_write_cost

    # Analytics Engine
    analytics_cost = max(0, (analytics_engine_writes - 10_000_000) / 1_000_000 * 0.25)

    # 合計
    total_variable = workers_cost + r2_cost + d1_cost + kv_cost + analytics_cost
    total = fixed_cost + total_variable

    return {
        "fixed_cost": fixed_cost,
        "variable_cost": total_variable,
        "total": total,
        "breakdown": {
            "workers": workers_cost,
            "r2": r2_cost,
            "d1": d1_cost,
            "kv": kv_cost,
            "analytics_engine": analytics_cost
        }
    }

# 使用例
if __name__ == "__main__":
    # 中規模スタートアップ想定
    result = calculate_monthly_cost(
        workers_requests_per_month=30_000_000,
        r2_storage_gb=500,
        d1_storage_gb=5,
        workers_plan="bundled"
    )

    print(f"月額コスト: ${result['total']:.2f}")
    print(f"  固定費: ${result['fixed_cost']:.2f}")
    print(f"  変動費: ${result['variable_cost']:.2f}")
    print("\n内訳:")
    for service, cost in result['breakdown'].items():
        print(f"  {service}: ${cost:.2f}")
```

---

## 📊 競合サービスとのコスト比較

### AWS（S3 + Glue + Lambda）

| サービス | AWS | Cloudflare | 削減率 |
|---------|-----|------------|--------|
| Storage (500GB) | $11.50 | $7.50 | 35% |
| Egress (100GB/月) | $900 | $0 | 100% |
| Catalog | $50 | $0 (ベータ) | 100% |
| Compute | $20 | $13.50 | 33% |
| **月額合計** | **$981.50** | **$21.00** | **98%** |

### Google Cloud（GCS + BigQuery）

| サービス | GCP | Cloudflare | 削減率 |
|---------|-----|------------|--------|
| Storage (500GB) | $10.00 | $7.50 | 25% |
| Egress (100GB/月) | $1,200 | $0 | 100% |
| Query | $50 | $0 | 100% |
| Compute | $25 | $13.50 | 46% |
| **月額合計** | **$1,285** | **$21.00** | **98%** |

### Snowflake

| サービス | Snowflake | Cloudflare | 削減率 |
|---------|-----------|------------|--------|
| Storage (500GB) | $23.00 | $7.50 | 67% |
| Compute | $200 | $13.50 | 93% |
| Egress | $100 | $0 | 100% |
| **月額合計** | **$323** | **$21.00** | **94%** |

**削減額: 月$300〜$1,260 = 年$3,600〜$15,120**

---

## 🎯 コスト管理ベストプラクティス

### 1. 予算アラート設定

```javascript
// workers/monitoring/cost_alert.js
export default {
  async scheduled(event, env) {
    // 月初にコスト予測
    const usage = await getMonthlyUsage(env);
    const projected = usage.current_spend * 30 / new Date().getDate();

    if (projected > env.BUDGET_THRESHOLD) {
      await notifySlack(
        `⚠️ コスト予算超過の可能性\n` +
        `今月の予測: $${projected.toFixed(2)}\n` +
        `予算: $${env.BUDGET_THRESHOLD}`
      );
    }
  }
}
```

### 2. 使用量ダッシュボード

```sql
-- Evidence.dev ダッシュボード
-- sources/daily_costs.sql

SELECT
  date,
  service,
  cost_usd,
  SUM(cost_usd) OVER (
    PARTITION BY DATE_TRUNC('month', date)
    ORDER BY date
  ) as month_to_date_cost
FROM analytics_engine.costs
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC
```

### 3. 定期レビュー

**週次:**
- Workers実行回数チェック
- R2ストレージ増加率確認
- 異常な増加の検知

**月次:**
- 全サービスのコスト分析
- 最適化施策の効果測定
- 次月予算の設定

---

## 📝 まとめ

### 料金レンジ

| 規模 | 月額コスト | 年額コスト |
|------|----------|----------|
| **小規模（スタートアップ）** | $1.55 - $5 | $18.60 - $60 |
| **中規模** | $25 - $50 | $300 - $600 |
| **大規模** | $200 - $500 | $2,400 - $6,000 |
| **エンタープライズ** | $500 - $2,000 | $6,000 - $24,000 |

### 固定費 vs 変動費の割合

| 規模 | 固定費 | 変動費 |
|------|--------|--------|
| 小規模 | 0% | 100% (全て無料枠) |
| 中規模 | 17% | 83% |
| 大規模 | 15% | 85% |

### コスト削減ポイント

1. **R2エグレス無料** → 最大98%削減（vs AWS/GCP）
2. **無料枠の活用** → 小規模なら$0-5/月で運用可能
3. **実行頻度の調整** → Workers/GitHubコスト最大75%削減
4. **データライフサイクル** → ストレージコスト30-50%削減
5. **Incremental dbt** → 処理時間70-90%削減

### 推奨構成

**最小コスト（$1.55/月）:**
- Cloudflare Free
- 全て無料枠内で運用

**推奨構成（$25-30/月）:**
- Workers Bundled ($5)
- R2 500GB ($7.50)
- その他サービス ($12-17)
- 中規模スタートアップに最適

**スケール可能（$300/月）:**
- Workers Unbound ($25)
- R2 2TB ($30)
- D1/KV/Analytics ($245)
- 成長企業向け

---

**最終更新**: 2025年12月25日
**料金は変更される可能性があります。最新情報は公式サイトを確認してください。**
