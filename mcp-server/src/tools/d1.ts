export async function listTables(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
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
  const result = await db.prepare(`PRAGMA table_info(${table})`).all<ColumnInfo>();
  if (result.results.length === 0) {
    throw new Error(`Table not found: ${table}`);
  }
  return result.results;
}
