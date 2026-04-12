import { Hono } from "hono";
import type { Env, R2SqlResponse } from "../types";
import { R2_SQL_ACCOUNT_ID, R2_SQL_WAREHOUSE } from "../types";

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

  const r2SqlUrl = `https://api.sql.cloudflarestorage.com/api/v1/accounts/${R2_SQL_ACCOUNT_ID}/r2-sql/query/${R2_SQL_WAREHOUSE}`;

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
    return c.json(
      {
        error: errorText,
        status: response.status,
        elapsed,
        engine: "r2sql",
      },
      response.status as 400 | 401 | 403 | 500
    );
  }

  const data = (await response.json()) as R2SqlResponse;
  return c.json({
    ...data,
    elapsed,
    engine: "r2sql",
  });
});

export default query;
