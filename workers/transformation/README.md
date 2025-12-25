# Iceberg Transformation Worker

Cloudflare Workers Python Runtime上でApache Icebergテーブルを作成・管理するWorkerです。

## 機能

- ParquetファイルをIcebergテーブルに変換
- R2 Data Catalogとの統合
- スキーマ自動推論
- 日次パーティション対応
- タイムトラベルクエリ対応

## セットアップ

### 1. R2 Data Catalogを有効化

```bash
# Cloudflare Dashboard > R2 > Buckets > data-lake-curated > Data Catalog > Enable
```

### 2. Secretsの設定

```bash
wrangler secret put CLOUDFLARE_API_TOKEN --name iceberg-converter
```

### 3. デプロイ

```bash
wrangler deploy workers/transformation/iceberg_converter.py --name iceberg-converter
```

## 使い方

### HTTPトリガー

```bash
curl -X POST https://iceberg-converter.your-subdomain.workers.dev \
  -H "Content-Type: application/json" \
  -d '{
    "source_name": "api_jsonplaceholder",
    "table_name": "posts",
    "source_path": "sources/api_jsonplaceholder/posts/"
  }'
```

### レスポンス例

```json
{
  "success": true,
  "operation": "created_new",
  "table_identifier": "analytics.api_jsonplaceholder.posts",
  "location": "s3://data-lake-curated/analytics/api_jsonplaceholder/posts",
  "schema_fields": 7,
  "message": "Iceberg table created_new successfully"
}
```

## Cron Trigger

定期的に自動変換する場合:

```toml
# wrangler.toml
[workers.triggers]
crons = ["0 * * * *"]  # 毎時実行
```

詳細は [iceberg-implementation.md](../../docs/iceberg-implementation.md) を参照してください。
