# Elementary データ品質監視 統合ガイド

このドキュメントでは、Cloudflare Data PlatformにおけるElementaryの統合と使用方法について説明します。

## 目次

- [Elementaryとは](#elementaryとは)
- [プロジェクト構成](#プロジェクト構成)
- [セットアップ](#セットアップ)
- [Elementary機能](#elementary機能)
- [GitHub Actions統合](#github-actions統合)
- [Cloudflare Pages デプロイ](#cloudflare-pages-デプロイ)
- [ベストプラクティス](#ベストプラクティス)
- [トラブルシューティング](#トラブルシューティング)

---

## Elementaryとは

Elementaryは、dbtプロジェクトのためのデータ品質監視およびオブザーバビリティプラットフォームです。

### 主な機能

1. **データ品質テスト**: dbtテストの実行結果を追跡・可視化
2. **異常検知**: 機械学習ベースのデータ異常検知（ボリューム、ディメンション、カラム値）
3. **スキーマ監視**: テーブルスキーマの変更を自動検知
4. **データリネージュ**: モデル間の依存関係を可視化
5. **アラート**: Slackへのリアルタイム通知
6. **ダッシュボード**: HTMLベースの統合データ品質レポート

### Cloudflareとの統合メリット

- **DuckDB + R2**: R2上のParquetファイルを直接分析
- **GitHub Actions**: 自動化されたデータ品質チェック
- **Cloudflare Pages**: Elementaryレポートをグローバルに配信
- **Workers**: カスタムアラートハンドリング
- **Slack統合**: チームへのリアルタイム通知

---

## プロジェクト構成

```
data-engineering-with-cloudflare/
├── dbt/
│   ├── models/
│   │   ├── staging/
│   │   │   ├── stg_api_posts.sql
│   │   │   ├── stg_api_users.sql
│   │   │   └── schema.yml         # Elementary tests定義
│   │   └── marts/
│   │       ├── fct_user_posts.sql
│   │       └── schema.yml
│   ├── dbt_project.yml            # Elementary設定
│   ├── packages.yml               # elementary-data/elementary
│   ├── profiles.yml               # DuckDB + R2接続
│   └── README.md
├── .github/
│   └── workflows/
│       ├── elementary-monitor.yml # Elementary定期実行
│       └── dbt-ci.yml            # PRごとのCI
└── docs/
    └── elementary-integration.md  # このファイル
```

---

## セットアップ

### 1. 依存関係のインストール

```bash
# Python環境のセットアップ
pip install dbt-duckdb==1.7.2
pip install elementary-data[duckdb]==0.15.1

# dbtパッケージのインストール
cd dbt
dbt deps
```

### 2. 環境変数の設定

```bash
# R2接続情報
export R2_ENDPOINT="your-account-id.r2.cloudflarestorage.com"
export R2_ACCESS_KEY_ID="your-access-key-id"
export R2_SECRET_ACCESS_KEY="your-secret-access-key"
export R2_BUCKET_NAME="data-lake-raw"

# Slack通知（オプション）
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

### 3. Elementaryモデルの初期化

```bash
# dbtモデルを実行
dbt run --target prod --profiles-dir .

# Elementaryモデルを実行（メタデータ収集）
dbt run --select elementary --target prod --profiles-dir .
```

### 4. レポート生成

```bash
# HTMLレポートを生成
edr report --project-dir . --profiles-dir . --profile-target prod

# ブラウザで表示
edr report --serve
```

---

## Elementary機能

### 1. ボリューム異常検知

データのボリューム（行数）の異常を検知します。

```yaml
# models/staging/schema.yml
tests:
  - elementary.volume_anomalies:
      timestamp_column: event_timestamp
      sensitivity: 3  # 1-5（5が最も厳しい）
      where_expression: "event_timestamp > CURRENT_DATE - INTERVAL '30 days'"
```

**ユースケース:**
- 日次データの突然の増減
- データパイプラインの停止検知
- データソースの異常

### 2. ディメンション異常検知

カテゴリカルな値の分布変化を検知します。

```yaml
tests:
  - elementary.dimension_anomalies:
      dimensions:
        - event_type
        - user_country
      timestamp_column: event_timestamp
```

**ユースケース:**
- 新しいカテゴリ値の出現
- カテゴリ値の分布変化
- データ品質の問題（NULL値の増加など）

### 3. カラム値の異常検知

数値カラムの統計的異常を検知します。

```yaml
tests:
  - elementary.all_columns_anomalies:
      column_anomalies:
        - revenue
        - user_count
      timestamp_column: created_at
```

**ユースケース:**
- 平均値、最大値、最小値の異常
- NULL値の増加
- データ型の問題

### 4. スキーマ変更検知

テーブルスキーマの変更（カラム追加・削除・型変更）を自動検知します。

```yaml
# dbt_project.yml
models:
  cloudflare_data_platform:
    staging:
      +elementary_enabled: true
      +elementary_schema_changes: true
```

**ユースケース:**
- 予期しないスキーマ変更の検知
- 上流データソースの変更通知
- ドキュメント更新のトリガー

---

## GitHub Actions統合

### Elementary Monitor（定期実行）

`.github/workflows/elementary-monitor.yml` は6時間ごとにElementaryを実行します。

```yaml
on:
  schedule:
    - cron: '0 */6 * * *'  # 6時間ごと
  workflow_dispatch:
  push:
    branches: [main, claude/*]
    paths:
      - 'dbt/**'
```

**実行内容:**
1. dbtモデルとテストの実行
2. Elementaryモデルの実行（メタデータ収集）
3. HTMLレポートの生成
4. Slack通知
5. Cloudflare Pagesへのデプロイ

### dbt CI（Pull Request）

`.github/workflows/dbt-ci.yml` は各PRでデータ品質をチェックします。

```yaml
on:
  pull_request:
    paths:
      - 'dbt/**'
```

**実行内容:**
1. SQL linting
2. dbtモデルのコンパイル
3. dbtテストの実行
4. Elementary品質チェック
5. PRへのコメント

---

## Cloudflare Pages デプロイ

### 自動デプロイ設定

Elementaryレポートは、GitHub Actionsを通じてCloudflare Pagesに自動デプロイされます。

```yaml
# .github/workflows/elementary-monitor.yml
- name: Deploy Report to Cloudflare Pages
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: pages deploy dbt/elementary_output --project-name=data-quality-dashboard
```

### 必要なシークレット

GitHub Secretsに以下を設定してください：

```
CLOUDFLARE_API_TOKEN       # Cloudflare APIトークン
CLOUDFLARE_ACCOUNT_ID      # CloudflareアカウントID
R2_ENDPOINT                # R2エンドポイント
R2_ACCESS_KEY_ID           # R2アクセスキーID
R2_SECRET_ACCESS_KEY       # R2シークレットアクセスキー
R2_BUCKET_NAME             # R2バケット名
SLACK_WEBHOOK_URL          # Slack Webhook URL（オプション）
```

### アクセス方法

デプロイ後、以下のURLでレポートにアクセスできます：

```
https://data-quality-dashboard.pages.dev
```

---

## ベストプラクティス

### 1. テストの適用範囲

```yaml
# 推奨: すべての重要なモデルにテストを適用
models:
  - name: stg_events
    columns:
      - name: event_id
        tests:
          - unique
          - not_null
          - elementary.volume_anomalies
```

### 2. 感度の調整

```yaml
# 開始時は低感度（3）で開始し、徐々に調整
tests:
  - elementary.volume_anomalies:
      sensitivity: 3  # 1（緩い）～ 5（厳しい）
```

### 3. where_expression の活用

```yaml
# 古いデータを除外してパフォーマンスを向上
tests:
  - elementary.volume_anomalies:
      where_expression: "created_at > CURRENT_DATE - INTERVAL '90 days'"
```

### 4. タイムスタンプカラムの必須化

```yaml
# 異常検知には必ずタイムスタンプカラムが必要
tests:
  - elementary.dimension_anomalies:
      dimensions: [category]
      timestamp_column: created_at  # 必須
```

### 5. 定期的なレポート確認

- 毎日レポートを確認する習慣をつける
- Slack通知を有効化する
- 重要なテストは `severity: error` に設定

---

## トラブルシューティング

### 1. Elementaryモデルが実行されない

```bash
# デバッグモードで実行
dbt run --select elementary --debug

# ログを確認
cat logs/dbt.log
```

### 2. R2接続エラー

```bash
# 環境変数を確認
echo $R2_ENDPOINT
echo $R2_ACCESS_KEY_ID

# DuckDBから直接接続テスト
duckdb -c "
  INSTALL httpfs;
  LOAD httpfs;
  SET s3_endpoint='$R2_ENDPOINT';
  SET s3_access_key_id='$R2_ACCESS_KEY_ID';
  SET s3_secret_access_key='$R2_SECRET_ACCESS_KEY';
  SELECT * FROM read_parquet('s3://$R2_BUCKET_NAME/sources/**/*.parquet') LIMIT 5;
"
```

### 3. レポートが生成されない

```bash
# Elementaryデータベースを確認
ls -la elementary.duckdb

# Elementaryモデルを再実行
dbt run --select elementary --full-refresh

# レポート生成（デバッグモード）
edr report --debug
```

### 4. 異常検知が機能しない

```bash
# タイムスタンプカラムの確認
dbt test --select <model_name>

# 十分なデータがあるか確認（少なくとも14日分推奨）
SELECT
  MIN(timestamp_column) as earliest,
  MAX(timestamp_column) as latest,
  COUNT(*) as total_rows
FROM <table>;
```

### 5. Slack通知が届かない

```bash
# Webhook URLをテスト
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Test message from Elementary"}' \
  $SLACK_WEBHOOK_URL

# Elementary設定を確認
edr monitor --slack-webhook $SLACK_WEBHOOK_URL --dry-run
```

---

## Elementary CLI リファレンス

### レポート生成

```bash
# 基本レポート
edr report

# プロジェクト・ターゲット指定
edr report --project-dir ./dbt --profiles-dir ./dbt --profile-target prod

# 過去7日間のデータを分析
edr report --days-back 7

# HTMLファイルとして保存
edr report --file-path ./reports/report.html

# Webサーバーで起動
edr report --serve --port 8080
```

### モニタリング

```bash
# Slack通知付きモニタリング
edr monitor --slack-webhook $SLACK_WEBHOOK_URL

# チャンネル指定
edr monitor \
  --slack-webhook $SLACK_WEBHOOK_URL \
  --slack-channel-name data-quality

# タイムゾーン指定
edr monitor --timezone UTC

# ドライラン（通知なし）
edr monitor --dry-run
```

---

## 参考リンク

- [Elementary公式サイト](https://www.elementary-data.com/)
- [Elementaryドキュメント](https://docs.elementary-data.com/)
- [Elementary GitHub](https://github.com/elementary-data/elementary)
- [dbt-duckdb](https://github.com/duckdb/dbt-duckdb)
- [外部サービス統合ガイド](./external-services.md)

---

最終更新: 2025-12-26
