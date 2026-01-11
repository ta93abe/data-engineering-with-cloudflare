# GitHub Actions CI/CD実装ガイド

Cloudflareデータプラットフォームの自動化ワークフロー実装です。

## 概要

- **CI/CDツール**: GitHub Actions
- **パッケージマネージャ**: uv
- **デプロイ先**: Cloudflare Workers / Pages
- **通知**: Slack

## ワークフロー一覧

| ワークフロー | 用途 | トリガー |
|-------------|------|---------|
| `dbt-ci.yml` | dbtモデルのCI | 手動実行 |
| `elementary-monitor.yml` | Elementary監視 | 手動実行 |
| `great-expectations.yml` | GEデータ検証 | 手動実行 |
| `marimo-notebooks.yml` | marimoノートブック | 手動実行 |

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│                    GitHub Actions                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │  dbt CI                                          │   │
│  │  - SQL Linting                                   │   │
│  │  - dbt compile / run / test                     │   │
│  │  - Elementary check                              │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Elementary Monitor                              │   │
│  │  - dbt models run                               │   │
│  │  - Elementary report generation                 │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Great Expectations                              │   │
│  │  - Checkpoint validation                        │   │
│  │  - Data Docs generation                         │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  marimo Notebooks                                │   │
│  │  - HTML export                                  │   │
│  │  - Lint check                                   │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
     ┌─────────┐         ┌─────────┐         ┌─────────┐
     │ Artifacts│         │ CF Pages│         │  Slack  │
     └─────────┘         └─────────┘         └─────────┘
```

---

## 実装コード

### ディレクトリ構造

```
.github/
└── workflows/
    ├── dbt-ci.yml              # dbt CIワークフロー
    ├── elementary-monitor.yml  # Elementary監視
    ├── great-expectations.yml  # GEデータ検証
    └── marimo-notebooks.yml    # marimoノートブック
```

---

### dbt CI: dbt-ci.yml

dbtモデルのCI/CDパイプライン。SQL Linting、コンパイル、テスト、Elementary統合。

```yaml
name: dbt CI

on:
  # 手動実行のみ
  workflow_dispatch:

jobs:
  dbt-test:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: '3.11'

      - name: Install uv
        uses: astral-sh/setup-uv@v7
        with:
          enable-cache: true

      - name: Install dependencies
        run: |
          uv sync

      - name: Install dbt packages
        working-directory: dbt
        run: uv run dbt deps

      - name: Check dbt project configuration
        working-directory: dbt
        run: |
          echo "Validating dbt project configuration..."
          uv run dbt debug --profiles-dir . --target ci

      - name: Run SQL linting with sqlfluff
        working-directory: dbt
        run: |
          echo "Linting SQL files..."
          uv run sqlfluff lint models/ --dialect duckdb --ignore-templated-areas
        continue-on-error: true

      - name: Compile dbt models
        working-directory: dbt
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: |
          echo "Compiling dbt models..."
          uv run dbt compile --target ci --profiles-dir .

      - name: Run dbt models (CI)
        working-directory: dbt
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: |
          echo "Running dbt models in CI environment..."
          uv run dbt run --target ci --profiles-dir .

      - name: Run dbt tests
        working-directory: dbt
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: |
          echo "Running dbt tests..."
          uv run dbt test --target ci --profiles-dir .

      - name: Generate dbt docs
        working-directory: dbt
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: |
          echo "Generating dbt documentation..."
          uv run dbt docs generate --target ci --profiles-dir .

      - name: Upload dbt docs as artifact
        uses: actions/upload-artifact@v4
        with:
          name: dbt-docs-${{ github.event.pull_request.number }}
          path: dbt/target/
          retention-days: 7

      - name: Run Elementary CI check
        working-directory: dbt
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: |
          echo "Running Elementary models..."
          uv run dbt run --select elementary --target ci --profiles-dir .

          echo "Generating Elementary report..."
          uv run edr report --project-dir . --profiles-dir . --profile-target ci

      - name: Comment PR with results
        if: always()
        uses: actions/github-script@v8
        with:
          script: |
            const fs = require('fs');
            const prNumber = context.payload.pull_request.number;

            let comment = `## dbt CI Results

            **Status:** ${{ job.status }}
            **Commit:** \`${{ github.sha }}\`

            ### Checks Performed:
            - SQL Linting
            - dbt Compilation
            - dbt Models Run
            - dbt Tests
            - Documentation Generation
            - Elementary Data Quality Check

            **Artifacts:**
            - [dbt Documentation](https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }})
            - [Elementary Report](https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }})

            ---
            *Automated by dbt CI workflow*
            `;

            github.rest.issues.createComment({
              issue_number: prNumber,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });
```

---

### Elementary Monitor: elementary-monitor.yml

Elementaryによるデータ品質監視と異常検知。

```yaml
name: Elementary Data Quality Monitor

on:
  # 手動実行のみ（本番環境未設定のため）
  workflow_dispatch:

jobs:
  dbt-test-and-monitor:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: '3.11'

      - name: Install uv
        uses: astral-sh/setup-uv@v7
        with:
          enable-cache: true

      - name: Install dependencies
        run: |
          uv sync

      - name: Install dbt packages
        working-directory: dbt
        run: uv run dbt deps

      - name: Run dbt models
        working-directory: dbt
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: |
          echo "Running dbt models..."
          uv run dbt run --target prod --profiles-dir .

      - name: Run dbt tests
        working-directory: dbt
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: |
          echo "Running dbt tests..."
          uv run dbt test --target prod --profiles-dir .
        continue-on-error: true

      - name: Run Elementary models
        working-directory: dbt
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: |
          echo "Running Elementary models for metadata collection..."
          uv run dbt run --select elementary --target prod --profiles-dir .

      - name: Generate Elementary Report
        working-directory: dbt
        run: |
          echo "Generating Elementary HTML report..."
          uv run edr report \
            --project-dir . \
            --profiles-dir . \
            --profile-target prod \
            --file-path elementary_report.html

      - name: Upload Elementary Report as Artifact
        uses: actions/upload-artifact@v4
        with:
          name: elementary-report-${{ github.run_number }}
          path: dbt/elementary_report.html
          retention-days: 30

      - name: Run Elementary Monitor with Slack notification
        if: always()
        working-directory: dbt
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          if [ -n "$SLACK_WEBHOOK_URL" ]; then
            echo "Sending Elementary monitor results to Slack..."
            uv run edr monitor \
              --project-dir . \
              --profiles-dir . \
              --profile-target prod \
              --slack-webhook "$SLACK_WEBHOOK_URL" \
              --slack-channel-name data-quality \
              --timezone UTC
          else
            echo "SLACK_WEBHOOK_URL not set, skipping Slack notification"
          fi

      - name: Deploy Report to Cloudflare Pages
        if: github.ref == 'refs/heads/main'
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dbt/elementary_output --project-name=data-quality-dashboard --branch=main
        # 注意: デプロイ後、Cloudflare Accessで保護することを推奨

      - name: Notify on Failure
        if: failure()
        uses: slackapi/slack-github-action@v2
        with:
          webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
          payload: |
            {
              "text": "Elementary Data Quality Monitor Failed",
              "blocks": [
                {
                  "type": "header",
                  "text": {
                    "type": "plain_text",
                    "text": "Elementary Monitor Failed"
                  }
                },
                {
                  "type": "section",
                  "fields": [
                    {
                      "type": "mrkdwn",
                      "text": "*Repository:*\n${{ github.repository }}"
                    },
                    {
                      "type": "mrkdwn",
                      "text": "*Branch:*\n${{ github.ref_name }}"
                    }
                  ]
                }
              ]
            }
```

---

### Great Expectations: great-expectations.yml

Great Expectationsによるデータ検証とプロファイリング。

```yaml
name: Great Expectations Data Validation

on:
  # 手動実行のみ（本番環境未設定のため）
  workflow_dispatch:

jobs:
  validate-data:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: '3.11'

      - name: Install uv
        uses: astral-sh/setup-uv@v7
        with:
          enable-cache: true

      - name: Install dependencies
        run: |
          uv sync

      - name: Verify Great Expectations setup
        working-directory: great_expectations
        run: |
          echo "Verifying Great Expectations configuration..."
          uv run great_expectations --version
          uv run great_expectations project check-config

      - name: Run data validation
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          echo "Running Great Expectations validation..."
          uv run python scripts/run_great_expectations.py

      - name: Upload Data Docs as artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: great-expectations-data-docs-${{ github.run_number }}
          path: great_expectations/uncommitted/data_docs/
          retention-days: 30

      - name: Deploy Data Docs to Cloudflare Pages
        if: github.ref == 'refs/heads/main'
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy great_expectations/uncommitted/data_docs/cloudflare_pages_site --project-name=gx-data-docs --branch=main

      - name: Generate validation summary
        if: always()
        run: |
          echo "## Great Expectations Validation Summary" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "**Status:** ${{ job.status }}" >> $GITHUB_STEP_SUMMARY
          echo "**Run Number:** ${{ github.run_number }}" >> $GITHUB_STEP_SUMMARY
          echo "**Commit:** \`${{ github.sha }}\`" >> $GITHUB_STEP_SUMMARY

      - name: Notify Slack on failure
        if: failure()
        uses: slackapi/slack-github-action@v2
        with:
          webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
          payload: |
            {
              "text": "Great Expectations Validation Failed",
              "blocks": [
                {
                  "type": "header",
                  "text": {
                    "type": "plain_text",
                    "text": "Data Validation Failed"
                  }
                },
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "One or more data quality validations failed."
                  }
                }
              ]
            }

  # データプロファイリングジョブ
  profile-data:
    runs-on: ubuntu-latest
    # 手動実行時のみ
    if: github.event_name == 'workflow_dispatch'

    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: '3.11'

      - name: Install uv
        uses: astral-sh/setup-uv@v7
        with:
          enable-cache: true

      - name: Install dependencies
        run: |
          uv sync

      - name: Profile datasets
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: |
          echo "Running data profiling..."
          # データプロファイリングスクリプトは別途作成予定
          echo "Data profiling completed"

      - name: Upload profiling results
        uses: actions/upload-artifact@v4
        with:
          name: data-profiling-results
          path: great_expectations/uncommitted/data_docs/
          retention-days: 90
```

---

### marimo Notebooks: marimo-notebooks.yml

marimoノートブックのHTML出力とLintチェック。

```yaml
name: marimo Notebooks

on:
  # 手動実行のみ（本番環境未設定のため）
  workflow_dispatch:

jobs:
  run-notebooks:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: '3.11'

      - name: Install uv
        uses: astral-sh/setup-uv@v7
        with:
          enable-cache: true

      - name: Install marimo and dependencies
        run: |
          uv sync

      - name: Run R2 Data Exploration notebook
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: |
          echo "Running R2 Data Exploration notebook..."
          # Export to HTML
          uv run marimo export html marimo/notebooks/r2_data_exploration.py -o marimo/outputs/r2_exploration.html
        continue-on-error: true

      - name: Run Data Quality Dashboard notebook
        env:
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
        run: |
          echo "Running Data Quality Dashboard notebook..."
          # Export to HTML
          uv run marimo export html marimo/notebooks/data_quality_dashboard.py -o marimo/outputs/quality_dashboard.html
        continue-on-error: true

      - name: Upload notebook outputs as artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: marimo-notebooks-${{ github.run_number }}
          path: marimo/outputs/
          retention-days: 30

      - name: Deploy notebooks to Cloudflare Pages
        if: github.ref == 'refs/heads/main' && success()
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy marimo/outputs --project-name=marimo-notebooks --branch=main

      - name: Notify Slack
        if: success() && github.event_name == 'schedule'
        uses: slackapi/slack-github-action@v2
        with:
          webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
          payload: |
            {
              "text": "marimo Notebooks Updated",
              "blocks": [
                {
                  "type": "header",
                  "text": {
                    "type": "plain_text",
                    "text": "marimo Notebooks Generated"
                  }
                },
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "Weekly marimo notebooks have been generated and deployed."
                  }
                }
              ]
            }

  # ノートブックの lint チェック
  lint-notebooks:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: '3.11'

      - name: Install uv
        uses: astral-sh/setup-uv@v7
        with:
          enable-cache: true

      - name: Install dependencies
        run: |
          uv sync --only-dev

      - name: Check marimo notebooks
        run: |
          echo "Checking marimo notebooks syntax..."
          for notebook in marimo/notebooks/*.py; do
            echo "Checking $notebook..."
            uv run python -m py_compile "$notebook"
          done

      - name: Run ruff linter
        run: |
          echo "Running ruff linter..."
          uv run ruff check marimo/notebooks/
        continue-on-error: true
```

---

## Secrets設定

GitHub Secretsに以下を設定:

| Secret名 | 説明 |
|----------|------|
| `R2_ENDPOINT` | R2エンドポイント URL |
| `R2_ACCESS_KEY_ID` | R2アクセスキーID |
| `R2_SECRET_ACCESS_KEY` | R2シークレットキー |
| `R2_BUCKET_NAME` | R2バケット名 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare APIトークン |
| `CLOUDFLARE_ACCOUNT_ID` | CloudflareアカウントID |
| `SLACK_WEBHOOK_URL` | Slack Webhook URL（オプション） |

## 使用アクション

| アクション | バージョン | 用途 |
|-----------|---------|------|
| `actions/checkout` | v6 | リポジトリチェックアウト |
| `actions/setup-python` | v6 | Python環境セットアップ |
| `astral-sh/setup-uv` | v7 | uvインストール |
| `actions/upload-artifact` | v4 | 成果物アップロード |
| `cloudflare/wrangler-action` | v3 | Cloudflareデプロイ |
| `slackapi/slack-github-action` | v2 | Slack通知 |
| `actions/github-script` | v8 | PRコメント |

## 開発方針

### トリガー設計

- **手動実行**: 現在はすべて`workflow_dispatch`（本番環境未設定のため）
- **本番稼働時**: スケジュール実行を追加

```yaml
# 例: 日次実行
on:
  schedule:
    - cron: '0 6 * * *'  # 毎日6:00 UTC
  workflow_dispatch:
```

### Artifact保持期間

| 種類 | 保持期間 | 用途 |
|------|---------|------|
| dbt docs | 7日 | PRレビュー用 |
| Elementary report | 30日 | 品質レポート |
| GE Data Docs | 30日 | 検証レポート |
| marimo outputs | 30日 | ノートブック出力 |
| プロファイリング | 90日 | 長期分析用 |

### セキュリティ

- Cloudflare Pagesデプロイ後はCloudflare Accessで保護推奨
- Secretsは最小権限の原則で設定
- 本番Secretsは環境分離

## 拡張ポイント

1. **PR自動トリガー**: `on: pull_request`追加
2. **スケジュール実行**: cronジョブ追加
3. **Workers自動デプロイ**: 別ワークフロー作成
4. **テスト並列実行**: matrix strategyの活用

---

最終更新: 2026-01-11
