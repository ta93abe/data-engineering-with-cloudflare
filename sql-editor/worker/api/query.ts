import { Hono } from "hono";
import type { Env, R2SqlResponse } from "../types";
import { R2_SQL_ACCOUNT_ID, R2_SQL_BUCKET_NAME } from "../types";

const query = new Hono<{ Bindings: Env }>();

query.post("/", async (c) => {
  const body = await c.req.json<{ query: string }>();
  if (!body.query) {
    return c.json({ error: "Query is required" }, 400);
  }

  const token = await c.env.R2_SQL_TOKEN.get();
  if (!token) {
    return c.json({ error: "R2 SQL token not configured" }, 500);
  }

  const r2SqlUrl = `https://api.sql.cloudflarestorage.com/api/v1/accounts/${R2_SQL_ACCOUNT_ID}/r2-sql/query/${R2_SQL_BUCKET_NAME}`;

  const startTime = Date.now();

  const response = await fetch(r2SqlUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: body.query }),
  });

  const elapsed = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text();
    c.env.QUERY_ANALYTICS.writeDataPoint({
      indexes: [sqlKeyword(body.query)],
      blobs: [body.query, "error", errorText.slice(0, 256)],
      doubles: [elapsed, 0],
    });
    return c.json(
      { error: errorText, status: response.status, elapsed, engine: "r2sql" },
      response.status as 400 | 401 | 403 | 500
    );
  }

  const raw = (await response.json()) as R2SqlResponse;

  if (!raw.success) {
    const errorMsg = raw.errors.map((e) => e.message).join("; ");
    c.env.QUERY_ANALYTICS.writeDataPoint({
      indexes: [sqlKeyword(body.query)],
      blobs: [body.query, "error", errorMsg.slice(0, 256)],
      doubles: [elapsed, 0],
    });
    return c.json({ error: errorMsg, elapsed, engine: "r2sql" });
  }

  const rowCount = raw.result?.rows?.length ?? 0;
  c.env.QUERY_ANALYTICS.writeDataPoint({
    indexes: [sqlKeyword(body.query)],
    blobs: [body.query, "ok"],
    doubles: [elapsed, rowCount],
  });

  return c.json({
    data: raw.result?.rows ?? [],
    elapsed,
    engine: "r2sql",
  });
});

function sqlKeyword(sql: string): string {
  const match = sql.trimStart().match(/^\w+/);
  return match ? match[0].toUpperCase() : "UNKNOWN";
}

export default query;
