/**
 * Image Generation Worker
 *
 * Cloudflare Workers AIを使用した画像生成
 * モデル: @cf/stabilityai/stable-diffusion-xl-base-1.0
 */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return handleCORS();
    }

    try {
      const url = new URL(request.url);

      // 画像生成エンドポイント
      if (url.pathname === "/generate" && request.method === "POST") {
        return await generateImage(request, env);
      }

      // バッチ画像生成
      if (url.pathname === "/generate/batch" && request.method === "POST") {
        return await batchGenerateImages(request, env);
      }

      // R2へ保存して画像生成
      if (url.pathname === "/generate/save" && request.method === "POST") {
        return await generateAndSaveImage(request, env);
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
 * 画像生成
 */
async function generateImage(request, env) {
  const {
    prompt,
    negative_prompt = "",
    num_steps = 20,
    guidance = 7.5
  } = await request.json();

  if (!prompt) {
    return new Response(
      JSON.stringify({ error: "prompt is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const startTime = Date.now();

  // Stable Diffusionで画像生成
  const inputs = {
    prompt,
    negative_prompt,
    num_steps,
    guidance
  };

  const response = await env.AI.run(
    "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    inputs
  );

  const latency = Date.now() - startTime;

  // メトリクス記録
  if (env.ANALYTICS) {
    env.ANALYTICS.writeDataPoint({
      blobs: ["image_generation", "stable-diffusion-xl"],
      doubles: [latency, num_steps],
      indexes: [new Date().toISOString()]
    });
  }

  // 画像をBase64エンコードして返す
  return new Response(response, {
    headers: {
      "Content-Type": "image/png",
      "Access-Control-Allow-Origin": "*",
      "X-Generation-Time": `${latency}ms`
    }
  });
}

/**
 * バッチ画像生成
 */
async function batchGenerateImages(request, env) {
  const {
    prompts,  // 複数のプロンプト
    num_steps = 20
  } = await request.json();

  if (!prompts || !Array.isArray(prompts)) {
    return new Response(
      JSON.stringify({ error: "prompts array is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const results = [];

  for (const prompt of prompts) {
    try {
      const response = await env.AI.run(
        "@cf/stabilityai/stable-diffusion-xl-base-1.0",
        { prompt, num_steps }
      );

      // 画像をBase64エンコード
      const base64 = btoa(String.fromCharCode(...new Uint8Array(response)));

      results.push({
        prompt,
        image: `data:image/png;base64,${base64}`,
        success: true
      });
    } catch (error) {
      results.push({
        prompt,
        error: error.message,
        success: false
      });
    }
  }

  return new Response(
    JSON.stringify({
      results,
      total: prompts.length,
      succeeded: results.filter(r => r.success).length
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
 * 画像生成してR2に保存
 */
async function generateAndSaveImage(request, env) {
  const {
    prompt,
    filename,
    num_steps = 20
  } = await request.json();

  if (!prompt || !filename) {
    return new Response(
      JSON.stringify({ error: "prompt and filename are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // 画像生成
  const response = await env.AI.run(
    "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    { prompt, num_steps }
  );

  // R2に保存
  const key = `generated-images/${filename}`;

  if (env.R2_BUCKET) {
    await env.R2_BUCKET.put(key, response, {
      httpMetadata: {
        contentType: "image/png"
      },
      customMetadata: {
        prompt,
        generated_at: new Date().toISOString(),
        model: "stable-diffusion-xl-base-1.0"
      }
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      prompt,
      filename,
      r2_key: key,
      url: env.R2_PUBLIC_URL ? `${env.R2_PUBLIC_URL}/${key}` : null
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
