# プログラミング言語ガイド

Cloudflareデータ基盤で使用される全プログラミング言語の役割、使用箇所、ベストプラクティス。

## 📋 言語一覧

| 言語 | 主な用途 | 使用箇所 | 重要度 |
|------|---------|----------|--------|
| **JavaScript/TypeScript** | Workers実装 | Workers, Temporal | ⭐⭐⭐⭐⭐ |
| **Python** | データ処理・分析 | dbt, GX, Elementary, DVC, Prefect | ⭐⭐⭐⭐⭐ |
| **SQL** | データクエリ・変換 | dbt, DuckDB, D1, Evidence | ⭐⭐⭐⭐⭐ |
| **Bash/Shell** | 自動化スクリプト | デプロイ, セットアップ | ⭐⭐⭐⭐ |
| **YAML** | 設定ファイル | GitHub Actions, docker-compose, dbt | ⭐⭐⭐⭐ |
| **TOML** | 設定ファイル | wrangler.toml, pyproject.toml | ⭐⭐⭐⭐ |
| **Markdown** | ドキュメント | README, Evidence, docs/ | ⭐⭐⭐⭐ |
| **JSON** | データ・設定 | API, 設定, データフォーマット | ⭐⭐⭐ |
| **HCL** | Infrastructure as Code | Terraform (オプション) | ⭐⭐⭐ |
| **HTML/CSS** | ダッシュボードUI | Evidence, Pages | ⭐⭐ |
| **Go** | ツール・CLI | cloudflared (Tunnels) | ⭐⭐ |
| **Rust** | Workers（高性能） | Workers (オプション) | ⭐ |

---

## 1. JavaScript / TypeScript ⭐⭐⭐⭐⭐

### 用途

- **Cloudflare Workers実装** - データ処理、API、オーケストレーション
- **Temporal Workflows** - ワークフロー定義
- **Workers AI** - AI推論エンドポイント
- **Durable Objects** - ステートフル処理

### 使用箇所

```
workers/
├── ai/
│   ├── llm-chat.js                 # JavaScript
│   ├── embeddings.js
│   └── rag-system.js
├── orchestrator/
│   ├── cron-scheduler.js           # JavaScript
│   └── workflow-coordinator.ts     # TypeScript
├── data-processor/
│   └── transform.ts                # TypeScript
└── cost-collector/
    └── index.js                    # JavaScript
```

### TypeScript vs JavaScript

**TypeScript推奨の場面:**
- 複雑なビジネスロジック
- チーム開発
- 型安全性が重要

**JavaScript推奨の場面:**
- シンプルなWorkers
- プロトタイピング
- 軽量スクリプト

### 実装例

```typescript
// TypeScript - 型安全なWorkers
interface Env {
  R2_BUCKET: R2Bucket;
  DB: D1Database;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/process') {
      const data = await request.json() as ProcessRequest;
      return await processData(data, env);
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function processData(data: ProcessRequest, env: Env): Promise<Response> {
  // 型安全な処理
  const result = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
    messages: data.messages
  });

  return Response.json(result);
}
```

```javascript
// JavaScript - シンプルなWorkers
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/hello') {
      return new Response('Hello from Workers!');
    }

    return new Response('Not Found', { status: 404 });
  }
};
```

### ツール

- **wrangler** - Cloudflare Workers CLI
- **esbuild** - 高速バンドラー
- **TypeScript Compiler** - tsc
- **Miniflare** - ローカルテスト環境

---

## 2. Python ⭐⭐⭐⭐⭐

### 用途

- **dbt** - データ変換（Jinja + SQL）
- **Great Expectations** - データ検証
- **Elementary** - dbtモニタリング
- **DVC** - データバージョン管理
- **Prefect/Dagster/Airflow** - ワークフローオーケストレーション
- **marimo** - リアクティブノートブック
- **スクリプト** - セットアップ、データ処理

### 使用箇所

```
├── dbt/                            # Python (dbt CLI)
│   └── macros/*.sql
├── great_expectations/             # Python
│   └── plugins/*.py
├── scripts/
│   ├── setup-cloudflare-access.sh  # Bash (Python埋め込み)
│   ├── run_great_expectations.py   # Python
│   └── register_r2_datasets.py     # Python (OpenMetadata)
├── marimo/
│   └── notebooks/*.py              # Python (marimo)
├── flows/                          # Python (Prefect)
│   ├── tasks/*.py
│   └── flows/*.py
└── pyproject.toml                  # Python設定
```

### バージョン

- **推奨**: Python 3.11+
- **最小**: Python 3.9

### 実装例

```python
# dbt マクロ (Jinja + SQL)
{% macro mask_email(column_name) %}
  CASE
    WHEN {{ column_name }} IS NULL THEN NULL
    ELSE CONCAT(LEFT({{ column_name }}, 2), '***@', SPLIT_PART({{ column_name }}, '@', 2))
  END
{% endmacro %}
```

```python
# Great Expectations カスタムExpectation
from great_expectations.expectations.expectation import ColumnMapExpectation

class ExpectColumnValuesToNotContainPII(ColumnMapExpectation):
    @classmethod
    def _atomic_map_function(cls, value, **kwargs):
        if value is None:
            return True

        # PII検出ロジック
        import re
        email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        return not re.search(email_pattern, str(value))
```

```python
# Prefect Flow
from prefect import flow, task
import duckdb

@task(retries=3)
def read_from_r2(bucket: str):
    conn = duckdb.connect(':memory:')
    conn.execute("INSTALL httpfs; LOAD httpfs;")
    return conn.execute(f"SELECT * FROM read_parquet('s3://{bucket}/*.parquet')").df()

@flow
def data_pipeline():
    df = read_from_r2('bronze')
    # 処理...
    return df
```

### ツール

- **pip** - パッケージマネージャー
- **poetry** / **uv** - 依存管理
- **ruff** - 超高速リンター
- **pytest** - テストフレームワーク
- **mypy** - 型チェック

---

## 3. SQL ⭐⭐⭐⭐⭐

### 用途

- **dbt models** - データ変換・モデリング
- **DuckDB** - R2データ分析
- **D1** - ワークフロー状態管理
- **Evidence** - BIダッシュボード
- **Analytics Engine** - メトリクスクエリ

### SQLダイアレクト

| システム | ダイアレクト | 特徴 |
|---------|------------|------|
| **DuckDB** | DuckDB SQL | 分析特化、PostgreSQL互換 |
| **D1** | SQLite | 軽量、サーバーレス |
| **Analytics Engine** | ClickHouse-like | 時系列特化 |
| **PostgreSQL** | PostgreSQL | Hyperdrive経由 |

### 実装例

```sql
-- dbt model (DuckDB)
-- models/staging/stg_api_posts.sql

WITH source AS (
  SELECT * FROM read_parquet('s3://{{ env_var("R2_BUCKET") }}/bronze/posts/*.parquet')
),

cleaned AS (
  SELECT
    CAST(id AS INTEGER) AS post_id,
    CAST(userId AS INTEGER) AS user_id,
    TRIM(title) AS title,
    CURRENT_TIMESTAMP AS loaded_at
  FROM source
  WHERE id IS NOT NULL
)

SELECT * FROM cleaned
```

```sql
-- Evidence dashboard
-- pages/index.md

# コスト監視ダッシュボード

```sql monthly_costs
SELECT
  DATE_TRUNC('month', date) as month,
  service,
  SUM(total_cost) as cost
FROM read_parquet('s3://cost-data/billing/*.parquet')
WHERE date >= CURRENT_DATE - INTERVAL '3' MONTH
GROUP BY month, service
ORDER BY month DESC, cost DESC
```

<BarChart data={monthly_costs} x=month y=cost series=service />
```

```sql
-- D1 (SQLite) - ワークフロー管理
CREATE TABLE task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  status TEXT CHECK(status IN ('pending', 'running', 'success', 'failed')),
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT
);

CREATE INDEX idx_run_id ON task_runs(run_id);
CREATE INDEX idx_status ON task_runs(status);
```

```sql
-- Analytics Engine (ClickHouse-like)
SELECT
  toDate(timestamp) as date,
  blob1 as worker_name,
  COUNT(*) as requests,
  AVG(double1) as avg_latency_ms
FROM ANALYTICS_DATASET
WHERE timestamp >= NOW() - INTERVAL '7' DAY
GROUP BY date, worker_name
ORDER BY date DESC, requests DESC
```

### ツール

- **sqlfluff** - SQLリンター
- **sqlfmt** - SQLフォーマッター
- **dbt** - SQL変換フレームワーク

---

## 4. Bash / Shell ⭐⭐⭐⭐

### 用途

- **セットアップスクリプト** - 初期設定
- **デプロイスクリプト** - CI/CD
- **ユーティリティ** - 自動化タスク

### 使用箇所

```
scripts/
├── setup-cloudflare-access.sh     # Cloudflare Access設定
├── deploy-all.sh                  # 一括デプロイ
├── run-dbt.sh                     # dbt実行
└── backup-to-r2.sh                # R2バックアップ
```

### 実装例

```bash
#!/bin/bash
# scripts/setup-cloudflare-access.sh

set -e

GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}Cloudflare Access セットアップ${NC}"

# 環境変数チェック
if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo "エラー: CLOUDFLARE_ACCOUNT_ID が設定されていません"
    exit 1
fi

# Access Application作成
create_access_application() {
    local app_name=$1
    local domain=$2

    curl -X POST \
        "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps" \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data @- <<EOF
{
  "name": "$app_name",
  "domain": "$domain",
  "type": "self_hosted"
}
EOF
}

create_access_application "Elementary Report" "elementary-report.pages.dev"
echo "✓ Access Application作成完了"
```

### ツール

- **shellcheck** - Bashリンター
- **shfmt** - Bashフォーマッター

---

## 5. YAML ⭐⭐⭐⭐

### 用途

- **GitHub Actions** - CI/CDワークフロー
- **Docker Compose** - コンテナオーケストレーション
- **dbt** - プロジェクト設定
- **OpenMetadata** - メタデータIngestion
- **Kestra** - ワークフロー定義

### 使用箇所

```
├── .github/
│   └── workflows/
│       ├── elementary-monitor.yml
│       ├── great-expectations.yml
│       ├── marimo-notebooks.yml
│       └── dbt-ci.yml
├── dbt/
│   ├── dbt_project.yml
│   ├── profiles.yml
│   └── packages.yml
├── docker-compose.yml
├── ingestion/
│   └── dbt_metadata.yaml
└── flows/
    └── r2-pipeline.yml              # Kestra
```

### 実装例

```yaml
# .github/workflows/elementary-monitor.yml
name: Elementary Data Quality Monitor

on:
  workflow_dispatch:

jobs:
  dbt-test-and-monitor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Run dbt
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
        run: |
          dbt run --target prod
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  openmetadata:
    image: openmetadata/server:1.2.0
    ports:
      - "8585:8585"
    environment:
      - DB_HOST=postgresql
      - ELASTICSEARCH_HOST=elasticsearch
    depends_on:
      - postgresql
      - elasticsearch

  postgresql:
    image: postgres:15
    environment:
      POSTGRES_USER: openmetadata
      POSTGRES_PASSWORD: openmetadata
```

### ツール

- **yamllint** - YAMLリンター
- **yq** - YAMLプロセッサー

---

## 6. TOML ⭐⭐⭐⭐

### 用途

- **wrangler.toml** - Workers設定
- **pyproject.toml** - Python設定
- **DVC設定**

### 使用箇所

```
├── wrangler-llm-chat.toml
├── wrangler-embeddings.toml
├── wrangler-rag-system.toml
├── wrangler-cost-collector.toml
└── pyproject.toml
```

### 実装例

```toml
# wrangler-llm-chat.toml
name = "llm-chat"
main = "workers/ai/llm-chat.js"
compatibility_date = "2024-01-01"

[ai]
binding = "AI"

[[analytics_engine_datasets]]
binding = "ANALYTICS"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "data-lake"

[vars]
ENVIRONMENT = "production"
```

```toml
# pyproject.toml
[tool.poetry]
name = "cloudflare-data-platform"
version = "0.1.0"
description = "Cloudflare-based data platform"
authors = ["Data Team"]

[tool.poetry.dependencies]
python = "^3.11"
dbt-duckdb = "^1.7.2"
great-expectations = "^0.18.12"
prefect = "^2.14.0"
duckdb = "^0.10.0"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.mypy]
python_version = "3.11"
strict = true
```

---

## 7. Markdown ⭐⭐⭐⭐

### 用途

- **ドキュメント** - README, ガイド
- **Evidence** - BIレポート（SQL埋め込み）
- **marimo** - ノートブック（.py形式だがMD風）

### 使用箇所

```
├── README.md
├── docs/
│   ├── architecture-design.md
│   ├── cloudflare-ai-ml-guide.md
│   ├── evidence-cost-monitoring.md
│   └── workflow-orchestration.md
└── evidence-dashboard/
    └── pages/
        ├── index.md                 # Evidence (MD + SQL)
        └── cost-trends.md
```

### 実装例（Evidence）

````markdown
# コストダッシュボード

## 月次概要

```sql monthly_total
SELECT
  DATE_TRUNC('month', date) as month,
  SUM(total_cost) as total
FROM costs
GROUP BY month
```

<BigValue data={monthly_total} value=total />

## トレンド

```sql daily_costs
SELECT date, SUM(cost) as daily_total
FROM costs
WHERE date >= CURRENT_DATE - 30
GROUP BY date
```

<LineChart data={daily_costs} x=date y=daily_total />
````

---

## 8. JSON ⭐⭐⭐

### 用途

- **API** - リクエスト/レスポンス
- **設定ファイル** - package.json, tsconfig.json
- **データフォーマット** - R2保存形式（Parquetと併用）

### 使用箇所

```
├── package.json
├── tsconfig.json
├── great_expectations/
│   └── expectations/*.json
└── data/
    └── *.json                       # R2 Bronze層
```

### 実装例

```json
// package.json
{
  "name": "cloudflare-workers",
  "version": "1.0.0",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "@cloudflare/workers-types": "^4.0.0"
  }
}
```

```json
// great_expectations/expectations/api_posts_suite.json
{
  "expectation_suite_name": "api_posts_suite",
  "expectations": [
    {
      "expectation_type": "expect_column_to_exist",
      "kwargs": {
        "column": "id"
      }
    },
    {
      "expectation_type": "expect_column_values_to_be_unique",
      "kwargs": {
        "column": "id"
      }
    }
  ]
}
```

---

## 9. HCL (HashiCorp Configuration Language) ⭐⭐⭐

### 用途

- **Terraform** - Infrastructure as Code (オプション)

### 使用箇所

```
terraform/
├── main.tf
├── variables.tf
├── outputs.tf
└── modules/
    ├── workers/
    ├── r2/
    └── d1/
```

### 実装例

```hcl
# terraform/main.tf

terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

resource "cloudflare_r2_bucket" "data_lake" {
  account_id = var.account_id
  name       = "data-lake-bronze"
  location   = "APAC"
}

resource "cloudflare_workers_script" "data_processor" {
  account_id = var.account_id
  name       = "data-processor"
  content    = file("${path.module}/../workers/data-processor/index.js")

  r2_bucket_binding {
    name        = "R2_BUCKET"
    bucket_name = cloudflare_r2_bucket.data_lake.name
  }
}

resource "cloudflare_d1_database" "orchestration" {
  account_id = var.account_id
  name       = "orchestration-db"
}
```

---

## 10. HTML / CSS ⭐⭐

### 用途

- **Evidence** - カスタムコンポーネント
- **Cloudflare Pages** - 静的サイト
- **Elementary/GX レポート** - 生成されたHTML

### 使用箇所

```
├── evidence-dashboard/
│   ├── static/
│   │   └── custom.css
│   └── components/
│       └── custom-chart.svelte      # HTML/CSS/JS
└── dbt/
    └── elementary_output/
        └── *.html                   # 生成されたレポート
```

---

## 11. Go ⭐⭐

### 用途

- **cloudflared** - Cloudflare Tunnels CLI
- **Workers（オプション）** - Go言語でWorkers記述可能

### 使用例

```go
// workers/go-example/main.go (オプション)

package main

import (
    "fmt"
    "github.com/syumai/workers"
)

func main() {
    workers.Serve(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintf(w, "Hello from Go Workers!")
    }))
}
```

---

## 12. Rust ⭐

### 用途

- **Workers（高性能）** - CPU集約的な処理に最適
- **WebAssembly** - Workers内でWASM実行

### 使用例

```rust
// workers/rust-example/src/lib.rs (オプション)

use worker::*;

#[event(fetch)]
pub async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    // 高速な処理
    Response::ok("Hello from Rust Workers!")
}
```

---

## 言語別ファイル統計

### プロジェクト内の言語分布

```
プロジェクト全体
├── JavaScript/TypeScript: 35%
│   └── workers/, temporal/
├── Python: 30%
│   └── dbt/, scripts/, flows/, marimo/
├── SQL: 15%
│   └── dbt/models/, evidence/
├── YAML: 10%
│   └── .github/workflows/, docker-compose.yml
├── Markdown: 5%
│   └── docs/, README.md
├── TOML: 3%
│   └── wrangler*.toml, pyproject.toml
├── Bash: 2%
│   └── scripts/
└── その他: 0%
```

---

## 開発環境セットアップ

### 必要なツール

```bash
# Node.js / npm (Workers開発)
node --version  # v20+
npm --version

# Python (データ処理)
python --version  # 3.11+
pip --version

# wrangler (Cloudflare CLI)
npm install -g wrangler

# dbt
pip install dbt-duckdb

# その他
git --version
docker --version
```

### エディタ設定

**VS Code推奨拡張機能:**
- **JavaScript/TypeScript**: ESLint, Prettier
- **Python**: Pylance, Ruff, mypy
- **SQL**: SQLTools, sqlfluff
- **YAML**: YAML
- **Markdown**: Markdown All in One

**`.vscode/settings.json`**:
```json
{
  "editor.formatOnSave": true,
  "python.linting.enabled": true,
  "python.linting.ruffEnabled": true,
  "sqltools.useNodeRuntime": true,
  "[javascript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[python]": {
    "editor.defaultFormatter": "charliermarsh.ruff"
  }
}
```

---

## ベストプラクティス

### 1. 言語選択ガイドライン

| ユースケース | 推奨言語 | 理由 |
|-------------|---------|------|
| **Workers API** | TypeScript | 型安全、IntelliSense |
| **シンプルなWorkers** | JavaScript | 軽量、素早く実装 |
| **データ変換** | SQL (dbt) | 宣言的、テスト可能 |
| **データ分析** | Python + DuckDB | 豊富なライブラリ |
| **ワークフロー** | Python (Prefect) | Pythonic、柔軟 |
| **Infrastructure** | HCL (Terraform) | IaC標準 |
| **スクリプト** | Bash | シンプル、UNIX互換 |

### 2. コード品質

```toml
# pyproject.toml
[tool.ruff]
select = ["E", "F", "I", "N", "W"]
ignore = ["E501"]
line-length = 100

[tool.ruff.per-file-ignores]
"__init__.py" = ["F401"]
```

```json
// .eslintrc.json
{
  "extends": ["eslint:recommended"],
  "parserOptions": {
    "ecmaVersion": 2022
  },
  "rules": {
    "no-unused-vars": "warn",
    "no-console": "off"
  }
}
```

### 3. リンター・フォーマッター

| 言語 | リンター | フォーマッター |
|------|---------|--------------|
| **JavaScript/TypeScript** | ESLint | Prettier |
| **Python** | Ruff | Ruff (black互換) |
| **SQL** | sqlfluff | sqlfmt |
| **Bash** | shellcheck | shfmt |
| **YAML** | yamllint | - |

---

## まとめ

### 主要言語（必須）

1. **JavaScript/TypeScript** - Workers実装
2. **Python** - データ処理・分析
3. **SQL** - データクエリ・変換

### サポート言語（推奨）

4. **Bash** - 自動化
5. **YAML** - 設定
6. **TOML** - 設定
7. **Markdown** - ドキュメント

### オプション言語

8. **HCL** - Infrastructure as Code
9. **Go** - Tunnels CLI
10. **Rust** - 高性能Workers

---

## 学習リソース

### JavaScript/TypeScript
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Python
- [dbt Docs](https://docs.getdbt.com/)
- [Prefect Docs](https://docs.prefect.io/)
- [DuckDB Python API](https://duckdb.org/docs/api/python/overview)

### SQL
- [DuckDB SQL](https://duckdb.org/docs/sql/introduction)
- [dbt Best Practices](https://docs.getdbt.com/best-practices)

---

最終更新: 2025-12-26
