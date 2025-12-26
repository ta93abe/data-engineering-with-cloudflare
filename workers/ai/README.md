# Cloudflare AI Workers

Cloudflare Workers AI、Vectorize、AI Gatewayを使用したAI/ML機能の実装例。

## 📁 Workers一覧

| Worker | 説明 | 主な機能 |
|--------|------|----------|
| **llm-chat.js** | LLMチャット | Llama 2を使用したテキスト生成、ストリーミング対応 |
| **embeddings.js** | 埋め込み生成 | テキストのベクトル化、Vectorizeへの保存 |
| **rag-system.js** | RAGシステム | 検索拡張生成、ドキュメント検索＋LLM回答 |
| **semantic-search.js** | セマンティック検索 | 意味ベースの検索、ハイブリッド検索 |
| **image-generation.js** | 画像生成 | Stable Diffusionによる画像生成、R2保存 |
| **ai-gateway-proxy.js** | AI Gatewayプロキシ | 外部AIプロバイダーの統合、コスト追跡 |

## 🚀 デプロイ方法

### 1. 前提条件

```bash
# Wranglerのインストール
npm install -g wrangler

# Cloudflareアカウントへログイン
wrangler login
```

### 2. Vectorizeインデックス作成

```bash
# RAG/検索用のVectorizeインデックスを作成
wrangler vectorize create rag-documents --dimensions=768 --metric=cosine

# 別のアプリケーション用インデックス
wrangler vectorize create semantic-search --dimensions=768 --metric=cosine
```

### 3. wrangler.tomlの設定

各Workerのルートディレクトリに`wrangler.toml`を作成：

#### llm-chat Worker

```toml
name = "llm-chat"
main = "workers/ai/llm-chat.js"
compatibility_date = "2024-01-01"

# Workers AI binding
[ai]
binding = "AI"

# Analytics Engine binding (オプション)
[[analytics_engine_datasets]]
binding = "ANALYTICS"
```

#### embeddings Worker

```toml
name = "embeddings"
main = "workers/ai/embeddings.js"
compatibility_date = "2024-01-01"

[ai]
binding = "AI"

[[vectorize]]
binding = "VECTORIZE"
index_name = "rag-documents"
```

#### rag-system Worker

```toml
name = "rag-system"
main = "workers/ai/rag-system.js"
compatibility_date = "2024-01-01"

[ai]
binding = "AI"

[[vectorize]]
binding = "VECTORIZE"
index_name = "rag-documents"

[[analytics_engine_datasets]]
binding = "ANALYTICS"
```

#### semantic-search Worker

```toml
name = "semantic-search"
main = "workers/ai/semantic-search.js"
compatibility_date = "2024-01-01"

[ai]
binding = "AI"

[[vectorize]]
binding = "VECTORIZE"
index_name = "semantic-search"
```

#### image-generation Worker

```toml
name = "image-generation"
main = "workers/ai/image-generation.js"
compatibility_date = "2024-01-01"

[ai]
binding = "AI"

[[analytics_engine_datasets]]
binding = "ANALYTICS"

# R2 binding (画像保存用)
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "generated-images"

[vars]
R2_PUBLIC_URL = "https://pub-xxxxx.r2.dev"
```

#### ai-gateway-proxy Worker

```toml
name = "ai-gateway-proxy"
main = "workers/ai/ai-gateway-proxy.js"
compatibility_date = "2024-01-01"

[[analytics_engine_datasets]]
binding = "ANALYTICS"

[[kv_namespaces]]
binding = "COST_TRACKING"
id = "your-kv-namespace-id"

[vars]
CLOUDFLARE_ACCOUNT_ID = "your-account-id"
AI_GATEWAY_ID = "your-gateway-id"

# シークレット（wrangler secret putで設定）
# OPENAI_API_KEY
# ANTHROPIC_API_KEY
```

### 4. シークレットの設定

```bash
# OpenAI APIキー
wrangler secret put OPENAI_API_KEY --name ai-gateway-proxy

# Anthropic APIキー
wrangler secret put ANTHROPIC_API_KEY --name ai-gateway-proxy
```

### 5. デプロイ

```bash
# LLM Chat Worker
wrangler deploy --config wrangler-llm-chat.toml

# Embeddings Worker
wrangler deploy --config wrangler-embeddings.toml

# RAG System Worker
wrangler deploy --config wrangler-rag-system.toml

# Semantic Search Worker
wrangler deploy --config wrangler-semantic-search.toml

# Image Generation Worker
wrangler deploy --config wrangler-image-generation.toml

# AI Gateway Proxy Worker
wrangler deploy --config wrangler-ai-gateway-proxy.toml
```

## 📖 使用例

### 1. LLM Chat

```bash
# 通常のチャット
curl -X POST https://llm-chat.your-domain.workers.dev/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What is Cloudflare?"}
    ],
    "max_tokens": 256
  }'

# ストリーミングチャット
curl -X POST https://llm-chat.your-domain.workers.dev/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Tell me a story"}
    ]
  }'
```

### 2. Embeddings

```bash
# 埋め込み生成
curl -X POST https://embeddings.your-domain.workers.dev/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Cloudflare Workers is a serverless platform"
  }'

# Vectorizeに保存
curl -X POST https://embeddings.your-domain.workers.dev/embeddings/store \
  -H "Content-Type: application/json" \
  -d '{
    "id": "doc-1",
    "text": "Cloudflare Workers is a serverless platform",
    "metadata": {"category": "documentation"}
  }'

# バッチ処理
curl -X POST https://embeddings.your-domain.workers.dev/embeddings/batch \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"id": "doc-1", "text": "First document"},
      {"id": "doc-2", "text": "Second document"}
    ]
  }'
```

### 3. RAG System

```bash
# ドキュメント追加
curl -X POST https://rag-system.your-domain.workers.dev/rag/documents \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      {
        "id": "cf-workers-1",
        "text": "Cloudflare Workers is a serverless platform that runs on Cloudflare'\''s global network.",
        "metadata": {"source": "docs", "topic": "workers"}
      },
      {
        "id": "cf-r2-1",
        "text": "R2 is Cloudflare'\''s object storage with zero egress fees.",
        "metadata": {"source": "docs", "topic": "r2"}
      }
    ]
  }'

# RAGクエリ
curl -X POST https://rag-system.your-domain.workers.dev/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is Cloudflare Workers?",
    "top_k": 3
  }'
```

### 4. Semantic Search

```bash
# セマンティック検索
curl -X POST https://semantic-search.your-domain.workers.dev/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "serverless computing platform",
    "top_k": 5
  }'

# ハイブリッド検索
curl -X POST https://semantic-search.your-domain.workers.dev/search/hybrid \
  -H "Content-Type: application/json" \
  -d '{
    "query": "edge computing",
    "keywords": ["cloudflare", "workers"],
    "top_k": 10,
    "semantic_weight": 0.7
  }'

# 類似ドキュメント検索
curl -X POST https://semantic-search.your-domain.workers.dev/similar \
  -H "Content-Type: application/json" \
  -d '{
    "document_id": "doc-1",
    "top_k": 5
  }'
```

### 5. Image Generation

```bash
# 画像生成
curl -X POST https://image-generation.your-domain.workers.dev/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A serene mountain landscape at sunset",
    "num_steps": 20
  }' --output generated.png

# R2に保存
curl -X POST https://image-generation.your-domain.workers.dev/generate/save \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A futuristic city",
    "filename": "futuristic-city.png"
  }'
```

### 6. AI Gateway Proxy

```bash
# OpenAI経由でチャット
curl -X POST https://ai-gateway-proxy.your-domain.workers.dev/openai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'

# Anthropic Claude経由
curl -X POST https://ai-gateway-proxy.your-domain.workers.dev/anthropic/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet-20240229",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'

# 使用統計
curl https://ai-gateway-proxy.your-domain.workers.dev/usage?date=2025-01-15
```

## 🔧 ローカル開発

```bash
# Miniflareを使用したローカル開発
wrangler dev workers/ai/llm-chat.js --local

# 特定のポートで実行
wrangler dev workers/ai/rag-system.js --local --port 8787
```

## 📊 モニタリング

### Analytics Engineでメトリクス確認

```sql
-- LLMチャットのレイテンシ分析
SELECT
  blob1 as model,
  AVG(double1) as avg_latency_ms,
  MAX(double1) as max_latency_ms,
  COUNT(*) as total_requests
FROM ANALYTICS_DATASET
WHERE blob1 = 'llm_chat'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY blob1

-- RAGシステムのパフォーマンス
SELECT
  AVG(double1) as avg_total_latency_ms,
  AVG(double2) as avg_embedding_ms,
  AVG(double3) as avg_search_ms,
  AVG(double4) as avg_llm_ms
FROM ANALYTICS_DATASET
WHERE blob1 = 'rag_query'
  AND timestamp > NOW() - INTERVAL '24' HOUR
```

### Vectorizeの統計

```bash
# インデックス情報を確認
wrangler vectorize get rag-documents

# ベクトル数を確認
wrangler vectorize info rag-documents
```

## 🎯 ベストプラクティス

### 1. エラーハンドリング

```javascript
try {
  const response = await env.AI.run(model, inputs);
  return new Response(JSON.stringify(response), {
    headers: { "Content-Type": "application/json" }
  });
} catch (error) {
  console.error("AI Error:", error);

  // フォールバック処理
  return new Response(
    JSON.stringify({
      error: "AI service temporarily unavailable",
      message: error.message
    }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
}
```

### 2. レート制限

```javascript
// KVを使用したシンプルなレート制限
const rateLimitKey = `ratelimit:${clientId}`;
const requestCount = parseInt(await env.KV.get(rateLimitKey) || "0");

if (requestCount > 100) {
  return new Response("Rate limit exceeded", { status: 429 });
}

await env.KV.put(rateLimitKey, (requestCount + 1).toString(), {
  expirationTtl: 3600  // 1時間
});
```

### 3. キャッシング

```javascript
// Vectorize検索結果のキャッシング
const cacheKey = `search:${queryHash}`;
const cached = await env.KV.get(cacheKey, "json");

if (cached) {
  return new Response(JSON.stringify(cached), {
    headers: { "Content-Type": "application/json", "X-Cache": "HIT" }
  });
}

// キャッシュミス時は検索実行
const results = await env.VECTORIZE.query(...);
await env.KV.put(cacheKey, JSON.stringify(results), {
  expirationTtl: 3600
});
```

### 4. メトリクス記録

```javascript
// 詳細なメトリクス記録
env.ANALYTICS.writeDataPoint({
  blobs: [
    operationType,    // "rag_query", "embedding", etc.
    modelName,        // "llama-2-7b", "bge-base", etc.
    userId           // ユーザー識別子
  ],
  doubles: [
    latencyMs,
    tokensUsed,
    resultCount,
    cacheHitRate
  ],
  indexes: [timestamp]
});
```

## 🔐 セキュリティ

### 認証の実装例

```javascript
async function authenticate(request, env) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = authHeader.substring(7);
  const validToken = await env.API_TOKENS.get(token);

  if (!validToken) {
    return new Response("Invalid token", { status: 403 });
  }

  return null;  // 認証成功
}

export default {
  async fetch(request, env) {
    const authError = await authenticate(request, env);
    if (authError) return authError;

    // 処理を続行
  }
}
```

## 💰 コスト最適化

### Workers AIの料金

- **Neuron単位**: モデルごとに異なるNeuron消費
- **無料枠**: 10,000 Neurons/日
- **有料**: $0.011 per 1,000 Neurons

### Vectorizeの料金

- **クエリ**: 30M queries/月まで無料
- **保存**: 500万ベクトルまで無料
- **次元数**: 最大1536次元

### 最適化のヒント

1. **モデル選択**: 用途に応じて軽量モデルを使用
2. **キャッシング**: 頻繁なクエリはKVでキャッシュ
3. **バッチ処理**: 複数リクエストをまとめて処理
4. **Vectorizeフィルタリング**: メタデータフィルターで検索を絞り込み

## 📚 参考リンク

- [Workers AI ドキュメント](https://developers.cloudflare.com/workers-ai/)
- [Vectorize ドキュメント](https://developers.cloudflare.com/vectorize/)
- [AI Gateway ドキュメント](https://developers.cloudflare.com/ai-gateway/)
- [Workers AI モデル一覧](https://developers.cloudflare.com/workers-ai/models/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

---

最終更新: 2025-12-26
