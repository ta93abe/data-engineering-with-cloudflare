export async function listTables(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY name"
    )
    .all<{ name: string }>();
  return result.results.map((row) => row.name);
}

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export async function describeTable(db: D1Database, table: string): Promise<ColumnInfo[]> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  const result = await db.prepare(`PRAGMA table_info("${table}")`).all<ColumnInfo>();
  if (result.results.length === 0) {
    throw new Error(`Table not found: ${table}`);
  }
  return result.results;
}

export interface QueryResult {
  results: Record<string, unknown>[];
  meta: {
    changes: number;
    last_row_id: number;
    duration: number;
  };
}

const ALLOWED_VERBS = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "WITH", "EXPLAIN"]);

export async function queryD1(
  db: D1Database,
  sql: string,
  params?: unknown[]
): Promise<QueryResult> {
  const verb = sql.trimStart().split(/\s+/)[0]?.toUpperCase();
  if (!verb || !ALLOWED_VERBS.has(verb)) {
    throw new Error(
      `Unsupported SQL operation: ${verb ?? "(empty)"}. Allowed: ${[...ALLOWED_VERBS].join(", ")}`
    );
  }

  const stmt = db.prepare(sql);
  const bound = params && params.length > 0 ? stmt.bind(...params) : stmt;
  const result = await bound.all();
  return {
    results: result.results as Record<string, unknown>[],
    meta: {
      changes: result.meta?.changes ?? 0,
      last_row_id: result.meta?.last_row_id ?? 0,
      duration: result.meta?.duration ?? 0,
    },
  };
}
