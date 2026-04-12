import { Hono } from "hono";
import type { Env, R2SqlResponse } from "../types";
import { R2_SQL_ACCOUNT_ID, R2_SQL_BUCKET_NAME } from "../types";

const catalog = new Hono<{ Bindings: Env }>();

async function executeR2Sql(token: string, sql: string): Promise<R2SqlResponse> {
  const r2SqlUrl = `https://api.sql.cloudflarestorage.com/api/v1/accounts/${R2_SQL_ACCOUNT_ID}/r2-sql/query/${R2_SQL_BUCKET_NAME}`;
  const response = await fetch(r2SqlUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) {
    throw new Error(`R2 SQL error: ${response.status}`);
  }
  return (await response.json()) as R2SqlResponse;
}

catalog.get("/tables", async (c) => {
  const token = await c.env.R2_SQL_TOKEN.get();
  if (!token) {
    return c.json({ error: "R2 SQL token not configured" }, 500);
  }

  const namespaces = await executeR2Sql(token, "SHOW NAMESPACES");
  const tables: { namespace: string; table: string }[] = [];

  for (const ns of namespaces.result?.rows ?? []) {
    const nsName = Object.values(ns)[0] as string;
    const tblResult = await executeR2Sql(token, `SHOW TABLES IN ${nsName}`);
    for (const tbl of tblResult.result?.rows ?? []) {
      tables.push({
        namespace: nsName,
        table: Object.values(tbl)[0] as string,
      });
    }
  }

  return c.json({ tables });
});

catalog.get("/describe/:namespace/:table", async (c) => {
  const { namespace, table } = c.req.param();
  const token = await c.env.R2_SQL_TOKEN.get();
  if (!token) {
    return c.json({ error: "R2 SQL token not configured" }, 500);
  }

  const raw = await executeR2Sql(token, `DESCRIBE ${namespace}.${table}`);
  return c.json({ data: raw.result?.rows ?? [] });
});

export default catalog;
