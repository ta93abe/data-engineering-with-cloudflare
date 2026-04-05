import { routeAgentRequest } from "agents";
import { generateDailyInsight, generateWeeklySummary } from "./knowledge";
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

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Daily: generate insight from yesterday's health data
    ctx.waitUntil(
      generateDailyInsight(env)
        .then((insight) => {
          if (insight) {
            console.log("Daily insight generated successfully");
          }
        })
        .catch((error) => {
          console.error("Failed to generate daily insight:", error);
        })
    );

    // Weekly (Monday): generate weekly summary
    const today = new Date();
    if (today.getUTCDay() === 1) {
      ctx.waitUntil(
        generateWeeklySummary(env)
          .then((summary) => {
            if (summary) {
              console.log("Weekly summary generated successfully");
            }
          })
          .catch((error) => {
            console.error("Failed to generate weekly summary:", error);
          })
      );
    }
  },
};
