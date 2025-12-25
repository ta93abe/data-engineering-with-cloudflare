# R2 Data Catalog + Iceberg セットアップガイド

**最終更新: 2025年12月25日**

このドキュメントは、Cloudflare R2 Data Catalog（Public Beta）を使ったApache Iceberg実装の実践的なセットアップガイドです。

## ⚠️ ベータ版に関する注意事項

- **ステータス**: Public Beta（2025年4月10日公開）
- **本番利用**: 可能だが、ベータ版のリスクを理解した上で利用すること
- **料金**: ベータ期間中は無料（GA後に課金開始の可能性あり、30日前通知）
- **SLA**: ベータ版のためSLA保証なし
- **推奨**: 開発・検証環境での積極的な利用、本番はフォールバックプラン併用

---

## 📋 前提条件

### 必要なもの

- [ ] Cloudflareアカウント（無料プランでも可）
- [ ] Wrangler CLI（v3.0以降）
- [ ] R2サブスクリプション（無料枠あり）
- [ ] Node.js 18以降（Wrangler用）

### 確認コマンド

```bash
# Wranglerバージョン確認
wrangler --version

# Cloudflareログイン
wrangler login

# アカウントID取得
wrangler whoami
```

---

## 🚀 ステップ1: R2バケット作成

### 1.1 必要なバケットを作成

このプロジェクトでは4層バケット構成を推奨していますが、まずはIceberg用の2つを作成します。

```bash
# Rawレイヤー（Bronze）: dltがParquetを保存
wrangler r2 bucket create data-lake-raw

# Curatedレイヤー（Gold）: Icebergテーブルを保存
wrangler r2 bucket create data-lake-curated
```

**確認:**

```bash
wrangler r2 bucket list
```

### 1.2 R2 Data Catalogを有効化

**重要**: 現在、R2 Data CatalogはCloudflare Dashboardから有効化します。

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にログイン
2. **R2** > **Buckets** を選択
3. **data-lake-curated** バケットをクリック
4. **Data Catalog** タブを選択
5. **Enable Data Catalog** をクリック

**注意**: ベータ期間中は、この機能が表示されない場合があります。その場合：
- アカウントがベータプログラムに登録されているか確認
- Cloudflareサポートに問い合わせ

---

## 🔑 ステップ2: API Token作成

### 2.1 R2用APIトークン作成

1. Cloudflare Dashboard > **My Profile** > **API Tokens**
2. **Create Token** をクリック
3. **Create Custom Token** を選択

**権限設定:**

| 項目 | 設定 |
|------|------|
| **Permission** | Account > R2 > Edit |
| **Account Resources** | Include > Your Account |
| **Zone Resources** | 不要 |
| **Client IP Address Filtering** | 任意 |

4. **Continue to summary** > **Create Token**
5. トークンをコピーして安全に保存

### 2.2 R2アクセスキー作成

R2へのS3互換アクセス用のキーを作成します。

1. Cloudflare Dashboard > **R2** > **Overview**
2. 右側の **Manage R2 API Tokens** をクリック
3. **Create API Token** を選択
4. **Permission**: Read & Write
5. **TTL**: Never expire（または任意の期間）
6. **Create API Token**

**取得する情報:**
- Access Key ID
- Secret Access Key
- Endpoint URL（`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`）

---

## ⚙️ ステップ3: Wrangler設定

### 3.1 wrangler.tomlの編集

プロジェクトルートの`wrangler.toml`を編集します。

```bash
# アカウントIDを設定（コメント解除して実際のIDに置き換え）
nano wrangler.toml
```

**編集内容:**

```toml
# 8行目: アカウントIDを設定
account_id = "YOUR_ACCOUNT_ID_HERE"

# 83-98行目: Iceberg Converter Workerのコメントを解除
[[workers]]
name = "iceberg-converter"
main = "workers/transformation/iceberg_converter.py"
compatibility_date = "2024-12-01"

[workers.python]
requirements = "workers/transformation/requirements.txt"

[workers.vars]
R2_ACCOUNT_ID = "YOUR_ACCOUNT_ID_HERE"
R2_BUCKET_CURATED = "data-lake-curated"
SOURCE_BUCKET = "data-lake-raw"

# 100-117行目: dlt + Iceberg統合Workerのコメントを解除
[[workers]]
name = "dlt-iceberg-pipeline"
main = "workers/ingestion/dlt_iceberg_pipeline.py"
compatibility_date = "2024-12-01"

[workers.python]
requirements = "workers/ingestion/requirements-iceberg.txt"

[workers.vars]
R2_ACCOUNT_ID = "YOUR_ACCOUNT_ID_HERE"
R2_BUCKET_RAW = "data-lake-raw"
R2_BUCKET_CURATED = "data-lake-curated"
```

**注意**: `YOUR_ACCOUNT_ID_HERE`を実際のアカウントIDに置き換えてください。

---

## 🔐 ステップ4: Secrets設定

Wrangler SecretsにAPIキーとトークンを保存します。

### 4.1 dlt-iceberg-pipeline用

```bash
# R2アクセスキー
wrangler secret put R2_ACCESS_KEY_ID --name dlt-iceberg-pipeline
# プロンプトが表示されたらAccess Key IDを入力

wrangler secret put R2_SECRET_ACCESS_KEY --name dlt-iceberg-pipeline
# プロンプトが表示されたらSecret Access Keyを入力

# Cloudflare APIトークン（R2 Data Catalog用）
wrangler secret put CLOUDFLARE_API_TOKEN --name dlt-iceberg-pipeline
# プロンプトが表示されたらAPIトークンを入力
```

### 4.2 iceberg-converter用

```bash
# Cloudflare APIトークン
wrangler secret put CLOUDFLARE_API_TOKEN --name iceberg-converter
```

### 4.3 確認

```bash
# 設定されたSecretsを確認
wrangler secret list --name dlt-iceberg-pipeline
wrangler secret list --name iceberg-converter
```

---

## 📦 ステップ5: Workerデプロイ

### 5.1 dlt-iceberg-pipelineのデプロイ

```bash
# デプロイ
wrangler deploy workers/ingestion/dlt_iceberg_pipeline.py --name dlt-iceberg-pipeline

# デプロイ成功時の出力例:
# ✨ Built successfully
# 🌍 Uploading...
# ✨ Uploaded dlt-iceberg-pipeline (XX.XX sec)
# 📡 Deployed dlt-iceberg-pipeline triggers (XX.XX sec)
#   https://dlt-iceberg-pipeline.<YOUR-SUBDOMAIN>.workers.dev
```

### 5.2 iceberg-converterのデプロイ

```bash
# デプロイ
wrangler deploy workers/transformation/iceberg_converter.py --name iceberg-converter

# デプロイ成功時の出力例:
# ✨ Built successfully
# 🌍 Uploading...
# ✨ Uploaded iceberg-converter (XX.XX sec)
# 📡 Deployed iceberg-converter triggers (XX.XX sec)
#   https://iceberg-converter.<YOUR-SUBDOMAIN>.workers.dev
```

**注意**: Python Workersは初回デプロイ時に依存関係のビルドに時間がかかる場合があります（1-5分）。

---

## ✅ ステップ6: 動作確認

### 6.1 dlt-iceberg-pipelineのテスト

```bash
# postsデータを取り込み
curl "https://dlt-iceberg-pipeline.<YOUR-SUBDOMAIN>.workers.dev?source=posts"
```

**期待されるレスポンス:**

```json
{
  "success": true,
  "pipeline_name": "dlt_iceberg_pipeline",
  "raw_layer": {
    "bucket": "data-lake-raw",
    "path": "s3://data-lake-raw/sources/api_jsonplaceholder/posts/year=2025/month=12/day=25/",
    "format": "parquet"
  },
  "curated_layer": {
    "bucket": "data-lake-curated",
    "table": "analytics.api_jsonplaceholder.posts",
    "format": "iceberg",
    "location": "s3://data-lake-curated/analytics/api_jsonplaceholder/posts"
  },
  "message": "Data loaded to Bronze (Parquet) and Gold (Iceberg) layers",
  "timestamp": "2025-12-25T12:00:00.000000"
}
```

### 6.2 R2バケット確認

```bash
# Rawレイヤー確認
wrangler r2 object list data-lake-raw --prefix "sources/api_jsonplaceholder/posts/"

# Curatedレイヤー確認
wrangler r2 object list data-lake-curated --prefix "analytics/api_jsonplaceholder/posts/"
```

### 6.3 Icebergメタデータ確認

```bash
# Icebergメタデータファイル確認
wrangler r2 object list data-lake-curated --prefix "analytics/api_jsonplaceholder/posts/metadata/"
```

**期待されるファイル構造:**

```
analytics/api_jsonplaceholder/posts/
├── metadata/
│   ├── v1.metadata.json      # 初期メタデータ
│   ├── version-hint.text     # 最新バージョン
│   └── snap-*.avro           # スナップショット
└── data/
    └── ingestion_date=2025-12-25/
        └── *.parquet         # 実データ
```

---

## 🔍 ステップ7: クエリテスト

### 7.1 DuckDBでクエリ（ローカル）

```bash
# DuckDBインストール（まだの場合）
pip install duckdb

# Pythonスクリプトで確認
python3
```

```python
import duckdb

# DuckDB接続
con = duckdb.connect()

# Icebergエクステンションインストール
con.execute("INSTALL iceberg")
con.execute("LOAD iceberg")

# R2設定
con.execute(f"SET s3_endpoint='<YOUR-ACCOUNT-ID>.r2.cloudflarestorage.com'")
con.execute(f"SET s3_access_key_id='<YOUR-ACCESS-KEY>'")
con.execute(f"SET s3_secret_access_key='<YOUR-SECRET-KEY>'")

# Icebergテーブルスキャン
result = con.execute("""
    SELECT * FROM iceberg_scan(
        's3://data-lake-curated/analytics/api_jsonplaceholder/posts'
    )
    LIMIT 10
""").fetchdf()

print(result)
```

### 7.2 R2 SQL（Cloudflare Dashboard）

1. Cloudflare Dashboard > **R2** > **SQL**
2. 以下のクエリを実行:

```sql
-- Icebergテーブル一覧
SHOW TABLES FROM analytics.api_jsonplaceholder;

-- データクエリ
SELECT
  id,
  userId,
  title,
  ingestion_timestamp
FROM analytics.api_jsonplaceholder.posts
LIMIT 10;

-- 集計クエリ
SELECT
  userId,
  COUNT(*) as post_count
FROM analytics.api_jsonplaceholder.posts
GROUP BY userId
ORDER BY post_count DESC;
```

---

## 🎯 次のステップ

### やってみること

1. **他のデータソースを追加**
   ```bash
   curl "https://dlt-iceberg-pipeline.<YOUR-SUBDOMAIN>.workers.dev?source=users"
   ```

2. **Iceberg Converterを使った変換**
   ```bash
   curl -X POST https://iceberg-converter.<YOUR-SUBDOMAIN>.workers.dev \
     -H "Content-Type: application/json" \
     -d '{
       "source_name": "api_jsonplaceholder",
       "table_name": "posts"
     }'
   ```

3. **スケジュール実行（Cron Triggers）**

   wrangler.tomlに追加:
   ```toml
   [[workers.triggers.crons]]
   crons = ["0 */6 * * *"]  # 6時間ごと
   ```

4. **dbt統合**

   docs/external-services.mdを参照してdbtでIcebergテーブルを使用

5. **Evidence.devでダッシュボード作成**

   Icebergテーブルを可視化

---

## 🐛 トラブルシューティング

### 問題1: デプロイエラー

**エラー:** `Error: Worker exceeded CPU time limit`

**原因:** Python依存関係が大きすぎる

**解決策:**
```bash
# より軽量なバージョンを使用
# requirements.txtを編集して依存関係を最小化
```

### 問題2: R2 Data Catalog接続エラー

**エラー:** `Failed to connect to R2 Data Catalog`

**原因:**
- APIトークンが正しくない
- Data Catalogが有効化されていない
- アカウントIDが間違っている

**解決策:**
```bash
# 1. APIトークンを再設定
wrangler secret put CLOUDFLARE_API_TOKEN --name dlt-iceberg-pipeline

# 2. Dashboard確認
# R2 > Buckets > data-lake-curated > Data Catalog タブ

# 3. wrangler.toml のアカウントID確認
wrangler whoami
```

### 問題3: Data Catalog機能が表示されない

**原因:** ベータプログラムへのアクセス権がない可能性

**解決策:**
1. [Cloudflare Community](https://community.cloudflare.com/) でベータアクセスをリクエスト
2. サポートチケットを作成
3. 代替案: PyIcebergのローカルカタログを使用（docs/iceberg-implementation.md参照）

### 問題4: Workers CPU時間超過

**エラー:** `CPU time limit exceeded`

**解決策:**
- データを小分けにして処理
- Workflowsを使った長時間実行パイプライン
- GitHub Actionsでバッチ処理

---

## 📊 コスト見積もり（ベータ期間中）

| サービス | 無料枠 | 超過時の料金 | 想定コスト（月間） |
|---------|--------|-------------|------------------|
| **R2 Storage** | 10GB | $0.015/GB | 100GB: $1.35 |
| **R2 Class A Operations** | 1M requests | $4.50/1M | 100K: 無料 |
| **R2 Class B Operations** | 10M requests | $0.36/1M | 1M: 無料 |
| **Workers Requests** | 100K/day | $0.50/1M | 10K/day: 無料 |
| **Workers CPU Time** | 10ms CPU/request | Paid plan: 30s | 無料範囲内 |
| **R2 Data Catalog** | **無料（ベータ）** | TBD（GA後） | $0 |

**合計想定コスト**: **$0-2/月**（小規模利用時）

---

## 📚 参考リソース

### 公式ドキュメント
- [Cloudflare R2 Data Catalog](https://developers.cloudflare.com/r2/data-catalog/)
- [R2 Data Catalog Blog](https://blog.cloudflare.com/r2-data-catalog-public-beta/)
- [Apache Iceberg](https://iceberg.apache.org/)
- [PyIceberg](https://py.iceberg.apache.org/)

### このリポジトリのドキュメント
- [Iceberg実装ガイド](./iceberg-implementation.md) - 詳細な実装パターン
- [R2ストレージ設計](./r2-storage-design.md) - バケット戦略
- [dlt Workers実装](./dlt-workers-implementation.md) - dltパイプライン
- [外部サービス統合](./external-services.md) - dbt、DuckDB、Evidence

---

## ✅ セットアップチェックリスト

- [ ] Cloudflareアカウント作成・ログイン
- [ ] Wrangler CLIインストール
- [ ] R2バケット作成（data-lake-raw, data-lake-curated）
- [ ] R2 Data Catalog有効化
- [ ] APIトークン作成
- [ ] R2アクセスキー作成
- [ ] wrangler.toml編集（アカウントID、Workers設定）
- [ ] Secrets設定（R2キー、APIトークン）
- [ ] dlt-iceberg-pipelineデプロイ
- [ ] iceberg-converterデプロイ
- [ ] 動作確認（データ取り込み）
- [ ] R2バケット確認
- [ ] Icebergメタデータ確認
- [ ] DuckDBまたはR2 SQLでクエリ

---

## 🎉 完了！

これでR2 Data Catalogを使ったApache Iceberg on Cloudflareの基盤が構築できました。

次は以下の拡張を検討してください:
- dbtで変換パイプラインを構築
- Evidence.devでダッシュボードを作成
- Workflowsでオーケストレーション
- 本番データソースへの接続

---

**最終更新**: 2025年12月25日
**ステータス**: Public Beta対応版
**バージョン**: v1.0
