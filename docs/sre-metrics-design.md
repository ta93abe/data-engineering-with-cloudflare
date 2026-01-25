# SRE指標設計ドキュメント

## 1. 概要

本ドキュメントでは、Cloudflareベースのデータ基盤におけるSRE（Site Reliability Engineering）指標を定義します。SLI、SLO、SLA、エラーバジェットを体系的に設計し、信頼性の定量的な管理を実現します。

### 1.1 対象サービス

| サービス | 説明 | 重要度 |
|---------|------|--------|
| **MCPサーバー** | Rust製Workers、LLMからのデータアクセス提供 | Critical |
| **データパイプライン** | ETL/ELT処理、dbt変換、Cloudflare Pipelines | High |
| **API全般** | Workers API、データ取得・更新エンドポイント | High |

### 1.2 指標の階層

```
SLA（契約）
  └── SLO（目標）
        └── SLI（指標）
              └── メトリクス（計測値）
```

### 1.3 アーキテクチャ図

詳細なアーキテクチャ図は以下を参照してください：

- [SRE監視アーキテクチャ図](./diagrams/sre-architecture.mermaid.md)
  - メトリクス収集フロー
  - SLO計算・エラーバジェット管理
  - アラートフロー
  - 全体アーキテクチャ
  - エラーバジェットポリシー（状態遷移）
  - データフロー詳細（シーケンス図）

---

## 2. SLI（Service Level Indicators）

SLIはサービスの振る舞いを定量的に測定する指標です。

### 2.1 可用性（Availability）

**定義**: サービスが正常に応答したリクエストの割合

```
Availability = (成功リクエスト数) / (総リクエスト数) × 100%
```

#### MCPサーバー

| メトリクス | 計測方法 | 成功の定義 |
|-----------|---------|-----------|
| リクエスト成功率 | Analytics Engine | HTTP 2xx/3xx レスポンス |
| ヘルスチェック成功率 | Workers Cron | `/health` エンドポイント200応答 |

#### データパイプライン

| メトリクス | 計測方法 | 成功の定義 |
|-----------|---------|-----------|
| パイプライン完了率 | D1 + Analytics Engine | 正常終了（exit code 0） |
| dbtモデル成功率 | Elementary | テスト通過 + モデル実行成功 |
| Pipelines取り込み成功率 | Cloudflare Pipelines メトリクス | イベント取り込み完了 |

#### API全般

| メトリクス | 計測方法 | 成功の定義 |
|-----------|---------|-----------|
| API成功率 | Analytics Engine | 非5xxレスポンス |
| 認証成功率 | Cloudflare Access ログ | 認証・認可成功 |

### 2.2 レイテンシ（Latency）

**定義**: リクエストの応答時間（パーセンタイル値で評価）

```
Latency SLI = P99 < 閾値 を満たすリクエストの割合
```

#### MCPサーバー

| メトリクス | 計測ポイント | 推奨閾値 |
|-----------|------------|---------|
| P50（中央値） | Workers実行開始〜レスポンス | < 50ms |
| P95 | Workers実行開始〜レスポンス | < 150ms |
| P99 | Workers実行開始〜レスポンス | < 300ms |

#### データパイプライン

| メトリクス | 計測ポイント | 推奨閾値 |
|-----------|------------|---------|
| パイプライン実行時間 | 開始〜完了 | ジョブ依存（SLO参照） |
| dbtモデル実行時間 | モデル単位 | < 5分/モデル |
| Pipelines End-to-End | イベント送信〜Iceberg書き込み | < 60秒 |

#### API全般

| メトリクス | 計測ポイント | 推奨閾値 |
|-----------|------------|---------|
| 読み取りAPI P99 | リクエスト〜レスポンス | < 200ms |
| 書き込みAPI P99 | リクエスト〜レスポンス | < 500ms |
| バルク操作 P99 | リクエスト〜レスポンス | < 5秒 |

### 2.3 スループット（Throughput）

**定義**: 単位時間あたりの処理能力

```
Throughput = 処理リクエスト数 / 時間単位
```

#### MCPサーバー

| メトリクス | 計測単位 | 期待値 |
|-----------|---------|--------|
| リクエスト/秒 | RPS | > 100 RPS |
| 同時接続数 | 接続数 | > 50 concurrent |

#### データパイプライン

| メトリクス | 計測単位 | 期待値 |
|-----------|---------|--------|
| イベント処理量 | イベント/秒 | Pipelines上限: 100 MB/秒 |
| dbtモデル処理量 | モデル/時間 | プロジェクト依存 |
| バッチジョブ完了 | ジョブ/日 | スケジュール依存 |

---

## 3. SLO（Service Level Objectives）

SLOはサービス品質の目標値です。達成すべき信頼性の基準を定義します。

### 3.1 MCPサーバー SLO

| SLO ID | 指標 | 目標値 | 計測期間 | 優先度 |
|--------|------|--------|---------|--------|
| MCP-AV-01 | 可用性 | 99.9% | 30日ローリング | P0 |
| MCP-LAT-01 | P99レイテンシ | < 300ms | 30日ローリング | P0 |
| MCP-LAT-02 | P50レイテンシ | < 50ms | 30日ローリング | P1 |
| MCP-THR-01 | スループット | > 100 RPS | ピーク時 | P1 |

### 3.2 データパイプライン SLO

| SLO ID | 指標 | 目標値 | 計測期間 | 優先度 |
|--------|------|--------|---------|--------|
| PIPE-AV-01 | パイプライン成功率 | 99.5% | 30日ローリング | P0 |
| PIPE-AV-02 | dbtモデル成功率 | 99.0% | 7日ローリング | P1 |
| PIPE-FRESH-01 | データ鮮度 | < 1時間 | 継続的 | P0 |
| PIPE-FRESH-02 | イベント遅延 | < 5分 | 継続的 | P1 |

### 3.3 API全般 SLO

| SLO ID | 指標 | 目標値 | 計測期間 | 優先度 |
|--------|------|--------|---------|--------|
| API-AV-01 | API可用性 | 99.9% | 30日ローリング | P0 |
| API-LAT-01 | 読み取りP99 | < 200ms | 30日ローリング | P0 |
| API-LAT-02 | 書き込みP99 | < 500ms | 30日ローリング | P1 |
| API-ERR-01 | エラー率 | < 0.1% | 24時間ローリング | P0 |

### 3.4 SLO優先度の定義

| 優先度 | 説明 | 違反時の対応 |
|--------|------|-------------|
| **P0** | ビジネスクリティカル | 即座にインシデント対応開始 |
| **P1** | 重要 | 24時間以内に対応開始 |
| **P2** | 通常 | 次スプリントで対応 |

---

## 4. SLA（Service Level Agreements）

SLAは外部への契約上のコミットメントです。SLOより保守的な値を設定します。

### 4.1 SLA設計原則

```
SLA < SLO（通常 SLA = SLO - マージン）

例:
- SLO 99.9% の場合 → SLA 99.5%
- SLO P99 < 300ms の場合 → SLA P99 < 500ms
```

### 4.2 サービス別SLA

#### MCPサーバー（Internal SLA）

| 項目 | SLA値 | ペナルティ |
|------|-------|-----------|
| 月間可用性 | 99.5% | 内部エスカレーション |
| P99レイテンシ | < 500ms | 改善タスク発行 |

#### データパイプライン（Internal SLA）

| 項目 | SLA値 | ペナルティ |
|------|-------|-----------|
| 日次パイプライン成功率 | 95% | アラート・調査 |
| データ鮮度 | < 2時間 | 優先度付き対応 |

#### API全般（Internal SLA）

| 項目 | SLA値 | ペナルティ |
|------|-------|-----------|
| 月間可用性 | 99.5% | 内部レビュー |
| P99レイテンシ | < 1秒 | パフォーマンス改善 |

### 4.3 除外事項（Exclusions）

以下の状況はSLA計算から除外されます：

1. **計画メンテナンス**: 事前通知された停止
2. **Cloudflare障害**: プラットフォーム側の障害
3. **外部依存**: 外部API・サービスの障害
4. **DDoS攻撃**: 大規模な悪意あるトラフィック
5. **顧客起因**: 不正なリクエスト・過負荷

---

## 5. エラーバジェット

エラーバジェットは「許容される失敗の量」を定量化し、信頼性と開発速度のバランスを取ります。

### 5.1 エラーバジェット計算

```
エラーバジェット = 100% - SLO目標値

例: SLO 99.9% の場合
エラーバジェット = 100% - 99.9% = 0.1%
```

### 5.2 時間換算

| SLO | エラーバジェット | 30日間の許容ダウンタイム |
|-----|----------------|------------------------|
| 99.9% | 0.1% | 43.2分 |
| 99.5% | 0.5% | 216分（3.6時間） |
| 99.0% | 1.0% | 432分（7.2時間） |

### 5.3 エラーバジェット消費率

```
消費率 = (実際のエラー時間) / (許容エラー時間) × 100%
```

#### 消費率アラート閾値

| 消費率 | 状態 | アクション |
|--------|------|-----------|
| 0-50% | 正常 | 通常開発継続 |
| 50-75% | 警告 | リスク評価・慎重な変更 |
| 75-90% | 危険 | 機能開発凍結・安定化優先 |
| 90-100% | 緊急 | 新規リリース停止・信頼性改善のみ |
| >100% | 違反 | インシデント対応・ポストモーテム |

### 5.4 サービス別エラーバジェット

#### MCPサーバー（30日間）

| SLO ID | SLO | エラーバジェット | 許容時間 |
|--------|-----|----------------|---------|
| MCP-AV-01 | 99.9% | 0.1% | 43.2分 |

#### データパイプライン（30日間）

| SLO ID | SLO | エラーバジェット | 許容失敗数 |
|--------|-----|----------------|-----------|
| PIPE-AV-01 | 99.5% | 0.5% | 216分相当 |
| PIPE-AV-02 | 99.0% | 1.0% | 7日間で約1.7時間 |

#### API全般（30日間）

| SLO ID | SLO | エラーバジェット | 許容時間 |
|--------|-----|----------------|---------|
| API-AV-01 | 99.9% | 0.1% | 43.2分 |

### 5.5 エラーバジェットポリシー

#### バジェット残量に応じた開発方針

```yaml
budget_policy:
  healthy (0-50%):
    - 新機能開発: 許可
    - リスクのある変更: 許可（レビュー必須）
    - 実験的機能: 許可

  warning (50-75%):
    - 新機能開発: 許可
    - リスクのある変更: 慎重に検討
    - 実験的機能: 延期推奨

  critical (75-90%):
    - 新機能開発: 低リスクのみ
    - リスクのある変更: 禁止
    - 信頼性改善: 優先

  exhausted (90-100%):
    - 新機能開発: 停止
    - 信頼性改善: 最優先
    - バグ修正のみ許可

  violated (>100%):
    - すべてのリリース停止
    - インシデント対応モード
    - ポストモーテム必須
```

---

## 6. 監視・計測アーキテクチャ

> 視覚的なアーキテクチャ図は [SRE監視アーキテクチャ図](./diagrams/sre-architecture.mermaid.md) を参照してください。

### 6.1 メトリクス収集フロー

```
┌─────────────────────────────────────────────────────────────────┐
│                    データ収集レイヤー                            │
├─────────────────────────────────────────────────────────────────┤
│  Workers         Pipelines       dbt/Elementary    外部API     │
│     │                │                │               │        │
│     └────────────────┴────────────────┴───────────────┘        │
│                            │                                    │
│                            ▼                                    │
│                   Analytics Engine                              │
│                   (時系列メトリクス)                             │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ストレージレイヤー                            │
├─────────────────────────────────────────────────────────────────┤
│  Analytics Engine    D1 (集計)        R2 (生ログ)              │
│  - リアルタイム      - SLO状態        - 詳細ログ                │
│  - 高カーディナリティ - エラーバジェット - 履歴データ            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    可視化・アラートレイヤー                      │
├─────────────────────────────────────────────────────────────────┤
│  Evidence Dashboard     Elementary       Slack/Email           │
│  - SLO/エラーバジェット  - データ品質     - アラート通知         │
│  - トレンド分析         - パイプライン    - エスカレーション     │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 メトリクス記録スキーマ

#### Analytics Engine データポイント

```typescript
// SLI記録用データポイント
interface SliDataPoint {
  blobs: [
    string,  // service_name: "mcp-server" | "pipeline" | "api"
    string,  // endpoint: "/health" | "/api/query" など
    string,  // status: "success" | "error"
    string,  // error_type?: "timeout" | "5xx" | "validation"
  ];
  doubles: [
    number,  // latency_ms
    number,  // request_size_bytes
    number,  // response_size_bytes
  ];
  indexes: [
    string,  // timestamp ISO8601
  ];
}

// 使用例
env.ANALYTICS.writeDataPoint({
  blobs: ["mcp-server", "/api/query", "success", ""],
  doubles: [45.2, 1024, 4096],
  indexes: [new Date().toISOString()]
});
```

#### D1 SLOステータステーブル

```sql
-- SLO状態管理テーブル
CREATE TABLE slo_status (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  slo_id TEXT NOT NULL,
  target_value REAL NOT NULL,
  current_value REAL NOT NULL,
  period_start DATETIME NOT NULL,
  period_end DATETIME NOT NULL,
  is_met BOOLEAN NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- エラーバジェット管理テーブル
CREATE TABLE error_budget (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  slo_id TEXT NOT NULL,
  budget_total_minutes REAL NOT NULL,
  budget_consumed_minutes REAL NOT NULL,
  consumption_rate REAL NOT NULL,
  status TEXT NOT NULL, -- 'healthy' | 'warning' | 'critical' | 'exhausted' | 'violated'
  period_start DATETIME NOT NULL,
  period_end DATETIME NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- インシデント記録テーブル
CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  slo_id TEXT NOT NULL,
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  duration_minutes REAL,
  impact_description TEXT,
  root_cause TEXT,
  resolution TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 6.3 SLO計算クエリ

#### 可用性SLO計算（Analytics Engine SQL）

```sql
-- 30日間のMCPサーバー可用性
SELECT
  toStartOfDay(timestamp) AS day,
  countIf(status = 'success') AS success_count,
  count() AS total_count,
  round(countIf(status = 'success') * 100.0 / count(), 3) AS availability_pct
FROM sli_metrics
WHERE
  service_name = 'mcp-server'
  AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day;

-- 30日ローリング可用性
SELECT
  round(countIf(status = 'success') * 100.0 / count(), 3) AS rolling_availability
FROM sli_metrics
WHERE
  service_name = 'mcp-server'
  AND timestamp >= now() - INTERVAL 30 DAY;
```

#### レイテンシSLO計算

```sql
-- P99レイテンシ計算
SELECT
  quantile(0.99)(latency_ms) AS p99_latency,
  quantile(0.95)(latency_ms) AS p95_latency,
  quantile(0.50)(latency_ms) AS p50_latency
FROM sli_metrics
WHERE
  service_name = 'mcp-server'
  AND timestamp >= now() - INTERVAL 30 DAY;

-- レイテンシSLO達成率（P99 < 300ms を満たすリクエストの割合）
SELECT
  round(countIf(latency_ms < 300) * 100.0 / count(), 3) AS latency_slo_met_pct
FROM sli_metrics
WHERE
  service_name = 'mcp-server'
  AND timestamp >= now() - INTERVAL 30 DAY;
```

### 6.4 アラート設定

#### アラートルール定義

```yaml
alerts:
  # 可用性アラート
  - name: mcp_availability_warning
    condition: availability < 99.95%
    window: 1h
    severity: warning
    channels: [slack]

  - name: mcp_availability_critical
    condition: availability < 99.9%
    window: 1h
    severity: critical
    channels: [slack, pagerduty]

  # レイテンシアラート
  - name: mcp_latency_warning
    condition: p99_latency > 250ms
    window: 15m
    severity: warning
    channels: [slack]

  - name: mcp_latency_critical
    condition: p99_latency > 300ms
    window: 15m
    severity: critical
    channels: [slack, pagerduty]

  # エラーバジェットアラート
  - name: error_budget_warning
    condition: consumption_rate > 50%
    severity: warning
    channels: [slack]

  - name: error_budget_critical
    condition: consumption_rate > 75%
    severity: critical
    channels: [slack, email]

  - name: error_budget_exhausted
    condition: consumption_rate > 90%
    severity: emergency
    channels: [slack, pagerduty, email]

  # パイプラインアラート
  - name: pipeline_failure
    condition: pipeline_success_rate < 95%
    window: 24h
    severity: warning
    channels: [slack]

  - name: data_freshness_violation
    condition: data_age > 1h
    severity: critical
    channels: [slack, pagerduty]
```

---

## 7. 実装ガイド

### 7.1 Workers でのSLI計測実装

#### メトリクス収集ミドルウェア（TypeScript）

```typescript
// src/middleware/sli-collector.ts

interface SliContext {
  startTime: number;
  service: string;
  endpoint: string;
}

export function createSliMiddleware(env: Env, service: string) {
  return async function sliMiddleware(
    request: Request,
    next: () => Promise<Response>
  ): Promise<Response> {
    const startTime = performance.now();
    const endpoint = new URL(request.url).pathname;

    let status = 'success';
    let errorType = '';
    let response: Response;

    try {
      response = await next();

      if (response.status >= 500) {
        status = 'error';
        errorType = '5xx';
      } else if (response.status >= 400) {
        status = 'error';
        errorType = '4xx';
      }
    } catch (error) {
      status = 'error';
      errorType = error instanceof Error ? error.name : 'unknown';
      throw error;
    } finally {
      const latencyMs = performance.now() - startTime;

      // Analytics Engineへ記録
      env.ANALYTICS.writeDataPoint({
        blobs: [service, endpoint, status, errorType],
        doubles: [latencyMs],
        indexes: [new Date().toISOString()]
      });
    }

    return response;
  };
}
```

#### Rust Workers での実装

```rust
// src/sli.rs

use worker::*;
use std::time::Instant;

pub struct SliCollector {
    service: String,
    analytics: AnalyticsEngine,
}

impl SliCollector {
    pub fn new(service: &str, analytics: AnalyticsEngine) -> Self {
        Self {
            service: service.to_string(),
            analytics,
        }
    }

    pub async fn record<F, Fut>(&self, endpoint: &str, handler: F) -> Result<Response>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Response>>,
    {
        let start = Instant::now();
        let mut status = "success";
        let mut error_type = "";

        let result = handler().await;

        let latency_ms = start.elapsed().as_secs_f64() * 1000.0;

        match &result {
            Ok(response) if response.status_code() >= 500 => {
                status = "error";
                error_type = "5xx";
            }
            Ok(response) if response.status_code() >= 400 => {
                status = "error";
                error_type = "4xx";
            }
            Err(_) => {
                status = "error";
                error_type = "exception";
            }
            _ => {}
        }

        self.analytics.write_data_point(DataPoint {
            blobs: vec![
                self.service.clone(),
                endpoint.to_string(),
                status.to_string(),
                error_type.to_string(),
            ],
            doubles: vec![latency_ms],
            indexes: vec![chrono::Utc::now().to_rfc3339()],
        })?;

        result
    }
}
```

### 7.2 SLO計算Worker

```typescript
// workers/slo-calculator/src/index.ts

export default {
  // 1時間ごとに実行
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const calculator = new SloCalculator(env);

    // 各サービスのSLO計算
    await Promise.all([
      calculator.calculateServiceSlo('mcp-server'),
      calculator.calculateServiceSlo('pipeline'),
      calculator.calculateServiceSlo('api'),
    ]);

    // エラーバジェット更新
    await calculator.updateErrorBudgets();

    // アラートチェック
    await calculator.checkAlerts();
  }
};

class SloCalculator {
  constructor(private env: Env) {}

  async calculateServiceSlo(service: string) {
    // Analytics Engineからメトリクス取得
    const query = `
      SELECT
        countIf(blob1 = 'success') as success,
        count() as total,
        quantile(0.99)(double1) as p99_latency
      FROM sli_metrics
      WHERE
        blob0 = '${service}'
        AND timestamp >= now() - INTERVAL 30 DAY
    `;

    const result = await this.env.ANALYTICS.query(query);

    // D1にSLO状態を保存
    await this.env.DB.prepare(`
      INSERT OR REPLACE INTO slo_status
      (id, service, slo_id, target_value, current_value, period_start, period_end, is_met, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `${service}-availability-30d`,
      service,
      `${service.toUpperCase()}-AV-01`,
      99.9,
      result.success / result.total * 100,
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      new Date().toISOString(),
      result.success / result.total * 100 >= 99.9,
      new Date().toISOString()
    ).run();
  }

  async updateErrorBudgets() {
    // エラーバジェット計算と更新
    const services = ['mcp-server', 'pipeline', 'api'];

    for (const service of services) {
      const sloStatus = await this.env.DB.prepare(`
        SELECT * FROM slo_status WHERE service = ? AND slo_id LIKE '%-AV-01'
      `).bind(service).first();

      if (!sloStatus) continue;

      const targetValue = sloStatus.target_value as number;
      const currentValue = sloStatus.current_value as number;

      // 30日間の許容ダウンタイム（分）
      const budgetTotalMinutes = (100 - targetValue) / 100 * 30 * 24 * 60;

      // 消費済みダウンタイム（分）
      const budgetConsumedMinutes = (100 - currentValue) / 100 * 30 * 24 * 60;

      const consumptionRate = budgetConsumedMinutes / budgetTotalMinutes * 100;

      let status: string;
      if (consumptionRate <= 50) status = 'healthy';
      else if (consumptionRate <= 75) status = 'warning';
      else if (consumptionRate <= 90) status = 'critical';
      else if (consumptionRate <= 100) status = 'exhausted';
      else status = 'violated';

      await this.env.DB.prepare(`
        INSERT OR REPLACE INTO error_budget
        (id, service, slo_id, budget_total_minutes, budget_consumed_minutes,
         consumption_rate, status, period_start, period_end, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `${service}-budget-30d`,
        service,
        `${service.toUpperCase()}-AV-01`,
        budgetTotalMinutes,
        budgetConsumedMinutes,
        consumptionRate,
        status,
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        new Date().toISOString(),
        new Date().toISOString()
      ).run();
    }
  }

  async checkAlerts() {
    // エラーバジェットアラートチェック
    const budgets = await this.env.DB.prepare(`
      SELECT * FROM error_budget WHERE status IN ('warning', 'critical', 'exhausted', 'violated')
    `).all();

    for (const budget of budgets.results) {
      await this.sendAlert(budget);
    }
  }

  private async sendAlert(budget: any) {
    // Slack通知
    await fetch(this.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `⚠️ エラーバジェットアラート: ${budget.service}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*サービス*: ${budget.service}\n*SLO*: ${budget.slo_id}\n*消費率*: ${budget.consumption_rate.toFixed(1)}%\n*状態*: ${budget.status}`
            }
          }
        ]
      })
    });
  }
}
```

### 7.3 ダッシュボード構成（Evidence）

```markdown
<!-- pages/sre-dashboard.md -->

# SREダッシュボード

```sql slo_status
SELECT * FROM slo_status ORDER BY service, slo_id
```

```sql error_budgets
SELECT * FROM error_budget ORDER BY consumption_rate DESC
```

## SLO状態サマリー

<DataTable data={slo_status} />

## エラーバジェット状況

<BarChart
  data={error_budgets}
  x=service
  y=consumption_rate
  yAxisTitle="消費率 (%)"
  colorPalette={['#22c55e', '#eab308', '#f97316', '#ef4444']}
/>

## 30日間の可用性トレンド

```sql availability_trend
SELECT
  date,
  service,
  availability
FROM daily_availability
WHERE date >= current_date - 30
ORDER BY date, service
```

<LineChart
  data={availability_trend}
  x=date
  y=availability
  series=service
  yAxisTitle="可用性 (%)"
  yMin=99
  yMax=100
/>
```

---

## 8. ポストモーテム テンプレート

SLO違反やインシデント発生時に使用するテンプレートです。

```markdown
# ポストモーテム: [インシデント名]

## 概要

| 項目 | 内容 |
|------|------|
| インシデントID | INC-YYYY-MMDD-XXX |
| 発生日時 | YYYY-MM-DD HH:MM UTC |
| 検知日時 | YYYY-MM-DD HH:MM UTC |
| 解決日時 | YYYY-MM-DD HH:MM UTC |
| 影響時間 | X時間Y分 |
| 影響サービス | MCPサーバー / パイプライン / API |
| 影響SLO | MCP-AV-01 |
| エラーバジェット消費 | X分 (Y%) |

## タイムライン

| 時刻 | イベント |
|------|---------|
| HH:MM | 最初の異常検知 |
| HH:MM | アラート発報 |
| HH:MM | 調査開始 |
| HH:MM | 原因特定 |
| HH:MM | 修正適用 |
| HH:MM | サービス復旧確認 |

## 影響

- 影響を受けたユーザー数: XXX
- 失敗したリクエスト数: XXX
- データ損失: なし / あり（詳細）

## 根本原因

[根本原因の詳細な説明]

## 改善アクション

| アクション | 担当 | 期限 | ステータス |
|-----------|------|------|-----------|
| [アクション1] | @担当者 | YYYY-MM-DD | TODO |
| [アクション2] | @担当者 | YYYY-MM-DD | TODO |

## 学び

- 何がうまくいったか
- 何がうまくいかなかったか
- 今後どうすべきか
```

---

## 9. 運用チェックリスト

### 9.1 日次チェック

- [ ] SLOダッシュボード確認
- [ ] エラーバジェット消費率確認
- [ ] アラート履歴レビュー
- [ ] パイプライン実行状況確認

### 9.2 週次チェック

- [ ] SLOトレンド分析
- [ ] エラーバジェット予測
- [ ] 容量計画レビュー
- [ ] アラート閾値の妥当性確認

### 9.3 月次チェック

- [ ] SLO達成状況レポート作成
- [ ] エラーバジェットリセット（必要に応じて）
- [ ] SLO目標値の見直し
- [ ] ポストモーテムレビュー

---

## 10. 参考資料

### 10.1 Google SRE Book

- [Site Reliability Engineering](https://sre.google/sre-book/table-of-contents/)
- [Service Level Objectives](https://sre.google/sre-book/service-level-objectives/)
- [Practical Alerting](https://sre.google/sre-book/practical-alerting/)

### 10.2 Cloudflare関連

- [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)
- [Workers Metrics](https://developers.cloudflare.com/workers/observability/metrics/)

### 10.3 本プロジェクト関連ドキュメント

- [アーキテクチャ設計](./architecture-design.md)
- [Elementary データ品質監視](./elementary-integration.md)
- [Evidence コスト監視](./evidence-cost-monitoring.md)

---

最終更新: 2026-01-25
