# dlt Pipeline Worker

Cloudflare Workers Python Runtime上で動作するdltパイプライン実装です。

## クイックスタート

### ローカル開発

```bash
# 開発サーバー起動
wrangler dev workers/ingestion/dlt_pipeline.py

# 動作確認
curl http://localhost:8787
```

### デプロイ

```bash
# Secretsの設定（初回のみ）
wrangler secret put R2_ACCESS_KEY_ID --name dlt-pipeline
wrangler secret put R2_SECRET_ACCESS_KEY --name dlt-pipeline

# デプロイ
wrangler deploy workers/ingestion/dlt_pipeline.py --name dlt-pipeline
```

## 使い方

### エンドポイント

```bash
# デフォルト（posts）
curl https://dlt-pipeline.your-subdomain.workers.dev

# usersデータ
curl "https://dlt-pipeline.your-subdomain.workers.dev?source=users"

# カスタムAPI（API_KEY設定が必要）
curl "https://dlt-pipeline.your-subdomain.workers.dev?source=custom&endpoint=https://api.example.com/data"
```

### レスポンス例

```json
{
  "success": true,
  "pipeline_name": "workers_etl_pipeline",
  "dataset_name": "raw_data",
  "message": "Successfully loaded data from posts",
  "timestamp": "2024-12-25T12:00:00"
}
```

## ファイル構成

- `dlt_pipeline.py`: Worker本体（Python）
- `requirements.txt`: Python依存関係
- `README.md`: このファイル

## カスタマイズ

新しいデータソースを追加する場合は、`dlt_pipeline.py`で`@dlt.resource`デコレータを使ってリソースを定義してください。

詳細は [/docs/dlt-workers-implementation.md](../../docs/dlt-workers-implementation.md) を参照。

## トラブルシューティング

### ログ確認

```bash
wrangler tail dlt-pipeline
```

### Secrets確認

```bash
wrangler secret list --name dlt-pipeline
```

### R2バケット確認

```bash
wrangler r2 bucket list
wrangler r2 object list data-lake-raw
```
