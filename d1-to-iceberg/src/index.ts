import { runExport } from "./export";
import type { Env } from "./types";

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runExport(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK");
    }

    // 手動トリガー用 (デバッグ)
    if (url.pathname === "/export" && request.method === "POST") {
      const result = await runExport(env);
      return new Response(result);
    }

    return new Response("Not Found", { status: 404 });
  },
};
