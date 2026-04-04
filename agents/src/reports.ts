import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { embedAndStore } from "./embeddings";
import type { Env } from "./types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

const REPORT_PROMPT = `You are a health data analyst. Generate a detailed health report in Japanese Markdown format.
Include:
- 概要 (1-2 sentences summary)
- 睡眠分析 (scores, trends, best/worst days)
- 活動分析 (steps, calories, activity scores)
- コンディション分析 (readiness scores, temperature)
- まとめと改善提案

Use headers (##), bullet points, and bold for emphasis.`;

export type ReportResult = {
  id: string;
  title: string;
  r2Key: string;
  summary: string;
};

export async function generateHealthReport(
  env: Env,
  type: string,
  periodStart: string,
  periodEnd: string
): Promise<ReportResult> {
  const { results } = await env.DB.prepare(
    `SELECT day, sleep_score, activity_score, readiness_score,
            steps, total_calories, active_calories, temperature_deviation,
            sleep_deep_sleep, sleep_efficiency, sleep_total_sleep
     FROM v_oura_daily_summary
     WHERE day >= ? AND day <= ?
     ORDER BY day`
  )
    .bind(periodStart, periodEnd)
    .all();

  if (!results.length) {
    throw new Error(`期間 ${periodStart} ~ ${periodEnd} のデータが見つかりません。`);
  }

  const workersai = createWorkersAI({ binding: env.AI });

  // Generate full report
  const { text: reportContent } = await generateText({
    model: workersai(MODEL_ID),
    system: REPORT_PROMPT,
    prompt: `期間: ${periodStart} ~ ${periodEnd}\nデータ件数: ${results.length}日分\n\nデータ:\n${JSON.stringify(results, null, 2)}`,
  });

  // Generate concise summary for embedding
  const { text: summary } = await generateText({
    model: workersai(MODEL_ID),
    system: "Summarize the following health report in 2-3 sentences in Japanese.",
    prompt: reportContent,
  });

  const id = crypto.randomUUID();
  const r2Key = `reports/${type}/${periodStart}_${periodEnd}.md`;
  const title = `${type === "weekly_health" ? "週次" : type === "monthly_health" ? "月次" : "カスタム"}ヘルスレポート (${periodStart} ~ ${periodEnd})`;

  // Store full report in R2
  await env.DATA_LAKE.put(r2Key, reportContent, {
    customMetadata: { report_id: id, type, period_start: periodStart, period_end: periodEnd },
  });

  // Embed summary in Vectorize
  const vectorId = await embedAndStore(env.AI, env.VECTORIZE, env.DB, summary, "report", {
    report_id: id,
    period_start: periodStart,
    period_end: periodEnd,
  });

  // Store metadata in D1
  await env.DB.prepare(
    `INSERT INTO agent_reports (id, report_type, title, period_start, period_end, r2_key, summary, vector_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, type, title, periodStart, periodEnd, r2Key, summary, vectorId)
    .run();

  return { id, title, r2Key, summary };
}

export async function listReports(
  db: D1Database,
  type?: string,
  limit = 10
): Promise<{ results: unknown[] }> {
  const query = type
    ? "SELECT id, report_type, title, period_start, period_end, summary, created_at FROM agent_reports WHERE report_type = ? ORDER BY created_at DESC LIMIT ?"
    : "SELECT id, report_type, title, period_start, period_end, summary, created_at FROM agent_reports ORDER BY created_at DESC LIMIT ?";

  const stmt = type ? db.prepare(query).bind(type, limit) : db.prepare(query).bind(limit);
  const result = await stmt.all();
  return { results: result.results };
}
