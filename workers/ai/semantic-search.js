/**
 * Semantic Search Worker
 *
 * Vectorizeを使用したセマンティック検索API
 * キーワード検索ではなく、意味的な類似性で検索
 */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return handleCORS();
    }

    try {
      const url = new URL(request.url);

      // セマンティック検索
      if (url.pathname === "/search" && request.method === "POST") {
        return await semanticSearch(request, env);
      }

      // ハイブリッド検索（キーワード + セマンティック）
      if (url.pathname === "/search/hybrid" && request.method === "POST") {
        return await hybridSearch(request, env);
      }

      // 類似ドキュメント検索
      if (url.pathname === "/similar" && request.method === "POST") {
        return await findSimilar(request, env);
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
 * セマンティック検索
 */
async function semanticSearch(request, env) {
  const {
    query,
    top_k = 10,
    filter = {},
    threshold = 0.0
  } = await request.json();

  if (!query) {
    return new Response(
      JSON.stringify({ error: "query is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const startTime = Date.now();

  // クエリを埋め込みベクトル化
  const queryEmbedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: query
  });

  // Vectorizeで検索
  const results = await env.VECTORIZE.query(queryEmbedding.data[0], {
    topK: top_k,
    returnMetadata: true,
    filter: Object.keys(filter).length > 0 ? filter : undefined
  });

  const latency = Date.now() - startTime;

  // 閾値でフィルタリング
  const filteredResults = results.matches.filter(
    match => match.score >= threshold
  );

  return new Response(
    JSON.stringify({
      query,
      results: filteredResults.map(match => ({
        id: match.id,
        score: match.score,
        text: match.metadata.text,
        metadata: match.metadata
      })),
      total_results: filteredResults.length,
      latency_ms: latency
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
 * ハイブリッド検索（キーワード + セマンティック）
 */
async function hybridSearch(request, env) {
  const {
    query,
    keywords = [],
    top_k = 10,
    semantic_weight = 0.7  // セマンティック検索の重み
  } = await request.json();

  if (!query) {
    return new Response(
      JSON.stringify({ error: "query is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // セマンティック検索
  const queryEmbedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: query
  });

  const semanticResults = await env.VECTORIZE.query(queryEmbedding.data[0], {
    topK: top_k * 2,  // より多くの候補を取得
    returnMetadata: true
  });

  // キーワードマッチングスコア計算
  const scoredResults = semanticResults.matches.map(match => {
    let keywordScore = 0;

    if (keywords.length > 0) {
      const text = match.metadata.text.toLowerCase();
      const matchedKeywords = keywords.filter(kw =>
        text.includes(kw.toLowerCase())
      );
      keywordScore = matchedKeywords.length / keywords.length;
    }

    // ハイブリッドスコア計算
    const hybridScore =
      (match.score * semantic_weight) +
      (keywordScore * (1 - semantic_weight));

    return {
      ...match,
      hybrid_score: hybridScore,
      semantic_score: match.score,
      keyword_score: keywordScore
    };
  });

  // ハイブリッドスコアでソート
  scoredResults.sort((a, b) => b.hybrid_score - a.hybrid_score);

  return new Response(
    JSON.stringify({
      query,
      keywords,
      results: scoredResults.slice(0, top_k).map(match => ({
        id: match.id,
        hybrid_score: match.hybrid_score,
        semantic_score: match.semantic_score,
        keyword_score: match.keyword_score,
        text: match.metadata.text,
        metadata: match.metadata
      })),
      total_results: scoredResults.length
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
 * 類似ドキュメント検索
 * 既存のドキュメントIDを基に類似ドキュメントを検索
 */
async function findSimilar(request, env) {
  const {
    document_id,
    top_k = 5
  } = await request.json();

  if (!document_id) {
    return new Response(
      JSON.stringify({ error: "document_id is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // ドキュメントIDからベクトルを取得
  const document = await env.VECTORIZE.getByIds([document_id]);

  if (!document || document.length === 0) {
    return new Response(
      JSON.stringify({ error: "Document not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // そのベクトルで類似検索
  const results = await env.VECTORIZE.query(document[0].values, {
    topK: top_k + 1,  // 元のドキュメント自身も含まれるため+1
    returnMetadata: true
  });

  // 元のドキュメントを除外
  const similarDocs = results.matches.filter(
    match => match.id !== document_id
  ).slice(0, top_k);

  return new Response(
    JSON.stringify({
      source_document: {
        id: document_id,
        text: document[0].metadata.text
      },
      similar_documents: similarDocs.map(match => ({
        id: match.id,
        similarity: match.score,
        text: match.metadata.text,
        metadata: match.metadata
      })),
      total_results: similarDocs.length
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
