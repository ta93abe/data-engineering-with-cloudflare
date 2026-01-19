/**
 * Streamlit Dashboard - Cloudflare Containers Worker
 *
 * StreamlitコンテナへのリクエストをプロキシするWorker
 */

import { Container, getContainer } from "@cloudflare/containers";

/**
 * Streamlitコンテナクラス
 */
export class StreamlitContainer extends Container {
  // Streamlitのデフォルトポート
  defaultPort = 8501;

  // アイドル時間後にコンテナを停止（コスト最適化）
  // Streamlitはインタラクティブなので、少し長めに設定
  sleepAfter = "15m";

  /**
   * コンテナ起動時の処理
   */
  async onStart() {
    // R2バケットをFUSEマウント
    await this.mountR2("/data", this.env.DATA_LAKE);
  }
}

interface Env {
  StreamlitContainer: DurableObjectNamespace<StreamlitContainer>;
  DATA_LAKE: R2Bucket;
  ANALYTICS: AnalyticsEngineDataset;
  STREAMLIT_ENV: string;
  API_KEY_SECRET?: string;
}

/**
 * 構造化ログ出力
 */
function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown>
) {
  console.log(
    JSON.stringify({
      level,
      service: "streamlit-dashboard",
      event,
      timestamp: new Date().toISOString(),
      ...details,
    })
  );
}

/**
 * メトリクス記録
 */
function recordMetric(
  env: Env,
  event: string,
  details: { path?: string; status?: number; duration?: number }
) {
  env.ANALYTICS.writeDataPoint({
    blobs: [event, details.path ?? "/"],
    doubles: [details.status ?? 0, details.duration ?? 0],
    indexes: [new Date().toISOString()],
  });
}

export default {
  /**
   * HTTPリクエストハンドラー
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const startTime = Date.now();

    // ヘルスチェックエンドポイント（認証不要）
    if (url.pathname === "/health" || url.pathname === "/_health") {
      return Response.json({
        status: "healthy",
        env: env.STREAMLIT_ENV,
        timestamp: new Date().toISOString(),
      });
    }

    // オプション: API認証（Cloudflare Accessと併用推奨）
    // Cloudflare Accessを使用する場合は、このブロックはスキップ可能
    if (env.API_KEY_SECRET) {
      const apiKey = request.headers.get("X-API-KEY");
      if (apiKey !== env.API_KEY_SECRET) {
        // Cloudflare Accessのヘッダーがない場合のみ認証エラー
        const cfAccessJWT = request.headers.get("Cf-Access-Jwt-Assertion");
        if (!cfAccessJWT) {
          logEvent("warn", "unauthorized_access", {
            path: url.pathname,
            ip: request.headers.get("CF-Connecting-IP"),
          });
          return new Response("Unauthorized", { status: 401 });
        }
      }
    }

    logEvent("info", "request_received", {
      method: request.method,
      path: url.pathname,
    });

    try {
      // Streamlitコンテナを取得
      const container = getContainer(env.StreamlitContainer, "streamlit");

      // リクエストをコンテナにプロキシ
      const response = await container.fetch(request);

      const duration = Date.now() - startTime;

      // メトリクス記録
      recordMetric(env, "request_completed", {
        path: url.pathname,
        status: response.status,
        duration,
      });

      logEvent("info", "request_completed", {
        path: url.pathname,
        status: response.status,
        duration,
      });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logEvent("error", "request_failed", {
        path: url.pathname,
        error: errorMessage,
        duration,
      });

      recordMetric(env, "request_error", {
        path: url.pathname,
        status: 500,
        duration,
      });

      return Response.json(
        {
          error: "Internal Server Error",
          message:
            env.STREAMLIT_ENV === "staging" ? errorMessage : "An error occurred",
        },
        { status: 500 }
      );
    }
  },
};
