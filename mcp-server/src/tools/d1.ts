export async function listTables(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    )
    .all<{ name: string }>();
  return result.results.map((row) => row.name);
}
