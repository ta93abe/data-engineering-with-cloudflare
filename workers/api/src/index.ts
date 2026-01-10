import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { bearerAuth } from 'hono/bearer-auth'
import { prettyJSON } from 'hono/pretty-json'
import { secureHeaders } from 'hono/secure-headers'

// Cloudflare Bindings型定義
type Bindings = {
  // KV Namespace
  DATA_KV: KVNamespace
  // D1 Database
  DB: D1Database
  // R2 Bucket
  DATA_BUCKET: R2Bucket
  // Analytics Engine
  ANALYTICS: AnalyticsEngineDataset
  // 環境変数
  API_TOKEN: string
  ENVIRONMENT: string
}

// カスタム変数
type Variables = {
  requestId: string
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ========================================
// グローバルミドルウェア
// ========================================

// セキュリティヘッダー
app.use('*', secureHeaders())

// CORS設定
app.use('*', cors({
  origin: ['https://your-domain.com', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-Request-Id'],
  credentials: true,
  maxAge: 86400,
}))

// リクエストログ
app.use('*', logger())

// レスポンスJSON整形（開発環境のみ）
app.use('*', prettyJSON())

// リクエストID生成
app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID()
  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)
  await next()
})

// ========================================
// 認証ミドルウェア（API エンドポイント用）
// ========================================

const authMiddleware = bearerAuth({
  verifyToken: async (token, c) => {
    return token === c.env.API_TOKEN
  },
})

// ========================================
// ヘルスチェック（認証不要）
// ========================================

app.get('/', (c) => {
  return c.json({
    name: 'Cloudflare Data API',
    version: '1.0.0',
    status: 'healthy',
    environment: c.env.ENVIRONMENT || 'development',
  })
})

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ========================================
// KV API
// ========================================

const kv = new Hono<{ Bindings: Bindings; Variables: Variables }>()

kv.use('*', authMiddleware)

// KV取得
kv.get('/:key', async (c) => {
  const key = c.req.param('key')
  const value = await c.env.DATA_KV.get(key)

  if (value === null) {
    return c.json({ error: 'Key not found' }, 404)
  }

  return c.json({ key, value })
})

// KV保存
kv.put('/:key', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json<{ value: string; ttl?: number }>()

  const options: KVNamespacePutOptions = {}
  if (body.ttl) {
    options.expirationTtl = body.ttl
  }

  await c.env.DATA_KV.put(key, body.value, options)

  return c.json({ success: true, key })
})

// KV削除
kv.delete('/:key', async (c) => {
  const key = c.req.param('key')
  await c.env.DATA_KV.delete(key)

  return c.json({ success: true, key })
})

// KVリスト
kv.get('/', async (c) => {
  const prefix = c.req.query('prefix') || ''
  const limit = parseInt(c.req.query('limit') || '100', 10)

  const list = await c.env.DATA_KV.list({ prefix, limit })

  return c.json({
    keys: list.keys.map(k => k.name),
    cursor: list.cursor,
    complete: list.list_complete,
  })
})

app.route('/api/kv', kv)

// ========================================
// D1 API
// ========================================

const d1 = new Hono<{ Bindings: Bindings; Variables: Variables }>()

d1.use('*', authMiddleware)

// クエリ実行（SELECT文のみ許可）
d1.post('/query', async (c) => {
  const { sql, params } = await c.req.json<{ sql: string; params?: unknown[] }>()

  // SELECT文のみ許可（セキュリティ対策）
  if (!sql.trim().toUpperCase().startsWith('SELECT')) {
    return c.json({ error: 'Only SELECT queries are allowed' }, 400)
  }

  const stmt = c.env.DB.prepare(sql)
  const result = params ? await stmt.bind(...params).all() : await stmt.all()

  return c.json({
    success: result.success,
    results: result.results,
    meta: result.meta,
  })
})

// テーブル一覧
d1.get('/tables', async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all()

  return c.json({ tables: result.results })
})

// テーブルスキーマ取得
d1.get('/tables/:name/schema', async (c) => {
  const tableName = c.req.param('name')

  // テーブル名のバリデーション
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    return c.json({ error: 'Invalid table name' }, 400)
  }

  const result = await c.env.DB.prepare(`PRAGMA table_info(${tableName})`).all()

  return c.json({ schema: result.results })
})

app.route('/api/d1', d1)

// ========================================
// R2 API
// ========================================

const r2 = new Hono<{ Bindings: Bindings; Variables: Variables }>()

r2.use('*', authMiddleware)

// オブジェクト一覧
r2.get('/objects', async (c) => {
  const prefix = c.req.query('prefix') || ''
  const limit = parseInt(c.req.query('limit') || '100', 10)
  const cursor = c.req.query('cursor')

  const options: R2ListOptions = { prefix, limit }
  if (cursor) {
    options.cursor = cursor
  }

  const list = await c.env.DATA_BUCKET.list(options)

  return c.json({
    objects: list.objects.map(obj => ({
      key: obj.key,
      size: obj.size,
      etag: obj.etag,
      uploaded: obj.uploaded.toISOString(),
    })),
    truncated: list.truncated,
    cursor: list.cursor,
  })
})

// オブジェクト取得（メタデータ）
r2.get('/objects/:key{.+}', async (c) => {
  const key = c.req.param('key')
  const obj = await c.env.DATA_BUCKET.head(key)

  if (obj === null) {
    return c.json({ error: 'Object not found' }, 404)
  }

  return c.json({
    key: obj.key,
    size: obj.size,
    etag: obj.etag,
    httpEtag: obj.httpEtag,
    uploaded: obj.uploaded.toISOString(),
    customMetadata: obj.customMetadata,
  })
})

// オブジェクトダウンロード
r2.get('/download/:key{.+}', async (c) => {
  const key = c.req.param('key')
  const obj = await c.env.DATA_BUCKET.get(key)

  if (obj === null) {
    return c.json({ error: 'Object not found' }, 404)
  }

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)

  return new Response(obj.body, { headers })
})

// オブジェクトアップロード
r2.put('/objects/:key{.+}', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.arrayBuffer()
  const contentType = c.req.header('Content-Type') || 'application/octet-stream'

  const result = await c.env.DATA_BUCKET.put(key, body, {
    httpMetadata: { contentType },
  })

  return c.json({
    success: true,
    key: result?.key,
    etag: result?.etag,
  })
})

// オブジェクト削除
r2.delete('/objects/:key{.+}', async (c) => {
  const key = c.req.param('key')
  await c.env.DATA_BUCKET.delete(key)

  return c.json({ success: true, key })
})

app.route('/api/r2', r2)

// ========================================
// Analytics Engine API
// ========================================

const analytics = new Hono<{ Bindings: Bindings; Variables: Variables }>()

analytics.use('*', authMiddleware)

// イベント記録
analytics.post('/events', async (c) => {
  const { blobs, doubles, indexes } = await c.req.json<{
    blobs?: string[]
    doubles?: number[]
    indexes?: string[]
  }>()

  c.env.ANALYTICS.writeDataPoint({
    blobs: blobs || [],
    doubles: doubles || [],
    indexes: indexes || [],
  })

  return c.json({ success: true })
})

app.route('/api/analytics', analytics)

// ========================================
// エラーハンドリング
// ========================================

app.onError((err, c) => {
  console.error(`Error: ${err.message}`, {
    requestId: c.get('requestId'),
    path: c.req.path,
    method: c.req.method,
  })

  return c.json(
    {
      error: 'Internal Server Error',
      message: c.env.ENVIRONMENT === 'development' ? err.message : undefined,
      requestId: c.get('requestId'),
    },
    500
  )
})

app.notFound((c) => {
  return c.json(
    {
      error: 'Not Found',
      path: c.req.path,
      requestId: c.get('requestId'),
    },
    404
  )
})

export default app
