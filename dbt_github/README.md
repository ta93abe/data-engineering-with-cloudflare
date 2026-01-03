# GitHub Analytics - dbt Project

このdbtプロジェクトは、GitHubデータを変換して分析可能な形式にします。

## 📂 プロジェクト構造

```
dbt_github/
├── models/
│   ├── staging/                 # Raw→Staging変換
│   │   ├── sources.yml          # Source定義
│   │   ├── stg_github__repositories.sql
│   │   ├── stg_github__issues.sql
│   │   ├── stg_github__pull_requests.sql
│   │   ├── stg_github__commits.sql
│   │   ├── stg_github__stargazers.sql
│   │   ├── stg_github__releases.sql
│   │   └── stg_github__workflow_runs.sql
│   └── marts/                   # 分析用テーブル
│       ├── dimensions/          # ディメンションテーブル
│       │   ├── dim_repositories.sql
│       │   └── dim_contributors.sql
│       ├── facts/               # ファクトテーブル
│       │   ├── fct_repository_activity.sql
│       │   ├── fct_issue_lifecycle.sql
│       │   ├── fct_pr_metrics.sql
│       │   └── fct_commit_stats.sql
│       └── aggregations/        # 集計テーブル
│           └── agg_daily_metrics.sql (incremental)
├── seeds/                       # サンプルデータ
│   ├── repositories.csv
│   ├── issues.csv
│   ├── pull_requests.csv
│   ├── commits.csv
│   ├── stargazers.csv
│   ├── releases.csv
│   └── workflow_runs.csv
├── dbt_project.yml              # プロジェクト設定
├── profiles.yml.example         # 接続設定サンプル
└── packages.yml                 # dbt packages

```

## 🚀 セットアップ

### 1. 依存関係のインストール

```bash
# dbt-coreとdbt-duckdbをインストール
pip install dbt-core dbt-duckdb

# dbtパッケージをインストール
dbt deps
```

### 2. Profiles設定

```bash
# プロファイルをコピー
cp profiles.yml.example ~/.dbt/profiles.yml

# 必要に応じて編集（デフォルトのDuckDB設定で動作します）
```

### 3. Seedデータのロード

```bash
# サンプルデータをロード
dbt seed

# 確認
dbt seed --show
```

### 4. モデルの実行

```bash
# 全モデルを実行
dbt run

# Staging layerのみ
dbt run --models staging

# Marts layerのみ
dbt run --models marts

# 特定のモデルとその依存関係
dbt run --models +dim_repositories
```

### 5. テストの実行

```bash
# 全テスト実行
dbt test

# 特定のモデルのテスト
dbt test --models staging
```

## 📊 データモデル

### Staging Layer (View)

Raw データをクレンジング・標準化:

- **stg_github__repositories**: リポジトリ情報
- **stg_github__issues**: Issue データ
- **stg_github__pull_requests**: PR データ
- **stg_github__commits**: コミット履歴
- **stg_github__stargazers**: Star イベント
- **stg_github__releases**: リリース情報
- **stg_github__workflow_runs**: CI/CD 実行履歴

### Marts Layer (Table)

#### Dimensions:
- **dim_repositories**: リポジトリマスター
  - スター数ランク、年齢カテゴリ、組織フラグ
- **dim_contributors**: コントリビューターマスター
  - アクティビティステータス、コミット数ランク

#### Facts:
- **fct_repository_activity**: リポジトリ別活動サマリー
  - Issue/PR/コミット/リリース/CI-CD メトリクス
- **fct_issue_lifecycle**: Issue ライフサイクル分析
  - 解決時間、ディスカッションレベル、タイプ分類
- **fct_pr_metrics**: PR メトリクス
  - コード変更量、レビュー強度、マージ効率
- **fct_commit_stats**: コミット統計
  - コミットタイプ、時間帯分析、メッセージ分析

#### Aggregations:
- **agg_daily_metrics**: 日次集計 (Incremental)
  - 日別のコミット/Issue/PR/Star/ワークフロー数

## 🔍 使用例

### リポジトリ別アクティビティ

```sql
select
    r.repository_full_name,
    r.primary_language,
    r.current_stars,
    a.total_commits,
    a.total_issues,
    a.total_prs,
    a.merged_prs
from dim_repositories r
join fct_repository_activity a
    on r.repository_id = a.repository_id
order by r.current_stars desc;
```

### Issue 解決時間分析

```sql
select
    repository_full_name,
    resolution_time_bucket,
    count(*) as issue_count,
    avg(days_to_close) as avg_days_to_close
from fct_issue_lifecycle
where is_closed = 1
group by repository_full_name, resolution_time_bucket
order by repository_full_name, avg_days_to_close;
```

### 日次アクティビティトレンド

```sql
select
    metric_date,
    repository_full_name,
    commits_count,
    issues_created,
    prs_created,
    total_activity_count
from agg_daily_metrics
where metric_date >= current_date - interval '30 days'
order by metric_date desc, total_activity_count desc;
```

### PR サイズ分布

```sql
select
    pr_size_category,
    count(*) as pr_count,
    avg(hours_to_merge) as avg_hours_to_merge,
    avg(review_comments_count) as avg_review_comments
from fct_pr_metrics
where is_merged = 1
group by pr_size_category
order by
    case pr_size_category
        when 'XS' then 1
        when 'S' then 2
        when 'M' then 3
        when 'L' then 4
        when 'XL' then 5
    end;
```

## 📈 パフォーマンス

- **Staging models**: View materialization (クエリ時に計算)
- **Marts models**: Table materialization (事前計算)
- **Aggregations**: Incremental materialization (新規データのみ追加)

Incremental モデルの強制フルリフレッシュ:

```bash
dbt run --models agg_daily_metrics --full-refresh
```

## 🧪 テスト

各モデルには以下のテストが含まれています:

- **Uniqueness**: 主キーの一意性
- **Not Null**: 必須カラムの NULL チェック
- **Relationships**: 外部キー整合性
- **Accepted Values**: 列挙型の値検証

## 📚 ドキュメント生成

```bash
# ドキュメント生成
dbt docs generate

# ドキュメントサーバー起動
dbt docs serve
```

ブラウザで http://localhost:8080 を開いてLineage図とカラム詳細を確認できます。

## 🔄 本番環境での使用

本番環境では R2 上の Parquet ファイルを直接クエリ:

1. `~/.dbt/profiles.yml` を更新:

```yaml
github_analytics:
  target: prod
  outputs:
    prod:
      type: duckdb
      path: ':memory:'
      extensions: ['httpfs']
      settings:
        s3_region: 'auto'
        s3_endpoint: 'https://<account-id>.r2.cloudflarestorage.com'
        s3_access_key_id: '{{ env_var("R2_ACCESS_KEY_ID") }}'
        s3_secret_access_key: '{{ env_var("R2_SECRET_ACCESS_KEY") }}'
```

2. `models/staging/sources.yml` を更新してR2パスを指定:

```yaml
sources:
  - name: github_raw
    meta:
      external_location: "s3://data-lake-raw/sources/github/{name}/**/*.parquet"
```

3. 実行:

```bash
dbt run --target prod
```

## 📝 開発のヒント

### 特定のモデルだけ実行:

```bash
# 1つのモデル
dbt run --models stg_github__issues

# モデルとその下流
dbt run --models stg_github__issues+

# モデルとその上流
dbt run --models +dim_repositories

# タグでフィルタ
dbt run --models tag:staging
dbt run --models tag:fact
```

### デバッグ:

```bash
# コンパイルされたSQLを確認
dbt compile --models dim_repositories

# target/compiled/ にSQLが生成される
cat target/compiled/github_analytics/models/marts/dimensions/dim_repositories.sql
```

### フレッシュネスチェック:

```bash
dbt source freshness
```

## 🐛 トラブルシューティング

### エラー: "Compilation Error: dbt_utils not found"

```bash
dbt deps
```

### エラー: "Database Error: no such table: raw.repositories"

```bash
dbt seed
```

### Incremental モデルが更新されない

```bash
dbt run --models agg_daily_metrics --full-refresh
```

---

**作成日**: 2025-01-03
**dbt Version**: 1.7+
**DuckDB Version**: 0.10+
