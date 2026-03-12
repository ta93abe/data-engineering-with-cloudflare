import { routeAgentRequest } from "agents";
import { handleSlackEvent } from "./slack";
import type { Env } from "./types";

export { DataAgent } from "./agent";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK");
    }

    // Slack Events API
    if (url.pathname === "/slack/events" && request.method === "POST") {
      // Pass waitUntil so Slack handler can process AI response in background
      globalThis.__SLACK_WAIT_UNTIL = (p: Promise<unknown>) => ctx.waitUntil(p);
      return handleSlackEvent(request, env);
    }

    // Agent WebSocket routing
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    return new Response("Not Found", { status: 404 });
  },
};
