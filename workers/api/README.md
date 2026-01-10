# Cloudflare Data API (Hono)

HonoフレームワークベースのCloudflare Workers APIサーバー。KV、D1、R2、Analytics Engineへの統一的なアクセスを提供します。

## 特徴

- **Hono v4**: 軽量・高速なWebフレームワーク（〜14KB）
- **型安全**: TypeScriptによる完全な型サポート
- **ミドルウェア**: CORS、Logger、Bearer認証、セキュリティヘッダー
- **統合API**: KV、D1、R2、Analytics Engineへのアクセス

## セットアップ

```bash
cd workers/api
npm install
```

## 開発

```bash
# ローカル開発サーバー起動
npm run dev

# 型チェック
npm run typecheck
```

## デプロイ

### 1. Bindings設定

`wrangler.toml` のBindingsセクションを有効化し、実際のリソースIDを設定:

```toml
[[kv_namespaces]]
binding = "DATA_KV"
id = "your-kv-namespace-id"

[[d1_databases]]
binding = "DB"
database_name = "data-platform"
database_id = "your-d1-database-id"

[[r2_buckets]]
binding = "DATA_BUCKET"
bucket_name = "data-bucket"

[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "data_platform_metrics"
```

### 2. シークレット設定

```bash
wrangler secret put API_TOKEN
```

### 3. デプロイ

```bash
npm run deploy
```

## API エンドポイント

### ヘルスチェック

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/` | APIステータス |
| GET | `/health` | ヘルスチェック |

### KV API（認証必須）

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/kv` | キー一覧 |
| GET | `/api/kv/:key` | 値取得 |
| PUT | `/api/kv/:key` | 値保存 |
| DELETE | `/api/kv/:key` | 値削除 |

### D1 API（認証必須）

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/d1/tables` | テーブル一覧 |
| GET | `/api/d1/tables/:name/schema` | スキーマ取得 |
| POST | `/api/d1/query` | SELECTクエリ実行 |

### R2 API（認証必須）

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/r2/objects` | オブジェクト一覧 |
| GET | `/api/r2/objects/:key` | メタデータ取得 |
| GET | `/api/r2/download/:key` | ダウンロード |
| PUT | `/api/r2/objects/:key` | アップロード |
| DELETE | `/api/r2/objects/:key` | 削除 |

### Analytics Engine API（認証必須）

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/analytics/events` | イベント記録 |

## 使用例

### 認証

```bash
# Bearer Token認証
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  https://your-worker.workers.dev/api/kv/mykey
```

### KV操作

```bash
# 値の保存
curl -X PUT \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "hello", "ttl": 3600}' \
  https://your-worker.workers.dev/api/kv/mykey

# 値の取得
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  https://your-worker.workers.dev/api/kv/mykey
```

### D1クエリ

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM users WHERE id = ?", "params": [1]}' \
  https://your-worker.workers.dev/api/d1/query
```

### R2操作

```bash
# ファイル一覧
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  "https://your-worker.workers.dev/api/r2/objects?prefix=data/"

# ファイルアップロード
curl -X PUT \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @data.json \
  https://your-worker.workers.dev/api/r2/objects/data/file.json
```

## ミドルウェア

### 組み込みミドルウェア

- **secureHeaders**: セキュリティヘッダー自動付与
- **cors**: CORS設定（オリジン制限）
- **logger**: リクエストログ出力
- **prettyJSON**: 開発時のJSON整形
- **bearerAuth**: Bearer Token認証

### リクエストID

すべてのレスポンスに `X-Request-Id` ヘッダーが付与されます。トラブルシューティング時に使用できます。

## 拡張

### 新しいエンドポイントの追加

```typescript
const myApi = new Hono<{ Bindings: Bindings; Variables: Variables }>()

myApi.use('*', authMiddleware)

myApi.get('/hello', (c) => {
  return c.json({ message: 'Hello, World!' })
})

app.route('/api/my', myApi)
```

### バリデーション追加（Zod）

```bash
npm install zod @hono/zod-validator
```

```typescript
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

app.post('/users', zValidator('json', schema), async (c) => {
  const data = c.req.valid('json')
  // ...
})
```

## 参考資料

- [Hono公式ドキュメント](https://hono.dev/)
- [Hono + Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Cloudflare Workers公式ドキュメント](https://developers.cloudflare.com/workers/)
