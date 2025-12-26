# Cloudflare AI/ML 統合ガイド

Cloudflareプラットフォームを活用した機械学習・AI実装の完全ガイド。

## 目次

- [概要](#概要)
- [Cloudflare AI機能一覧](#cloudflare-ai機能一覧)
- [Workers AI（推論）](#workers-ai推論)
- [Vectorize（ベクトル検索）](#vectorizeベクトル検索)
- [AI Gateway](#ai-gateway)
- [外部MLプラットフォーム統合](#外部mlプラットフォーム統合)
- [実装パターン](#実装パターン)
- [制限事項と回避策](#制限事項と回避策)
- [ベストプラクティス](#ベストプラクティス)

---

## 概要

### Cloudflareでできること vs できないこと

| 機能 | Cloudflare | 外部必要 | 備考 |
|------|-----------|---------|------|
| **推論（Inference）** | ✅ Workers AI | - | 50+モデル利用可能 |
| **ベクトル検索** | ✅ Vectorize | - | GA、RAGに最適 |
| **モデルホスティング** | ✅ カスタムモデル | - | ベータ版 |
| **埋め込み生成** | ✅ Workers AI | - | BGE, BAAI等 |
| **トレーニング** | ❌ | ✅ 外部必要 | GPU/TPUなし |
| **特徴量エンジニアリング** | ⚠️ 限定的 | ✅ 推奨 | Workersで可能だが制限あり |
| **実験管理** | ❌ | ✅ MLflow等 | MLOps機能なし |
| **大規模バッチ推論** | ⚠️ 限定的 | ✅ 推奨 | 実行時間制限あり |

### 推奨アーキテクチャ

```
[データ収集] → Cloudflare R2 (Bronze)
                     ↓
[特徴量生成] → 外部ML Platform (Colab/Databricks)
                     ↓
[モデル学習] → 外部ML Platform
                     ↓
[モデル保存] → Cloudflare R2 (Models)
                     ↓
[推論・提供] → Cloudflare Workers AI
                     ↓
[ベクトル化] → Cloudflare Vectorize
                     ↓
[アプリ]     → Cloudflare Workers + Pages
```

---

## Cloudflare AI機能一覧

### 1. Workers AI

**概要**: グローバルエッジでAI推論を実行

**利用可能なモデル（抜粋）:**

#### 大規模言語モデル（LLM）
- `@cf/meta/llama-2-7b-chat-int8` - Llama 2 7B
- `@cf/mistral/mistral-7b-instruct-v0.1` - Mistral 7B
- `@cf/meta/llama-3-8b-instruct` - Llama 3 8B
- `@cf/google/gemma-7b-it` - Gemma 7B
- `@cf/thebloke/codellama-7b-instruct-awq` - CodeLlama

#### 埋め込みモデル
- `@cf/baai/bge-base-en-v1.5` - BGE embeddings
- `@cf/baai/bge-large-en-v1.5` - BGE large
- `@cf/baai/bge-small-en-v1.5` - BGE small

#### 画像生成
- `@cf/stabilityai/stable-diffusion-xl-base-1.0` - SDXL
- `@cf/bytedance/stable-diffusion-xl-lightning` - SDXL Lightning

#### 音声
- `@cf/openai/whisper` - 音声認識

#### 画像認識
- `@cf/microsoft/resnet-50` - ResNet-50

**料金:**
- 無料枠: 10,000リクエスト/日
- 有料: $0.011 / 1,000 Neurons

### 2. Vectorize

**概要**: グローバル分散ベクトルデータベース

**特徴:**
- 次元数: 最大1,536次元（OpenAI互換）
- インデックスサイズ: 最大500万ベクトル/インデックス
- メトリック: コサイン類似度、ユークリッド距離、ドット積
- メタデータフィルタリング

**料金:**
- 無料枠: 500万クエリ/月、3,000万保存ベクトル次元
- 有料: $0.040 / 100万クエリ

### 3. AI Gateway

**概要**: AI API の統合管理・監視プレーン

**対応プロバイダー:**
- OpenAI
- Azure OpenAI
- HuggingFace
- AWS Bedrock
- Anthropic Claude
- Google Vertex AI

**機能:**
- コスト追跡・分析
- レート制限
- キャッシング
- ログ収集
- フォールバック

---

## Workers AI（推論）

### LLMテキスト生成

```javascript
// workers/ai/llm-chat.js
export default {
  async fetch(request, env) {
    const { prompt } = await request.json();

    const response = await env.AI.run(
      '@cf/meta/llama-2-7b-chat-int8',
      {
        messages: [
          {
            role: 'system',
            content: 'You are a helpful data analyst assistant.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      }
    );

    return Response.json({
      response: response.response,
      usage: response.usage
    });
  }
};
```

**wrangler.toml設定:**
```toml
name = "llm-chat-worker"
main = "workers/ai/llm-chat.js"
compatibility_date = "2024-01-01"

[ai]
binding = "AI"
```

### 埋め込み生成

```javascript
// workers/ai/embeddings.js
export default {
  async fetch(request, env) {
    const { text } = await request.json();

    // テキストを埋め込みベクトルに変換
    const embeddings = await env.AI.run(
      '@cf/baai/bge-base-en-v1.5',
      {
        text: text
      }
    );

    // Vectorizeに保存
    const vectorId = crypto.randomUUID();
    await env.VECTORIZE.insert([{
      id: vectorId,
      values: embeddings.data[0],
      metadata: {
        text: text,
        timestamp: Date.now()
      }
    }]);

    return Response.json({
      vectorId,
      dimensions: embeddings.data[0].length,
      message: 'Embedding created and stored'
    });
  }
};
```

**wrangler.toml:**
```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "document-embeddings"
```

### 画像生成

```javascript
// workers/ai/image-generation.js
export default {
  async fetch(request, env) {
    const { prompt } = await request.json();

    const response = await env.AI.run(
      '@cf/stabilityai/stable-diffusion-xl-base-1.0',
      {
        prompt: prompt,
        num_steps: 20,
        guidance: 7.5
      }
    );

    // 画像をR2に保存
    const imageId = crypto.randomUUID();
    await env.R2.put(
      `generated-images/${imageId}.png`,
      response,
      {
        httpMetadata: {
          contentType: 'image/png'
        }
      }
    );

    return Response.json({
      imageId,
      url: `https://your-bucket.r2.cloudflarestorage.com/generated-images/${imageId}.png`
    });
  }
};
```

---

## Vectorize（ベクトル検索）

### RAG（Retrieval-Augmented Generation）システム

```javascript
// workers/ai/rag-system.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. ドキュメント追加
    if (path === '/add-document' && request.method === 'POST') {
      const { text } = await request.json();

      // テキストを埋め込みに変換
      const embeddings = await env.AI.run(
        '@cf/baai/bge-base-en-v1.5',
        { text }
      );

      // Vectorizeに保存
      const docId = crypto.randomUUID();
      await env.VECTORIZE.insert([{
        id: docId,
        values: embeddings.data[0],
        metadata: { text, timestamp: Date.now() }
      }]);

      return Response.json({ docId, message: 'Document added' });
    }

    // 2. 質問応答（RAG）
    if (path === '/query' && request.method === 'POST') {
      const { question } = await request.json();

      // 質問を埋め込みに変換
      const queryEmbedding = await env.AI.run(
        '@cf/baai/bge-base-en-v1.5',
        { text: question }
      );

      // 類似ドキュメントを検索
      const results = await env.VECTORIZE.query(
        queryEmbedding.data[0],
        {
          topK: 3,
          returnMetadata: true
        }
      );

      // 検索結果をコンテキストとしてLLMに渡す
      const context = results.matches
        .map(m => m.metadata.text)
        .join('\n\n');

      const llmResponse = await env.AI.run(
        '@cf/meta/llama-2-7b-chat-int8',
        {
          messages: [
            {
              role: 'system',
              content: 'Answer the question based on the following context:\n\n' + context
            },
            {
              role: 'user',
              content: question
            }
          ]
        }
      );

      return Response.json({
        answer: llmResponse.response,
        sources: results.matches.map(m => ({
          text: m.metadata.text,
          score: m.score
        }))
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
```

### セマンティック検索

```javascript
// workers/ai/semantic-search.js
export default {
  async fetch(request, env) {
    const { query, filters } = await request.json();

    // クエリを埋め込みに変換
    const embeddings = await env.AI.run(
      '@cf/baai/bge-base-en-v1.5',
      { text: query }
    );

    // メタデータフィルタリング付きで検索
    const results = await env.VECTORIZE.query(
      embeddings.data[0],
      {
        topK: 10,
        filter: filters, // 例: { category: 'documentation' }
        returnMetadata: true,
        returnValues: false
      }
    );

    return Response.json({
      query,
      results: results.matches.map(match => ({
        id: match.id,
        score: match.score,
        metadata: match.metadata
      }))
    });
  }
};
```

---

## AI Gateway

### OpenAI統合（コスト管理・キャッシング）

```javascript
// workers/ai/openai-gateway.js
export default {
  async fetch(request, env) {
    const { prompt } = await request.json();

    // AI Gateway経由でOpenAI APIを呼び出し
    const response = await fetch(
      `https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/openai/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            { role: 'user', content: prompt }
          ],
          // AI Gatewayのキャッシング有効化
          metadata: {
            'cf-cache-ttl': 3600 // 1時間キャッシュ
          }
        })
      }
    );

    const data = await response.json();

    // コスト情報をD1に記録
    await env.DB.prepare(`
      INSERT INTO ai_usage (
        provider,
        model,
        tokens,
        cost,
        timestamp
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(
      'openai',
      'gpt-4',
      data.usage.total_tokens,
      calculateCost(data.usage),
      Date.now()
    ).run();

    return Response.json(data);
  }
};

function calculateCost(usage) {
  // GPT-4料金計算（例）
  const inputCost = (usage.prompt_tokens / 1000) * 0.03;
  const outputCost = (usage.completion_tokens / 1000) * 0.06;
  return inputCost + outputCost;
}
```

**AI Gateway設定（ダッシュボード）:**
1. Cloudflareダッシュボード → AI → AI Gateway
2. 新しいゲートウェイを作成
3. プロバイダー（OpenAI等）を選択
4. レート制限、キャッシングを設定

---

## 外部MLプラットフォーム統合

### Google Colab → R2 → Workers AI

#### 1. Google Colabでモデルトレーニング

```python
# Google Colab
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
import joblib
import boto3
import os

# 1. データ読み込み（R2から）
s3 = boto3.client(
    's3',
    endpoint_url=f"https://{os.getenv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
    aws_access_key_id=os.getenv('R2_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('R2_SECRET_ACCESS_KEY'),
    region_name='auto'
)

# R2からトレーニングデータをダウンロード
s3.download_file('data-lake-silver', 'training/features.parquet', 'features.parquet')
df = pd.read_parquet('features.parquet')

# 2. モデルトレーニング
X = df.drop('target', axis=1)
y = df['target']

model = RandomForestClassifier(n_estimators=100)
model.fit(X, y)

# 3. モデルをR2にアップロード
joblib.dump(model, 'model.joblib')
s3.upload_file(
    'model.joblib',
    'ml-models',
    'random_forest/v1/model.joblib',
    ExtraArgs={'ContentType': 'application/octet-stream'}
)

print("✅ Model trained and uploaded to R2")
```

#### 2. Workers で推論

```python
# workers/ai/custom-model-inference.py
# Cloudflare Workers Python Runtime

from js import Response, fetch
import joblib
import pandas as pd
import io

async def on_fetch(request, env):
    # リクエストからデータ取得
    data = await request.json()
    features = pd.DataFrame([data['features']])

    # R2からモデルをダウンロード（初回のみ、キャッシュ推奨）
    model_response = await fetch(
        f"https://{env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/ml-models/random_forest/v1/model.joblib",
        headers={
            'Authorization': f"Bearer {env.R2_ACCESS_TOKEN}"
        }
    )

    model_bytes = await model_response.arrayBuffer()
    model = joblib.load(io.BytesIO(model_bytes))

    # 推論
    prediction = model.predict(features)[0]
    probability = model.predict_proba(features)[0].tolist()

    return Response.json({
        'prediction': int(prediction),
        'probability': probability,
        'model_version': 'v1'
    })
```

### HuggingFace → Cloudflare

```javascript
// workers/ai/huggingface-integration.js
export default {
  async fetch(request, env) {
    const { text } = await request.json();

    // AI Gateway経由でHuggingFace APIを呼び出し
    const response = await fetch(
      `https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/huggingface/models/sentence-transformers/all-MiniLM-L6-v2`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: text
        })
      }
    );

    const embeddings = await response.json();

    // Vectorizeに保存
    const vectorId = crypto.randomUUID();
    await env.VECTORIZE.insert([{
      id: vectorId,
      values: embeddings[0],
      metadata: { text }
    }]);

    return Response.json({
      vectorId,
      message: 'Embedding created via HuggingFace'
    });
  }
};
```

---

## 実装パターン

### パターン1: エッジMLアプリケーション

```
[ユーザー入力]
     ↓
[Workers] → Workers AI (推論)
     ↓
[Vectorize] (ベクトル検索)
     ↓
[Workers] → LLM (回答生成)
     ↓
[ユーザーへ返信]
```

**ユースケース:**
- チャットボット
- コンテンツ推薦
- セマンティック検索

### パターン2: バッチ推論パイプライン

```
[R2 Bronze] (生データ)
     ↓
[dlt] → 特徴量抽出
     ↓
[R2 Silver] (特徴量)
     ↓
[GitHub Actions] → Workers AI (バッチ推論)
     ↓
[R2 Gold] (予測結果)
     ↓
[dbt] → 集計
     ↓
[Evidence.dev] (可視化)
```

**ユースケース:**
- スコアリング
- 異常検知
- 分類タスク

### パターン3: ハイブリッドML

```
[外部ML Platform] (トレーニング)
     ↓
[R2] (モデル保存)
     ↓
[Workers AI] (リアルタイム推論)
     │
     ├→ [Vectorize] (ベクトル化)
     │
     └→ [D1] (結果保存)
```

**ユースケース:**
- カスタムモデルのデプロイ
- A/Bテスト
- モデルバージョニング

---

## 制限事項と回避策

### 1. Workers実行時間制限

**制限:**
- Free: CPU時間 10ms
- Paid: CPU時間 30秒（標準）、15分（Durable Objects）

**回避策:**
```javascript
// 大規模推論はキューで分割
export default {
  async fetch(request, env) {
    const { items } = await request.json();

    // 大量データは Queue で非同期処理
    for (const batch of chunkArray(items, 10)) {
      await env.QUEUE.send({
        batch,
        timestamp: Date.now()
      });
    }

    return Response.json({
      message: `${items.length} items queued for processing`
    });
  }
};

// Queue Consumer
export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      const { batch: items } = message.body;

      // バッチ推論
      for (const item of items) {
        const result = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
          messages: [{ role: 'user', content: item.text }]
        });

        // 結果をD1に保存
        await env.DB.prepare(`
          INSERT INTO predictions (item_id, prediction) VALUES (?, ?)
        `).bind(item.id, result.response).run();
      }

      message.ack();
    }
  }
};
```

### 2. モデルサイズ制限

**制限:**
- Workers AIモデル: Cloudflare提供のみ
- カスタムモデル: ベータ版、サイズ制限あり

**回避策:**
```javascript
// AI Gateway経由で外部大規模モデルを使用
export default {
  async fetch(request, env) {
    const { prompt } = await request.json();

    // GPT-4等の大規模モデルはAI Gateway経由
    const response = await fetch(
      `https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/openai/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4-turbo',
          messages: [{ role: 'user', content: prompt }]
        })
      }
    );

    return response;
  }
};
```

### 3. GPU/TPUなし

**制限:**
- モデルトレーニング不可
- 重い前処理は遅い

**回避策:**
- トレーニング: Google Colab、AWS SageMaker、Databricks
- 前処理: dlt、dbt（R2上で実行）
- 推論のみCloudflareで実行

---

## ベストプラクティス

### 1. モデル選択

```javascript
// ✅ Good: タスクに適したモデル選択
const model = isCodeTask
  ? '@cf/thebloke/codellama-7b-instruct-awq'
  : '@cf/meta/llama-2-7b-chat-int8';

// ❌ Bad: すべてに大規模モデル使用（コスト高）
const model = 'gpt-4-turbo'; // 外部API、高コスト
```

### 2. キャッシング活用

```javascript
// ✅ Good: 同じ質問はキャッシュから返す
export default {
  async fetch(request, env) {
    const { question } = await request.json();

    // KVでキャッシュチェック
    const cacheKey = `answer:${hashString(question)}`;
    const cached = await env.KV.get(cacheKey, 'json');

    if (cached) {
      return Response.json({
        answer: cached,
        cached: true
      });
    }

    // キャッシュになければ推論
    const result = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
      messages: [{ role: 'user', content: question }]
    });

    // 結果をキャッシュ（1時間）
    await env.KV.put(cacheKey, JSON.stringify(result.response), {
      expirationTtl: 3600
    });

    return Response.json({
      answer: result.response,
      cached: false
    });
  }
};
```

### 3. コスト監視

```javascript
// D1でAI使用量を追跡
export default {
  async fetch(request, env) {
    const startTime = Date.now();

    const result = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
      messages: [{ role: 'user', content: 'Hello' }]
    });

    const duration = Date.now() - startTime;

    // 使用量をD1に記録
    await env.DB.prepare(`
      INSERT INTO ai_usage (
        model,
        tokens_input,
        tokens_output,
        duration_ms,
        timestamp
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(
      'llama-2-7b',
      result.usage?.prompt_tokens || 0,
      result.usage?.completion_tokens || 0,
      duration,
      Date.now()
    ).run();

    return Response.json(result);
  }
};
```

### 4. エラーハンドリング

```javascript
// ✅ Good: フォールバック戦略
export default {
  async fetch(request, env) {
    const { prompt } = await request.json();

    try {
      // まずWorkers AIで試行
      return await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
        messages: [{ role: 'user', content: prompt }]
      });
    } catch (error) {
      console.error('Workers AI failed:', error);

      // フォールバック: AI Gateway経由で外部API
      try {
        const response = await fetch(
          `https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/openai/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'gpt-3.5-turbo',
              messages: [{ role: 'user', content: prompt }]
            })
          }
        );

        return Response.json(await response.json());
      } catch (fallbackError) {
        return Response.json({
          error: 'All AI services unavailable'
        }, { status: 503 });
      }
    }
  }
};
```

---

## 参考リンク

### Cloudflare公式
- [Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Vectorize Documentation](https://developers.cloudflare.com/vectorize/)
- [AI Gateway Documentation](https://developers.cloudflare.com/ai-gateway/)
- [Workers AI Models](https://developers.cloudflare.com/workers-ai/models/)

### 外部MLプラットフォーム
- [Google Colab](https://colab.research.google.com/)
- [AWS SageMaker](https://aws.amazon.com/sagemaker/)
- [Databricks](https://www.databricks.com/)
- [HuggingFace](https://huggingface.co/)

### コミュニティ
- [Cloudflare Developers Discord](https://discord.gg/cloudflaredev)
- [Workers AI Examples](https://github.com/cloudflare/workers-sdk/tree/main/templates)

---

最終更新: 2025-12-26
