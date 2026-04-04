import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { embedAndStore, semanticSearch } from "./embeddings";
import type { Env } from "./types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

const INSIGHT_PROMPT = `You are a health data analyst. Given the following health metrics, generate a concise insight in Japanese (2-3 sentences). Focus on trends, anomalies, or noteworthy patterns.`;

export async function generateDailyInsight(env: Env): Promise<string | null> {
  const { results } = await env.DB.prepare(
    `SELECT day, sleep_score, activity_score, readiness_score, steps, total_calories
     FROM v_oura_daily_summary
     WHERE day = date('now', '-1 day')
     LIMIT 1`
  ).all<{
    day: string;
    sleep_score: number | null;
    activity_score: number | null;
    readiness_score: number | null;
    steps: number | null;
    total_calories: number | null;
  }>();

  if (!results.length) return null;

  const row = results[0];
  const workersai = createWorkersAI({ binding: env.AI });
  const { text: insight } = await generateText({
    model: workersai(MODEL_ID),
    system: INSIGHT_PROMPT,
    prompt: `日付: ${row.day}\n睡眠スコア: ${row.sleep_score}\n活動スコア: ${row.activity_score}\nコンディション: ${row.readiness_score}\n歩数: ${row.steps}\n消費カロリー: ${row.total_calories}`,
  });

  await embedAndStore(env.AI, env.VECTORIZE, env.DB, insight, "insight", {
    day: row.day,
    source: "daily_auto",
  });

  return insight;
}

export async function generateWeeklySummary(env: Env): Promise<string | null> {
  const { results } = await env.DB.prepare(
    `SELECT day, sleep_score, activity_score, readiness_score, steps, total_calories
     FROM v_oura_daily_summary
     WHERE day >= date('now', '-7 days')
     ORDER BY day`
  ).all<{
    day: string;
    sleep_score: number | null;
    activity_score: number | null;
    readiness_score: number | null;
    steps: number | null;
    total_calories: number | null;
  }>();

  if (!results.length) return null;

  const workersai = createWorkersAI({ binding: env.AI });
  const { text: summary } = await generateText({
    model: workersai(MODEL_ID),
    system: `You are a health data analyst. Given a week of health metrics, write a comprehensive weekly summary in Japanese (4-6 sentences). Include averages, best/worst days, and trends.`,
    prompt: `週間データ:\n${JSON.stringify(results, null, 2)}`,
  });

  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];
  const weekEnd = new Date(now.getTime() - 86400000).toISOString().split("T")[0];

  await embedAndStore(env.AI, env.VECTORIZE, env.DB, summary, "weekly_summary", {
    period_start: weekStart,
    period_end: weekEnd,
    source: "weekly_auto",
  });

  return summary;
}

export async function retrieveRelevantContext(
  env: Env,
  query: string,
  topK = 3
): Promise<string | null> {
  const results = await semanticSearch(env.AI, env.VECTORIZE, env.DB, query, topK);

  if (!results.length) return null;

  return results.map((r) => `[${r.contentType}] ${r.content}`).join("\n\n");
}
