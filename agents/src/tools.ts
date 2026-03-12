import { tool } from "ai";
import { z } from "zod";
import { D1_SCHEMA } from "./schema";
import { isSafeQuery } from "./utils";

export const SYSTEM_PROMPT = `You are a health data assistant. You MUST use the queryD1 tool to answer every user question. Never refuse. Never say you cannot help.

When the user asks about sleep, activity, readiness, or heart rate, generate a SQL SELECT query and call queryD1.

Database schema (SQLite):
${D1_SCHEMA}

SQL hints:
- "yesterday" = date('now', '-1 day')
- "this week" = day >= date('now', '-7 days')
- "this month" = strftime('%Y-%m', day) = strftime('%Y-%m', 'now')
- Prefer v_oura_daily_summary view (has sleep_score, activity_score, readiness_score, steps, total_calories)
- Always add LIMIT 30 for large queries

Example: If user asks "昨日の睡眠スコア", call queryD1 with:
  sql: "SELECT day, sleep_score FROM v_oura_daily_summary WHERE day = date('now', '-1 day')"

Rules:
- ALWAYS call queryD1 tool. Do not respond without querying data first.
- Only SELECT/WITH queries allowed.
- Respond in Japanese.
- Summarize results concisely.
`;

export function createTools(db: D1Database) {
  return {
    queryD1: tool({
      description:
        "SQLite (D1) データベースに SELECT クエリを実行してデータを取得する。ユーザーの質問に回答するために必ずこのツールを使うこと。",
      inputSchema: z.object({
        sql: z.string().describe("実行するSELECTクエリ"),
        params: z.array(z.string()).optional().describe("バインドパラメータ"),
      }),
      execute: async ({ sql, params }) => {
        if (!isSafeQuery(sql)) {
          return { success: false, error: "SELECT/WITH クエリのみ実行可能です。" };
        }
        try {
          const stmt = db.prepare(sql);
          const bound = params?.length ? stmt.bind(...params) : stmt;
          const queryResult = await bound.all();

          return {
            success: true,
            rowCount: queryResult.results.length,
            results: queryResult.results.slice(0, 50),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),
    listTables: tool({
      description: "D1データベースの全テーブルとビューの一覧を取得する",
      inputSchema: z.object({}),
      execute: async () => {
        const queryResult = await db
          .prepare(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY type, name"
          )
          .all();
        return queryResult.results;
      },
    }),
  };
}
