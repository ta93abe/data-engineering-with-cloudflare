import type { Pipeline } from "cloudflare:pipelines";
import type { Env } from "./types";

const PAGE_SIZE = 10000;

const ALLOWED_TABLES = ["oura_daily_sleep", "oura_daily_activity", "oura_daily_readiness"] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

function isAllowedTable(table: string): table is AllowedTable {
  return (ALLOWED_TABLES as readonly string[]).includes(table);
}

async function getLastExportDate(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT last_sync_at FROM sync_state WHERE id = 'oura-export'")
    .first<{ last_sync_at: string | null }>();
  return row?.last_sync_at ?? null;
}

async function updateLastExportDate(db: D1Database, date: string): Promise<void> {
  await db
    .prepare("UPDATE sync_state SET last_sync_at = ? WHERE id = 'oura-export'")
    .bind(date)
    .run();
}

async function exportTable(
  db: D1Database,
  pipeline: Pipeline,
  table: string,
  lastExportDate: string | null
): Promise<number> {
  if (!isAllowedTable(table)) {
    throw new Error(`Table not allowed: ${table}`);
  }

  const sql = lastExportDate
    ? `SELECT * FROM ${table} WHERE day > ? ORDER BY day ASC`
    : `SELECT * FROM ${table} ORDER BY day ASC`;
  const result = lastExportDate
    ? await db.prepare(sql).bind(lastExportDate).all()
    : await db.prepare(sql).all();
  const rows = result.results;

  if (rows.length === 0) return 0;

  const loadedAt = new Date().toISOString();
  const enriched = rows.map((row) => ({ ...row, loaded_at: loadedAt }));
  await pipeline.send(enriched);
  return enriched.length;
}

async function exportHeartRate(
  db: D1Database,
  pipeline: Pipeline,
  lastExportDate: string | null
): Promise<number> {
  let totalSent = 0;
  let cursorDay = lastExportDate ?? "";
  let cursorTimestamp = "";

  while (true) {
    let result: D1Result<Record<string, unknown>>;

    if (cursorDay === "" && cursorTimestamp === "") {
      result = await db
        .prepare(`SELECT * FROM oura_heart_rate ORDER BY day ASC, timestamp ASC LIMIT ${PAGE_SIZE}`)
        .all();
    } else if (cursorTimestamp === "") {
      result = await db
        .prepare(
          `SELECT * FROM oura_heart_rate WHERE day > ? ORDER BY day ASC, timestamp ASC LIMIT ${PAGE_SIZE}`
        )
        .bind(cursorDay)
        .all();
    } else {
      result = await db
        .prepare(
          `SELECT * FROM oura_heart_rate WHERE (day > ?) OR (day = ? AND timestamp > ?) ORDER BY day ASC, timestamp ASC LIMIT ${PAGE_SIZE}`
        )
        .bind(cursorDay, cursorDay, cursorTimestamp)
        .all();
    }

    const rows = result.results;
    if (rows.length === 0) break;

    const loadedAt = new Date().toISOString();
    const enriched = rows.map((row) => ({ ...row, loaded_at: loadedAt }));
    await pipeline.send(enriched);
    totalSent += enriched.length;

    const lastRow = rows[rows.length - 1] as { day: string; timestamp: string };
    cursorDay = lastRow.day;
    cursorTimestamp = lastRow.timestamp;

    if (rows.length < PAGE_SIZE) break;
  }

  return totalSent;
}

export async function runExport(env: Env): Promise<string> {
  const lastExportDate = await getLastExportDate(env.DB);
  const logs: string[] = [];

  const sleepCount = await exportTable(
    env.DB,
    env.PIPELINE_SLEEP,
    "oura_daily_sleep",
    lastExportDate
  );
  logs.push(`daily_sleep: ${sleepCount} rows`);

  const activityCount = await exportTable(
    env.DB,
    env.PIPELINE_ACTIVITY,
    "oura_daily_activity",
    lastExportDate
  );
  logs.push(`daily_activity: ${activityCount} rows`);

  const readinessCount = await exportTable(
    env.DB,
    env.PIPELINE_READINESS,
    "oura_daily_readiness",
    lastExportDate
  );
  logs.push(`daily_readiness: ${readinessCount} rows`);

  const heartRateCount = await exportHeartRate(env.DB, env.PIPELINE_HEART_RATE, lastExportDate);
  logs.push(`heart_rate: ${heartRateCount} rows`);

  const today = new Date().toISOString().split("T")[0];
  await updateLastExportDate(env.DB, today);

  const summary = `Export complete: ${logs.join(", ")}`;
  console.log(summary);
  return summary;
}
