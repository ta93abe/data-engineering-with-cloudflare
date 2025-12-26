/**
 * Embeddings Worker
 *
 * テキストの埋め込みベクトル生成とVectorizeへの保存
 * モデル: @cf/baai/bge-base-en-v1.5
 */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return handleCORS();
    }

    try {
      const url = new URL(request.url);

      // テキストの埋め込み生成
      if (url.pathname === "/embeddings" && request.method === "POST") {
        return await generateEmbeddings(request, env);
      }

      // テキストをVectorizeに保存
      if (url.pathname === "/embeddings/store" && request.method === "POST") {
        return await storeEmbeddings(request, env);
      }

      // バッチ埋め込み生成
      if (url.pathname === "/embeddings/batch" && request.method === "POST") {
        return await batchEmbeddings(request, env);
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
 * 単一テキストの埋め込み生成
 */
async function generateEmbeddings(request, env) {
  const { text, model = "@cf/baai/bge-base-en-v1.5" } = await request.json();

  if (!text) {
    return new Response(
      JSON.stringify({ error: "text is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const startTime = Date.now();

  // Workers AIで埋め込み生成
  const embeddings = await env.AI.run(model, { text });
  const latency = Date.now() - startTime;

  return new Response(
    JSON.stringify({
      embeddings: embeddings.data[0],
      dimension: embeddings.data[0].length,
      model,
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
 * テキストをVectorizeに保存
 */
async function storeEmbeddings(request, env) {
  const {
    id,
    text,
    metadata = {},
    model = "@cf/baai/bge-base-en-v1.5"
  } = await request.json();

  if (!id || !text) {
    return new Response(
      JSON.stringify({ error: "id and text are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // 埋め込み生成
  const embeddings = await env.AI.run(model, { text });
  const vector = embeddings.data[0];

  // Vectorizeに保存
  await env.VECTORIZE.upsert([
    {
      id,
      values: vector,
      metadata: {
        text,
        model,
        created_at: new Date().toISOString(),
        ...metadata
      }
    }
  ]);

  return new Response(
    JSON.stringify({
      success: true,
      id,
      dimension: vector.length,
      metadata
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
 * バッチ埋め込み生成と保存
 */
async function batchEmbeddings(request, env) {
  const {
    items,  // [{ id, text, metadata }]
    model = "@cf/baai/bge-base-en-v1.5"
  } = await request.json();

  if (!items || !Array.isArray(items)) {
    return new Response(
      JSON.stringify({ error: "items array is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const startTime = Date.now();
  const vectors = [];

  // 各テキストの埋め込みを生成
  for (const item of items) {
    if (!item.id || !item.text) {
      continue;
    }

    const embeddings = await env.AI.run(model, { text: item.text });

    vectors.push({
      id: item.id,
      values: embeddings.data[0],
      metadata: {
        text: item.text,
        model,
        created_at: new Date().toISOString(),
        ...(item.metadata || {})
      }
    });
  }

  // Vectorizeに一括保存
  if (env.VECTORIZE && vectors.length > 0) {
    await env.VECTORIZE.upsert(vectors);
  }

  const latency = Date.now() - startTime;

  return new Response(
    JSON.stringify({
      success: true,
      count: vectors.length,
      latency_ms: latency,
      model
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
