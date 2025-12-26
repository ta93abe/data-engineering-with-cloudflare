/**
 * RAG (Retrieval-Augmented Generation) System Worker
 *
 * VectorizeとWorkers AIを組み合わせたRAGシステム
 * 1. ユーザーの質問を埋め込みベクトル化
 * 2. Vectorizeで関連ドキュメントを検索
 * 3. 検索結果をコンテキストとしてLLMに渡す
 */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return handleCORS();
    }

    try {
      const url = new URL(request.url);

      // RAGクエリエンドポイント
      if (url.pathname === "/rag/query" && request.method === "POST") {
        return await handleRAGQuery(request, env);
      }

      // ドキュメント追加エンドポイント
      if (url.pathname === "/rag/documents" && request.method === "POST") {
        return await addDocuments(request, env);
      }

      // インデックス統計
      if (url.pathname === "/rag/stats" && request.method === "GET") {
        return await getIndexStats(request, env);
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }
};

/**
 * RAGクエリ処理
 */
async function handleRAGQuery(request, env) {
  const {
    question,
    top_k = 3,
    temperature = 0.7,
    max_tokens = 512
  } = await request.json();

  if (!question) {
    return new Response(
      JSON.stringify({ error: "question is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const startTime = Date.now();

  // ステップ1: 質問を埋め込みベクトル化
  const queryEmbedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: question
  });

  const embeddingTime = Date.now();

  // ステップ2: Vectorizeで類似ドキュメントを検索
  const results = await env.VECTORIZE.query(queryEmbedding.data[0], {
    topK: top_k,
    returnMetadata: true
  });

  const searchTime = Date.now();

  // ステップ3: 検索結果をコンテキストとして整形
  const context = results.matches
    .map((match, i) => `[Document ${i + 1}] (Similarity: ${match.score.toFixed(3)})\n${match.metadata.text}`)
    .join("\n\n");

  // ステップ4: コンテキストと質問をLLMに渡す
  const prompt = `以下のドキュメントを参考にして、質問に答えてください。

コンテキスト:
${context}

質問: ${question}

回答:`;

  const llmResponse = await env.AI.run("@cf/meta/llama-2-7b-chat-int8", {
    messages: [
      { role: "system", content: "あなたは与えられたドキュメントを基に正確に回答するアシスタントです。" },
      { role: "user", content: prompt }
    ],
    max_tokens,
    temperature
  });

  const endTime = Date.now();

  // メトリクス記録
  if (env.ANALYTICS) {
    env.ANALYTICS.writeDataPoint({
      blobs: ["rag_query"],
      doubles: [
        endTime - startTime,  // Total latency
        embeddingTime - startTime,  // Embedding time
        searchTime - embeddingTime,  // Search time
        endTime - searchTime  // LLM time
      ],
      indexes: [new Date().toISOString()]
    });
  }

  return new Response(
    JSON.stringify({
      answer: llmResponse.response,
      sources: results.matches.map(match => ({
        id: match.id,
        similarity: match.score,
        text: match.metadata.text,
        metadata: match.metadata
      })),
      metrics: {
        total_latency_ms: endTime - startTime,
        embedding_ms: embeddingTime - startTime,
        search_ms: searchTime - embeddingTime,
        llm_ms: endTime - searchTime,
        documents_retrieved: results.matches.length
      }
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}

/**
 * ドキュメント追加
 */
async function addDocuments(request, env) {
  const { documents } = await request.json();  // [{ id, text, metadata }]

  if (!documents || !Array.isArray(documents)) {
    return new Response(
      JSON.stringify({ error: "documents array is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const vectors = [];

  // 各ドキュメントを埋め込みベクトル化
  for (const doc of documents) {
    if (!doc.id || !doc.text) {
      continue;
    }

    const embeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: doc.text
    });

    vectors.push({
      id: doc.id,
      values: embeddings.data[0],
      metadata: {
        text: doc.text,
        created_at: new Date().toISOString(),
        ...(doc.metadata || {})
      }
    });
  }

  // Vectorizeに保存
  if (vectors.length > 0) {
    await env.VECTORIZE.upsert(vectors);
  }

  return new Response(
    JSON.stringify({
      success: true,
      documents_added: vectors.length
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}

/**
 * インデックス統計（モック実装）
 */
async function getIndexStats(request, env) {
  // Vectorizeの統計情報を取得（実際のAPIがある場合）
  // 現在はモックデータを返す
  return new Response(
    JSON.stringify({
      index_name: "rag-documents",
      dimension: 768,
      total_vectors: "N/A",  // Vectorize APIで取得可能な場合は実数値
      status: "ready"
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}

function handleCORS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
