/**
 * LLM Chat Worker
 *
 * Cloudflare Workers AIを使用したLLMチャットエンドポイント
 * モデル: @cf/meta/llama-2-7b-chat-int8
 */

export default {
  async fetch(request, env) {
    // CORS対応
    if (request.method === "OPTIONS") {
      return handleCORS();
    }

    try {
      const url = new URL(request.url);

      // ヘルスチェック
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "healthy" }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // チャットエンドポイント
      if (url.pathname === "/chat" && request.method === "POST") {
        return await handleChat(request, env);
      }

      // ストリーミングチャット
      if (url.pathname === "/chat/stream" && request.method === "POST") {
        return await handleStreamingChat(request, env);
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
 * 通常のチャット処理
 */
async function handleChat(request, env) {
  const { messages, max_tokens = 512, temperature = 0.7 } = await request.json();

  if (!messages || !Array.isArray(messages)) {
    return new Response(
      JSON.stringify({ error: "messages array is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const startTime = Date.now();

  // Workers AIでLLMを実行
  const response = await env.AI.run("@cf/meta/llama-2-7b-chat-int8", {
    messages,
    max_tokens,
    temperature
  });

  const latency = Date.now() - startTime;

  // メトリクスをAnalytics Engineに記録
  if (env.ANALYTICS) {
    env.ANALYTICS.writeDataPoint({
      blobs: ["llm_chat", "llama-2-7b"],
      doubles: [latency, max_tokens],
      indexes: [new Date().toISOString()]
    });
  }

  return new Response(
    JSON.stringify({
      response: response.response,
      model: "@cf/meta/llama-2-7b-chat-int8",
      latency_ms: latency,
      tokens: max_tokens
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
 * ストリーミングチャット処理
 */
async function handleStreamingChat(request, env) {
  const { messages, max_tokens = 512 } = await request.json();

  if (!messages || !Array.isArray(messages)) {
    return new Response(
      JSON.stringify({ error: "messages array is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // ReadableStreamを使用してストリーミング応答
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // バックグラウンドでLLMを実行
  (async () => {
    try {
      const stream = await env.AI.run(
        "@cf/meta/llama-2-7b-chat-int8",
        {
          messages,
          max_tokens,
          stream: true
        }
      );

      for await (const chunk of stream) {
        await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }

      await writer.write(encoder.encode("data: [DONE]\n\n"));
      await writer.close();
    } catch (error) {
      console.error("Streaming error:", error);
      await writer.write(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`));
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

/**
 * CORS対応
 */
function handleCORS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
