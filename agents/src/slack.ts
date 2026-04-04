import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { retrieveRelevantContext } from "./knowledge";
import { D1_SCHEMA } from "./schema";
import type { Env } from "./types";
import { isSafeQuery } from "./utils";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

const SQL_GEN_PROMPT = `You are a SQL generator for a SQLite (D1) database containing Oura Ring health data.
Given a user question, output ONLY a valid SELECT SQL query. No explanation, no markdown, no backticks. Just the raw SQL.

Database schema:
${D1_SCHEMA}

SQL hints:
- "yesterday" = date('now', '-1 day')
- "this week" = day >= date('now', '-7 days')
- "this month" = strftime('%Y-%m', day) = strftime('%Y-%m', 'now')
- Prefer v_oura_daily_summary view
- Always add LIMIT 30
- Date columns are TEXT (YYYY-MM-DD format)

Output ONLY the SQL query. Nothing else.`;

const SUMMARIZE_PROMPT = `You are a health data assistant. Given the user's question and query results from an Oura Ring database, provide a concise answer in Japanese.
If no data is returned, say "データが見つかりませんでした。"
Keep the answer short and helpful.`;

type SlackEvent =
  | { type: "url_verification"; challenge: string }
  | {
      type: "event_callback";
      event: {
        type: string;
        text?: string;
        user?: string;
        channel?: string;
        bot_id?: string;
        ts?: string;
        thread_ts?: string;
      };
    };

async function verifySlackSignature(
  request: Request,
  body: string,
  signingSecret: string
): Promise<boolean> {
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const baseString = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return signature === `v0=${hex}`;
}

async function postSlackMessage(token: string, channel: string, text: string, threadTs?: string) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
  });

  if (!response.ok) {
    console.error("Slack API HTTP error:", response.status, response.statusText);
  } else {
    const result = (await response.json()) as { ok: boolean; error?: string };
    if (!result.ok) {
      console.error("Slack API error:", result.error);
    }
  }
}

function extractSql(raw: string): string {
  // Strip markdown code blocks if present
  let sql = raw
    .replace(/```sql\n?/gi, "")
    .replace(/```\n?/g, "")
    .trim();
  // Take only first statement
  const semicolonIdx = sql.indexOf(";");
  if (semicolonIdx > 0) {
    sql = sql.substring(0, semicolonIdx + 1);
  }
  return sql;
}

export async function handleSlackEvent(request: Request, env: Env): Promise<Response> {
  const body = await request.text();

  if (!(await verifySlackSignature(request, body, env.SLACK_SIGNING_SECRET))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event: SlackEvent = JSON.parse(body);

  // Slack URL verification challenge
  if (event.type === "url_verification") {
    return new Response(event.challenge, { headers: { "Content-Type": "text/plain" } });
  }

  if (event.type !== "event_callback") {
    return new Response("OK");
  }

  const { event: slackEvent } = event;

  // Ignore bot messages to avoid loops
  if (slackEvent.bot_id || slackEvent.type !== "app_mention") {
    return new Response("OK");
  }

  const userText = slackEvent.text?.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!userText || !slackEvent.channel) {
    return new Response("OK");
  }

  const channel = slackEvent.channel;
  const threadTs = slackEvent.thread_ts ?? slackEvent.ts;

  const promise = (async () => {
    try {
      const workersai = createWorkersAI({ binding: env.AI });

      // Step 1: Generate SQL from user question
      const { text: rawSql } = await generateText({
        model: workersai(MODEL_ID),
        system: SQL_GEN_PROMPT,
        prompt: userText,
      });

      const sql = extractSql(rawSql);

      if (!isSafeQuery(sql)) {
        await postSlackMessage(
          env.SLACK_BOT_TOKEN,
          channel,
          "SELECT クエリのみ実行可能です。",
          threadTs
        );
        return;
      }

      // Step 2: Execute SQL
      const queryResult = await env.DB.prepare(sql).all();
      const rows = queryResult.results.slice(0, 50);

      // Step 2.5: Retrieve relevant context from knowledge base for RAG
      const ragResults = await retrieveRelevantContext(env, userText, 2);
      const contextBlock = ragResults ? `\n\n関連する過去のインサイト:\n${ragResults}` : "";

      // Step 3: Summarize results with RAG context (truncate to avoid exceeding model context limits)
      const rowsPreview =
        rows.length > 10 ? [...rows.slice(0, 10), `... and ${rows.length - 10} more rows`] : rows;
      const { text: answer } = await generateText({
        model: workersai(MODEL_ID),
        system: SUMMARIZE_PROMPT + contextBlock,
        prompt: `ユーザーの質問: ${userText}\n\n実行したSQL: ${sql}\n\nクエリ結果 (${queryResult.results.length}件):\n${JSON.stringify(rowsPreview, null, 2)}`,
      });

      const message = `${answer}\n\n\`\`\`${sql}\`\`\``;
      await postSlackMessage(env.SLACK_BOT_TOKEN, channel, message, threadTs);
    } catch (error) {
      console.error("Slack handler error:", error);
      await postSlackMessage(
        env.SLACK_BOT_TOKEN,
        channel,
        `エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
        threadTs
      );
    }
  })();

  globalThis.__SLACK_WAIT_UNTIL?.(promise);

  return new Response("OK");
}
