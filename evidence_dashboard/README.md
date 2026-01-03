# GitHub Analytics Dashboard

Evidence.dev ベースの GitHub Analytics ダッシュボード

## 📊 ダッシュボード

### 1. **Overview** (`/`)
- 全体KPI (リポジトリ数、Stars、コミット数、PR数)
- 最近30日間のアクティビティトレンド
- Top リポジトリ (Stars順)
- リポジトリヘルススコア

### 2. **Repositories** (`/repositories`)
- リポジトリ一覧と詳細メトリクス
- 言語別分布
- 年齢カテゴリ分析
- Star人気度ランク
- アクティビティヒートマップ

### 3. **Issues Analysis** (`/issues`)
- Issue概要とKPI
- 解決時間分布
- ディスカッションレベル分析
- タイプ別分類 (Bug/Enhancement/Docs)
- 最近のIssue一覧

### 4. **Pull Requests** (`/pull-requests`)
- PR概要とマージメトリクス
- PRサイズ分布 (XS/S/M/L/XL)
- マージ速度分析
- レビュー強度
- マージ効率スコア

### 5. **Contributors** (`/contributors`)
- コントリビューター概要
- アクティビティステータス
- コミット数ランキング
- マルチリポジトリ貢献者
- 新規コントリビューター

### 6. **CI/CD Performance** (`/cicd`)
- ワークフロー実行メトリクス
- 成功率分析
- リポジトリ別パフォーマンス
- CI/CDヘルススコア

### 7. **Growth Metrics** (`/growth`)
- Star成長トレンド
- 日次アクティビティ推移
- リポジトリモメンタム (Stars/Day)
- 曜日別アクティビティ
- 週次サマリー

## 🚀 セットアップ

### 前提条件

- Node.js 18以上
- pnpm
- dbt実行済み (DuckDB DBファイルが必要)

### インストール

```bash
cd evidence_dashboard

# 依存関係インストール
pnpm install
```

### dbt実行

ダッシュボードはdbtで生成されたDuckDB DBファイルを参照します:

```bash
cd ../dbt_github

# Seedロード
dbt seed

# モデル実行
dbt run

# DBファイルが target/github_analytics.duckdb に生成される
```

### 開発サーバー起動

```bash
cd evidence_dashboard

# 開発サーバー起動
pnpm dev

# ブラウザで http://localhost:3000 を開く
```

### ビルド

```bash
# 本番ビルド
pnpm build

# プレビュー
pnpm preview
```

## 📁 プロジェクト構造

```
evidence_dashboard/
├── pages/                    # ダッシュボードページ (Markdown)
│   ├── index.md             # Overview
│   ├── repositories.md      # Repositories
│   ├── issues.md            # Issues Analysis
│   ├── pull-requests.md     # PR Analysis
│   ├── contributors.md      # Contributors
│   ├── cicd.md              # CI/CD Performance
│   └── growth.md            # Growth Metrics
├── sources/                 # データソース定義 (自動生成)
├── components/              # カスタムコンポーネント
├── static/                  # 静的ファイル
├── evidence.config.yaml     # Evidence設定
├── package.json
└── README.md               # このファイル
```

## 🔧 設定

### データソース設定

`evidence.config.yaml`:

```yaml
datasources:
  github_analytics:
    type: duckdb
    filename: ../dbt_github/target/github_analytics.duckdb
```

### コンポーネント

利用可能なEvidence.devコンポーネント:

- **BigValue**: KPI表示
- **LineChart**: 折れ線グラフ
- **BarChart**: 棒グラフ
- **DataTable**: インタラクティブテーブル
- **Column**: テーブルカラム定義

## 📝 ページの作成・編集

Markdownファイルを `pages/` に追加するだけ:

```markdown
# My Dashboard Page

\```sql my_query
select * from marts.dim_repositories
\```

<DataTable data={my_query}/>
```

## 🎨 カスタマイズ

### Tailwind CSS

Evidence.devはTailwind CSSをサポート:

```markdown
<div class="grid grid-cols-3 gap-4">
  <!-- コンテンツ -->
</div>
```

### カスタムコンポーネント

`components/` にSvelteコンポーネントを追加可能。

## 📊 クエリのベストプラクティス

### 1. パフォーマンス

```sql
-- ✅ Good: 必要なカラムのみ選択
select repository_full_name, current_stars
from marts.dim_repositories

-- ❌ Bad: SELECT *
select * from marts.dim_repositories
```

### 2. フィルタリング

```sql
-- ✅ Good: WHERE句でフィルタ
select * from marts.agg_daily_metrics
where metric_date >= current_date - interval '30 days'

-- ❌ Bad: 全データ取得後にフィルタ
```

### 3. 集計

```sql
-- ✅ Good: DBで集計
select
    repository_full_name,
    sum(commits_count) as total_commits
from marts.agg_daily_metrics
group by repository_full_name

-- ❌ Bad: アプリ側で集計
```

## 🐛 トラブルシューティング

### エラー: "Database file not found"

```bash
# dbtを実行してDBファイルを生成
cd ../dbt_github
dbt seed && dbt run
```

### エラー: "pnpm: command not found"

```bash
# pnpmをインストール
npm install -g pnpm
```

### ページが表示されない

1. 開発サーバーを再起動
2. ブラウザキャッシュをクリア
3. `pnpm build` で静的ビルド確認

## 🚀 デプロイ

### Cloudflare Workers (予定)

```bash
# ビルド
pnpm build

# 静的ファイルをR2にアップロード
wrangler r2 object put ...

# Workersでホスト
```

### その他のプラットフォーム

- **Cloudflare Pages**: `pnpm build` → `build` ディレクトリをデプロイ
- **Vercel**: Evidence.dev プリセットを使用
- **Netlify**: 同上

## 📚 参考リソース

- [Evidence.dev ドキュメント](https://docs.evidence.dev/)
- [Evidence.dev GitHub](https://github.com/evidence-dev/evidence)
- [DuckDB ドキュメント](https://duckdb.org/docs/)

---

**作成日**: 2025-01-03
**Evidence.dev Version**: 27.0+
