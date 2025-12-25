# 🚀 クイックスタートガイド - R2 Data Catalog + Iceberg

**所要時間: 15-30分**

このガイドでは、R2 Data Catalogを使ったApache Iceberg環境を最短で構築します。

---

## 📋 前提条件チェック

```bash
# Wranglerインストール確認
wrangler --version
# v3.0以降が必要

# Cloudflareログイン
wrangler login

# アカウント情報確認
wrangler whoami
```

---

## ⚡ 3ステップセットアップ

### ステップ1: R2バケット作成（3分）

```bash
# 自動セットアップスクリプト実行
bash scripts/setup-r2-buckets.sh
```

**手動の場合:**

```bash
wrangler r2 bucket create data-lake-raw
wrangler r2 bucket create data-lake-curated
```

### ステップ2: R2 Data Catalog有効化（2分）

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) を開く
2. **R2** > **Buckets** を選択
3. **data-lake-curated** をクリック
4. **Data Catalog** タブを選択
5. **Enable Data Catalog** をクリック

### ステップ3: 設定ファイル編集（5分）

#### 3.1 アカウントID取得

```bash
# アカウントIDをコピー
wrangler whoami | grep "Account ID"
```

#### 3.2 wrangler.toml編集

```bash
# エディタで開く
nano wrangler.toml
```

**編集箇所（2箇所）:**

```toml
# 9行目: コメント解除してアカウントIDを設定
account_id = "YOUR_ACCOUNT_ID_HERE"

# 99行目と120行目: R2_ACCOUNT_IDを設定
R2_ACCOUNT_ID = "YOUR_ACCOUNT_ID_HERE"
```

保存: `Ctrl+O` → `Enter` → `Ctrl+X`

#### 3.3 APIトークン作成

**R2 APIトークン:**

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) > **My Profile** > **API Tokens**
2. **Create Token** > **Create Custom Token**
3. Permission: `Account` > `R2` > `Edit`
4. **Create Token** をクリック
5. トークンをコピーして保存

**R2アクセスキー:**

1. Dashboard > **R2** > **Overview**
2. **Manage R2 API Tokens** をクリック
3. **Create API Token**
4. Permission: `Read & Write`
5. **Create**
6. Access Key ID と Secret Access Key をコピー

#### 3.4 Secrets設定

```bash
# Cloudflare APIトークン
wrangler secret put CLOUDFLARE_API_TOKEN --name dlt-iceberg-pipeline
# → 貼り付けて Enter

# R2アクセスキーID
wrangler secret put R2_ACCESS_KEY_ID --name dlt-iceberg-pipeline
# → 貼り付けて Enter

# R2シークレットアクセスキー
wrangler secret put R2_SECRET_ACCESS_KEY --name dlt-iceberg-pipeline
# → 貼り付けて Enter

# Iceberg Converter用（Cloudflare APIトークン）
wrangler secret put CLOUDFLARE_API_TOKEN --name iceberg-converter
# → 貼り付けて Enter
```

---

## 🚢 デプロイ（5分）

```bash
# dlt + Icebergパイプラインをデプロイ
wrangler deploy workers/ingestion/dlt_iceberg_pipeline.py --name dlt-iceberg-pipeline

# Iceberg Converterをデプロイ
wrangler deploy workers/transformation/iceberg_converter.py --name iceberg-converter
```

**注意**: 初回は依存関係のビルドに3-5分かかります。

---

## ✅ 動作確認（5分）

### テスト1: データ取り込み

```bash
# Workers URLを取得
wrangler deployments list --name dlt-iceberg-pipeline

# データ取り込み実行
curl "https://dlt-iceberg-pipeline.YOUR-SUBDOMAIN.workers.dev?source=posts"
```

**期待される結果:**

```json
{
  "success": true,
  "pipeline_name": "dlt_iceberg_pipeline",
  "curated_layer": {
    "table": "analytics.api_jsonplaceholder.posts",
    "format": "iceberg"
  }
}
```

### テスト2: R2バケット確認

```bash
# Icebergメタデータ確認
wrangler r2 object list data-lake-curated --prefix "analytics/api_jsonplaceholder/posts/metadata/"
```

**期待される結果:**

```
metadata/v1.metadata.json
metadata/version-hint.text
metadata/snap-xxxxx.avro
```

### テスト3: DuckDBでクエリ

```bash
# DuckDBインストール（まだの場合）
pip install duckdb

# Pythonで確認
python3 << 'EOF'
import duckdb

con = duckdb.connect()
con.execute("INSTALL iceberg")
con.execute("LOAD iceberg")

# R2設定（YOUR_*を実際の値に置き換え）
con.execute("SET s3_endpoint='YOUR-ACCOUNT-ID.r2.cloudflarestorage.com'")
con.execute("SET s3_access_key_id='YOUR-ACCESS-KEY'")
con.execute("SET s3_secret_access_key='YOUR-SECRET-KEY'")

# クエリ
result = con.execute("""
    SELECT id, userId, title
    FROM iceberg_scan('s3://data-lake-curated/analytics/api_jsonplaceholder/posts')
    LIMIT 5
""").fetchdf()

print(result)
EOF
```

---

## 🎉 完了！

**セットアップ成功です！** 次のステップに進みましょう:

### すぐに試せること

```bash
# ユーザーデータを取り込む
curl "https://dlt-iceberg-pipeline.YOUR-SUBDOMAIN.workers.dev?source=users"

# R2バケット確認
wrangler r2 bucket list

# デプロイされたWorkers確認
wrangler deployments list
```

### 次のステップ

1. **定期実行を設定**
   - wrangler.tomlにCron Triggersを追加
   - 毎時・毎日の自動取り込み

2. **dbt統合**
   - Icebergテーブルを使った変換パイプライン
   - docs/external-services.md 参照

3. **Evidence.devダッシュボード**
   - Icebergテーブルの可視化
   - Cloudflare Pagesへデプロイ

4. **本番データソース接続**
   - workers/ingestion/dlt_iceberg_pipeline.py をカスタマイズ

---

## 🐛 トラブルシューティング

### デプロイエラー

```bash
# エラー詳細確認
wrangler tail dlt-iceberg-pipeline

# ログ確認
wrangler dev workers/ingestion/dlt_iceberg_pipeline.py --name dlt-iceberg-pipeline
```

### Data Catalogが表示されない

- ベータプログラムへのアクセス権が必要な場合があります
- [Cloudflare Community](https://community.cloudflare.com/) で問い合わせ

### Secrets設定ミス

```bash
# Secrets削除
wrangler secret delete CLOUDFLARE_API_TOKEN --name dlt-iceberg-pipeline

# 再設定
wrangler secret put CLOUDFLARE_API_TOKEN --name dlt-iceberg-pipeline
```

---

## 📚 詳細ドキュメント

- **[完全セットアップガイド](./docs/iceberg-setup-guide.md)** - 詳細な手順とトラブルシューティング
- **[Iceberg実装ガイド](./docs/iceberg-implementation.md)** - 実装パターンと運用ガイド
- **[R2ストレージ設計](./docs/r2-storage-design.md)** - バケット戦略とフォルダ構造

---

## 💬 サポート

- **Issues**: [GitHub Issues](https://github.com/ta93abe/data-engineering-with-cloudflare/issues)
- **Cloudflare Community**: [community.cloudflare.com](https://community.cloudflare.com/)
- **公式ドキュメント**: [developers.cloudflare.com/r2/data-catalog/](https://developers.cloudflare.com/r2/data-catalog/)

---

**最終更新**: 2025年12月25日
**対応バージョン**: R2 Data Catalog Public Beta
