import { tool } from "ai";
import { z } from "zod";
import { embedAndStore, semanticSearch } from "./embeddings";
import { generateHealthReport, listReports as queryReports } from "./reports";
import { D1_SCHEMA } from "./schema";
import type { Env } from "./types";
import { isSafeQuery } from "./utils";

export const SYSTEM_PROMPT = `You are a health data assistant with access to a knowledge base and analytics tools. You MUST use tools to answer every user question. Never refuse. Never say you cannot help.

Tool routing:
- Trends, patterns, or past insights → semanticSearch
- Reports → generateReport / listReports / readReport
- Raw data queries (sleep, activity, readiness, heart rate) → queryD1
- Saving analysis results → saveInsight

Database schema (SQLite):
${D1_SCHEMA}

SQL hints:
- "yesterday" = date('now', '-1 day')
- "this week" = day >= date('now', '-7 days')
- "this month" = strftime('%Y-%m', day) = strftime('%Y-%m', 'now')
- Prefer v_oura_daily_summary view (has sleep_score, activity_score, readiness_score, steps, total_calories)
- Always add LIMIT 30 for large queries

Rules:
- ALWAYS call a tool. Do not respond without using a tool first.
- Only SELECT/WITH queries allowed for queryD1.
- Respond in Japanese.
- Summarize results concisely.
`;

export function createTools(env: Env) {
  const { DB: db, AI: ai, VECTORIZE: vectorize, DATA_LAKE: dataLake } = env;

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

    semanticSearch: tool({
      description:
        "自然言語クエリで知識ベースを意味検索する。過去のインサイト、週次サマリー、パターンを検索できる。",
      inputSchema: z.object({
        query: z.string().describe("検索クエリ（自然言語）"),
        topK: z.number().optional().describe("返す結果数 (デフォルト: 5)"),
      }),
      execute: async ({ query, topK }) => {
        const results = await semanticSearch(ai, vectorize, db, query, topK ?? 5);
        if (!results.length) {
          return {
            success: true,
            message: "関連するインサイトが見つかりませんでした。",
            results: [],
          };
        }
        return {
          success: true,
          resultCount: results.length,
          results: results.map((r) => ({
            contentType: r.contentType,
            content: r.content,
            score: Math.round(r.score * 100) / 100,
          })),
        };
      },
    }),

    generateReport: tool({
      description: "指定期間の健康データレポートを生成してR2に保存する。",
      inputSchema: z.object({
        type: z.enum(["weekly_health", "monthly_health", "custom"]).describe("レポートタイプ"),
        periodStart: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD 形式で指定してください。")
          .describe("開始日 (YYYY-MM-DD)"),
        periodEnd: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD 形式で指定してください。")
          .describe("終了日 (YYYY-MM-DD)"),
      }),
      execute: async ({ type, periodStart, periodEnd }) => {
        try {
          const report = await generateHealthReport(env, type, periodStart, periodEnd);
          return {
            success: true,
            reportId: report.id,
            title: report.title,
            r2Key: report.r2Key,
            summary: report.summary,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),

    listReports: tool({
      description: "生成済みレポートの一覧を取得する。",
      inputSchema: z.object({
        type: z
          .enum(["weekly_health", "monthly_health", "custom"])
          .optional()
          .describe("レポートタイプ"),
        limit: z.number().optional().describe("取得件数 (デフォルト: 10)"),
      }),
      execute: async ({ type, limit }) => {
        return await queryReports(db, type, limit ?? 10);
      },
    }),

    readReport: tool({
      description: "R2に保存されたレポートの全文を取得する。",
      inputSchema: z.object({
        reportId: z.string().describe("レポートID"),
      }),
      execute: async ({ reportId }) => {
        const row = await db
          .prepare("SELECT r2_key, title FROM agent_reports WHERE id = ?")
          .bind(reportId)
          .first<{ r2_key: string; title: string }>();

        if (!row) {
          return { success: false, error: "レポートが見つかりません。" };
        }

        if (!row.r2_key) {
          return { success: false, error: "レポートのR2キーが設定されていません。" };
        }

        const obj = await dataLake.get(row.r2_key);
        if (!obj) {
          return { success: false, error: "R2からレポートを取得できませんでした。" };
        }

        const content = await obj.text();
        return { success: true, title: row.title, content };
      },
    }),

    saveInsight: tool({
      description:
        "データ分析から得られたインサイトを知識ベースに保存・埋め込みする。ユーザーのリクエストではなく、分析結果の要約保存にのみ使用すること。",
      inputSchema: z.object({
        content: z
          .string()
          .max(2000, "インサイトは2000文字以内にしてください。")
          .describe("インサイトの内容"),
        contentType: z.enum(["insight", "pattern"]).describe("種別"),
        metadata: z.record(z.string(), z.string()).optional().describe("メタデータ (任意)"),
      }),
      execute: async ({ content, contentType, metadata }) => {
        try {
          const id = await embedAndStore(ai, vectorize, db, content, contentType, metadata);
          return { success: true, id, message: "インサイトを保存しました。" };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),

    listDataLakeFiles: tool({
      description:
        "R2データレイクのファイル一覧を取得する。Parquetファイルやレポートの確認に使う。",
      inputSchema: z.object({
        prefix: z.string().optional().describe("プレフィックス (例: 'oura/', 'reports/')"),
        limit: z.number().optional().describe("取得件数 (デフォルト: 20)"),
      }),
      execute: async ({ prefix, limit }) => {
        const listed = await dataLake.list({ prefix: prefix ?? undefined, limit: limit ?? 20 });
        return {
          objectCount: listed.objects.length,
          truncated: listed.truncated,
          objects: listed.objects.map((o) => ({
            key: o.key,
            size: o.size,
            uploaded: o.uploaded.toISOString(),
          })),
        };
      },
    }),
  };
}
