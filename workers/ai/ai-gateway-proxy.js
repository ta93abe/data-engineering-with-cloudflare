/**
 * AI Gateway Proxy Worker
 *
 * Cloudflare AI Gatewayを使用した外部AIプロバイダーへのプロキシ
 * - OpenAI、Anthropic、Hugging Faceなどの統一インターフェース
 * - リクエストキャッシング
 * - コスト追跡とレート制限
 */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return handleCORS();
    }

    try {
      const url = new URL(request.url);

      // OpenAI互換エンドポイント
      if (url.pathname === "/openai/chat" && request.method === "POST") {
        return await proxyOpenAI(request, env);
      }

      // Anthropic Claude互換エンドポイント
      if (url.pathname === "/anthropic/messages" && request.method === "POST") {
        return await proxyAnthropic(request, env);
      }

      // 使用統計
      if (url.pathname === "/usage" && request.method === "GET") {
        return await getUsageStats(request, env);
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
 * OpenAIへのプロキシ
 */
async function proxyOpenAI(request, env) {
  const body = await request.json();

  // AI Gateway経由でOpenAI APIを呼び出し
  // 形式: https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_slug}/openai/chat/completions
  const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/openai/chat/completions`;

  const startTime = Date.now();

  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const latency = Date.now() - startTime;
  const data = await response.json();

  // メトリクス記録
  if (env.ANALYTICS) {
    env.ANALYTICS.writeDataPoint({
      blobs: ["ai_gateway", "openai", body.model || "gpt-3.5-turbo"],
      doubles: [
        latency,
        data.usage?.total_tokens || 0,
        data.usage?.prompt_tokens || 0,
        data.usage?.completion_tokens || 0
      ],
      indexes: [new Date().toISOString()]
    });
  }

  // KVにコスト情報をキャッシュ（オプション）
  if (env.COST_TRACKING && data.usage) {
    const costKey = `cost:${new Date().toISOString().split('T')[0]}`;
    const currentCost = parseFloat(await env.COST_TRACKING.get(costKey) || "0");

    // GPT-3.5-Turboの概算コスト（$0.0015 / 1K tokens input, $0.002 / 1K tokens output）
    const estimatedCost =
      (data.usage.prompt_tokens / 1000 * 0.0015) +
      (data.usage.completion_tokens / 1000 * 0.002);

    await env.COST_TRACKING.put(costKey, (currentCost + estimatedCost).toString());
  }

  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "X-Gateway-Latency": `${latency}ms`
    }
  });
}

/**
 * Anthropic Claudeへのプロキシ
 */
async function proxyAnthropic(request, env) {
  const body = await request.json();

  // AI Gateway経由でAnthropic APIを呼び出し
  const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/anthropic/messages`;

  const startTime = Date.now();

  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  const latency = Date.now() - startTime;
  const data = await response.json();

  // メトリクス記録
  if (env.ANALYTICS) {
    env.ANALYTICS.writeDataPoint({
      blobs: ["ai_gateway", "anthropic", body.model || "claude-3-sonnet"],
      doubles: [
        latency,
        data.usage?.input_tokens || 0,
        data.usage?.output_tokens || 0
      ],
      indexes: [new Date().toISOString()]
    });
  }

  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "X-Gateway-Latency": `${latency}ms`
    }
  });
}

/**
 * 使用統計取得
 */
async function getUsageStats(request, env) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || new Date().toISOString().split('T')[0];

  let dailyCost = 0;

  if (env.COST_TRACKING) {
    const costKey = `cost:${date}`;
    dailyCost = parseFloat(await env.COST_TRACKING.get(costKey) || "0");
  }

  return new Response(
    JSON.stringify({
      date,
      estimated_cost_usd: dailyCost.toFixed(4),
      note: "Cost tracking requires COST_TRACKING KV namespace"
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
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key"
    }
  });
}
