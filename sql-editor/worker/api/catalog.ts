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

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

class InvalidIdentifierError extends Error {
  constructor(id: string) {
    super(`Invalid identifier: ${id}`);
    this.name = "InvalidIdentifierError";
  }
}

function assertIdentifier(id: string): string {
  if (!IDENTIFIER_PATTERN.test(id)) {
    throw new InvalidIdentifierError(id);
  }
  return id;
}

catalog.get("/tables", async (c) => {
  const token = await c.env.R2_SQL_TOKEN.get();
  if (!token) {
    return c.json({ error: "R2 SQL token not configured" }, 500);
  }

  try {
    const namespaces = await executeR2Sql(token, "SHOW NAMESPACES");

    const tables = (
      await Promise.all(
        (namespaces.result?.rows ?? []).map(async (ns) => {
          const nsName = Object.values(ns)[0] as string;
          const tblResult = await executeR2Sql(token, `SHOW TABLES IN ${assertIdentifier(nsName)}`);
          return (tblResult.result?.rows ?? []).map((tbl) => ({
            namespace: nsName,
            table: Object.values(tbl)[0] as string,
          }));
        })
      )
    ).flat();

    return c.json({ tables });
  } catch (err) {
    if (err instanceof InvalidIdentifierError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
});

catalog.get("/describe/:namespace/:table", async (c) => {
  const { namespace, table } = c.req.param();
  const token = await c.env.R2_SQL_TOKEN.get();
  if (!token) {
    return c.json({ error: "R2 SQL token not configured" }, 500);
  }

  try {
    const raw = await executeR2Sql(
      token,
      `DESCRIBE ${assertIdentifier(namespace)}.${assertIdentifier(table)}`
    );
    return c.json({ data: raw.result?.rows ?? [] });
  } catch (err) {
    if (err instanceof InvalidIdentifierError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
});

export default catalog;
