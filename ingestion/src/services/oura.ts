import { Hono } from "hono";
import type { Env, SyncResult } from "../types";
import {
  type DailyActivityRow,
  type DailyReadinessRow,
  type DailySleepRow,
  encodeDailyActivity,
  encodeDailyReadiness,
  encodeDailySleep,
  encodeHeartRate,
  type HeartRateRow,
} from "./parquet";

const app = new Hono<{ Bindings: Env }>();

const OURA_AUTH_URL = "https://cloud.ouraring.com/oauth/authorize";
const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
const OURA_API_BASE = "https://api.ouraring.com";

// ============================================
// Types
// ============================================

interface OuraTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

interface OuraResponse<T> {
  data: T[];
  next_token?: string;
}

interface OuraDailySleep {
  id: string;
  day: string;
  score: number | null;
  timestamp: string;
  contributors?: {
    deep_sleep?: number | null;
    efficiency?: number | null;
    latency?: number | null;
    rem_sleep?: number | null;
    restfulness?: number | null;
    timing?: number | null;
    total_sleep?: number | null;
  };
}

interface OuraDailyActivity {
  id: string;
  day: string;
  score: number | null;
  active_calories: number;
  total_calories: number;
  steps: number;
  equivalent_walking_distance: number;
  high_activity_time: number;
  medium_activity_time: number;
  low_activity_time: number;
  sedentary_time: number;
  resting_time: number;
  average_met_minutes?: number;
  contributors?: {
    meet_daily_targets?: number | null;
    move_every_hour?: number | null;
    recovery_time?: number | null;
    stay_active?: number | null;
    training_frequency?: number | null;
    training_volume?: number | null;
  };
  timestamp: string;
}

interface OuraDailyReadiness {
  id: string;
  day: string;
  score: number | null;
  temperature_deviation: number | null;
  temperature_trend_deviation: number | null;
  timestamp: string;
  contributors?: {
    activity_balance?: number | null;
    body_temperature?: number | null;
    hrv_balance?: number | null;
    previous_day_activity?: number | null;
    previous_night?: number | null;
    recovery_index?: number | null;
    resting_heart_rate?: number | null;
    sleep_balance?: number | null;
  };
}

interface OuraHeartRate {
  bpm: number;
  source: string;
  timestamp: string;
}

// ============================================
// OAuth2
// ============================================

async function getValidToken(db: D1Database, env: Env): Promise<string> {
  const row = await db
    .prepare("SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE id = 'oura'")
    .first<{ access_token: string; refresh_token: string; expires_at: string }>();

  if (!row) {
    throw new Error("Oura not authenticated. Visit /oura/auth to connect.");
  }

  const now = new Date();
  const expiresAt = new Date(row.expires_at);

  if (now < expiresAt) {
    return row.access_token;
  }

  // Refresh token
  const res = await fetch(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
      client_id: env.OURA_CLIENT_ID,
      client_secret: env.OURA_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Oura token refresh failed: ${res.status} ${text}`);
  }

  const token: OuraTokenResponse = await res.json();
  const newExpiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

  await db
    .prepare(
      `UPDATE oauth_tokens SET
        access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
       WHERE id = 'oura'`
    )
    .bind(token.access_token, token.refresh_token, newExpiresAt)
    .run();

  return token.access_token;
}

// ============================================
// API Client
// ============================================

async function fetchOura<T>(
  path: string,
  token: string,
  params?: Record<string, string>
): Promise<OuraResponse<T>> {
  const url = new URL(`${OURA_API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "ingestion-worker",
    },
  });

  if (res.status === 429) {
    throw new Error("Oura API rate limit exceeded");
  }
  if (res.status === 401) {
    throw new Error("Oura API unauthorized - token may be expired");
  }
  if (!res.ok) {
    const body = await res.text();
    const truncated = body.length > 500 ? `${body.slice(0, 500)}...(truncated)` : body;
    throw new Error(`Oura API error: ${res.status} - ${truncated || "no response body"}`);
  }

  return res.json();
}

async function fetchAllPages<T>(
  path: string,
  token: string,
  params: Record<string, string>
): Promise<T[]> {
  const allData: T[] = [];
  let nextToken: string | undefined;

  do {
    const reqParams = { ...params };
    if (nextToken) {
      reqParams.next_token = nextToken;
    }

    const response = await fetchOura<T>(path, token, reqParams);
    allData.push(...response.data);
    nextToken = response.next_token;
  } while (nextToken);

  return allData;
}

// ============================================
// Chunking & Grouping Utilities
// ============================================

function splitIntoMonthlyChunks(
  startDate: string,
  endDate: string
): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (current <= end) {
    const chunkEnd = new Date(current);
    chunkEnd.setUTCMonth(chunkEnd.getUTCMonth() + 1);
    chunkEnd.setUTCDate(0); // last day of current month
    const effectiveEnd = chunkEnd > end ? end : chunkEnd;
    chunks.push({
      start: current.toISOString().split("T")[0],
      end: effectiveEnd.toISOString().split("T")[0],
    });
    current = new Date(effectiveEnd);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return chunks;
}

function groupByDay<T>(items: T[], getDayFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const day = getDayFn(item);
    const arr = map.get(day) ?? [];
    arr.push(item);
    map.set(day, arr);
  }
  return map;
}

async function writeParquetToR2(
  r2: R2Bucket,
  tableName: string,
  day: string,
  data: Uint8Array
): Promise<void> {
  const key = `oura/${tableName}/${day}.parquet`;
  await r2.put(key, data);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// Sync Functions (R2 Parquet)
// ============================================

async function syncDailySleep(
  r2: R2Bucket,
  encoder: Fetcher,
  token: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const data = await fetchAllPages<OuraDailySleep>("/v2/usercollection/daily_sleep", token, {
    start_date: startDate,
    end_date: endDate,
  });

  if (data.length === 0) return 0;

  const synced_at = new Date().toISOString();
  const grouped = groupByDay(data, (item) => item.day);

  for (const [day, items] of grouped) {
    const rows: DailySleepRow[] = items.map((item) => ({
      day: item.day,
      score: item.score ?? null,
      deep_sleep: item.contributors?.deep_sleep ?? null,
      efficiency: item.contributors?.efficiency ?? null,
      latency: item.contributors?.latency ?? null,
      rem_sleep: item.contributors?.rem_sleep ?? null,
      restfulness: item.contributors?.restfulness ?? null,
      timing: item.contributors?.timing ?? null,
      total_sleep: item.contributors?.total_sleep ?? null,
      timestamp: item.timestamp,
      synced_at,
    }));
    const parquet = await encodeDailySleep(encoder, rows);
    await writeParquetToR2(r2, "daily_sleep", day, parquet);
  }

  return data.length;
}

async function syncDailyActivity(
  r2: R2Bucket,
  encoder: Fetcher,
  token: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const data = await fetchAllPages<OuraDailyActivity>("/v2/usercollection/daily_activity", token, {
    start_date: startDate,
    end_date: endDate,
  });

  if (data.length === 0) return 0;

  const synced_at = new Date().toISOString();
  const grouped = groupByDay(data, (item) => item.day);

  for (const [day, items] of grouped) {
    const rows: DailyActivityRow[] = items.map((item) => ({
      day: item.day,
      score: item.score ?? null,
      active_calories: item.active_calories,
      total_calories: item.total_calories,
      steps: item.steps,
      equivalent_walking_distance: item.equivalent_walking_distance,
      high_activity_time: item.high_activity_time,
      medium_activity_time: item.medium_activity_time,
      low_activity_time: item.low_activity_time,
      sedentary_time: item.sedentary_time,
      resting_time: item.resting_time,
      met_average: item.average_met_minutes ?? null,
      meet_daily_targets: item.contributors?.meet_daily_targets ?? null,
      move_every_hour: item.contributors?.move_every_hour ?? null,
      recovery_time: item.contributors?.recovery_time ?? null,
      stay_active: item.contributors?.stay_active ?? null,
      training_frequency: item.contributors?.training_frequency ?? null,
      training_volume: item.contributors?.training_volume ?? null,
      timestamp: item.timestamp,
      synced_at,
    }));
    const parquet = await encodeDailyActivity(encoder, rows);
    await writeParquetToR2(r2, "daily_activity", day, parquet);
  }

  return data.length;
}

async function syncDailyReadiness(
  r2: R2Bucket,
  encoder: Fetcher,
  token: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const data = await fetchAllPages<OuraDailyReadiness>(
    "/v2/usercollection/daily_readiness",
    token,
    { start_date: startDate, end_date: endDate }
  );

  if (data.length === 0) return 0;

  const synced_at = new Date().toISOString();
  const grouped = groupByDay(data, (item) => item.day);

  for (const [day, items] of grouped) {
    const rows: DailyReadinessRow[] = items.map((item) => ({
      day: item.day,
      score: item.score ?? null,
      temperature_deviation: item.temperature_deviation ?? null,
      temperature_trend_deviation: item.temperature_trend_deviation ?? null,
      activity_balance: item.contributors?.activity_balance ?? null,
      body_temperature: item.contributors?.body_temperature ?? null,
      hrv_balance: item.contributors?.hrv_balance ?? null,
      previous_day_activity: item.contributors?.previous_day_activity ?? null,
      previous_night: item.contributors?.previous_night ?? null,
      recovery_index: item.contributors?.recovery_index ?? null,
      resting_heart_rate: item.contributors?.resting_heart_rate ?? null,
      sleep_balance: item.contributors?.sleep_balance ?? null,
      timestamp: item.timestamp,
      synced_at,
    }));
    const parquet = await encodeDailyReadiness(encoder, rows);
    await writeParquetToR2(r2, "daily_readiness", day, parquet);
  }

  return data.length;
}

async function syncHeartRate(
  r2: R2Bucket,
  encoder: Fetcher,
  token: string,
  startDate: string,
  endDate: string
): Promise<number> {
  // Heart rate API uses datetime params and has a 30-day limit
  const data = await fetchAllPages<OuraHeartRate>("/v2/usercollection/heartrate", token, {
    start_datetime: `${startDate}T00:00:00+00:00`,
    end_datetime: `${endDate}T23:59:59+00:00`,
  });

  if (data.length === 0) return 0;

  const synced_at = new Date().toISOString();
  const grouped = groupByDay(data, (item) => item.timestamp.split("T")[0]);

  for (const [day, items] of grouped) {
    const rows: HeartRateRow[] = items.map((item) => ({
      bpm: item.bpm,
      source: item.source,
      timestamp: item.timestamp,
      day,
      synced_at,
    }));
    const parquet = await encodeHeartRate(encoder, rows);
    await writeParquetToR2(r2, "heart_rate", day, parquet);
  }

  return data.length;
}

// ============================================
// Main Sync
// ============================================

export async function runSync(
  env: Env,
  options?: { startDate?: string; endDate?: string }
): Promise<SyncResult> {
  const db = env.DB;
  const r2 = env.DATA_LAKE;
  const encoder = env.PARQUET_ENCODER;

  // Get valid OAuth token (refreshes if expired)
  let token = await getValidToken(db, env);

  const today = new Date().toISOString().split("T")[0];
  const isManualRange = !!(options?.startDate || options?.endDate);

  // Determine date range
  let startDate: string;
  if (options?.startDate) {
    startDate = options.startDate;
  } else {
    const syncState = await db
      .prepare("SELECT last_sync_at FROM sync_state WHERE id = 'oura'")
      .first<{ last_sync_at: string | null }>();

    const lastSyncAt = syncState?.last_sync_at ?? null;
    if (!lastSyncAt) {
      startDate = env.OURA_BACKFILL_START_DATE || "2024-01-01";
      console.log(`Oura backfill from ${startDate} to ${today}`);
    } else {
      const start = new Date(lastSyncAt);
      start.setDate(start.getDate() - 1);
      startDate = start.toISOString().split("T")[0];
    }
  }

  const endDate = options?.endDate ?? today;

  // Split into monthly chunks
  const chunks = splitIntoMonthlyChunks(startDate, endDate);
  console.log(`Oura sync: ${chunks.length} monthly chunk(s) from ${startDate} to ${endDate}`);

  let totalSleep = 0;
  let totalActivity = 0;
  let totalReadiness = 0;
  let totalHeartRate = 0;
  let lastSuccessfulEnd: string | null = null;

  for (const chunk of chunks) {
    try {
      // Refresh token if needed before each chunk
      token = await getValidToken(db, env);

      const sleepCount = await syncDailySleep(r2, encoder, token, chunk.start, chunk.end);
      const activityCount = await syncDailyActivity(r2, encoder, token, chunk.start, chunk.end);
      const readinessCount = await syncDailyReadiness(r2, encoder, token, chunk.start, chunk.end);

      // Heart rate API has 30-day limit; use inclusive day count
      const chunkDays =
        (new Date(chunk.end).getTime() - new Date(chunk.start).getTime()) / (1000 * 60 * 60 * 24) +
        1;
      const heartRateCount =
        chunkDays > 30 ? 0 : await syncHeartRate(r2, encoder, token, chunk.start, chunk.end);

      totalSleep += sleepCount;
      totalActivity += activityCount;
      totalReadiness += readinessCount;
      totalHeartRate += heartRateCount;
      lastSuccessfulEnd = chunk.end;

      console.log(
        `Oura chunk ${chunk.start}~${chunk.end}: ${sleepCount} sleep, ${activityCount} activity, ${readinessCount} readiness, ${heartRateCount} HR`
      );

      // Rate limit: 1s delay between chunks
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await sleep(1000);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      console.error(`Oura chunk ${chunk.start}~${chunk.end} failed: ${message}`);
      if (message.includes("rate limit")) {
        // Skip remaining chunks on rate limit
        break;
      }
      // Other errors: skip this chunk and continue
    }
  }

  // Only update sync_state if at least one chunk succeeded (skip for manual range)
  if (lastSuccessfulEnd && !isManualRange) {
    await db
      .prepare(
        "UPDATE sync_state SET last_sync_at = ?, updated_at = datetime('now') WHERE id = 'oura'"
      )
      .bind(lastSuccessfulEnd)
      .run();
  }

  const total = totalSleep + totalActivity + totalReadiness + totalHeartRate;

  return {
    service: "oura",
    success: true,
    message: `Synced ${totalSleep} sleep, ${totalActivity} activity, ${totalReadiness} readiness, ${totalHeartRate} heart rate records to R2 Parquet`,
    count: total,
  };
}

// ============================================
// Routes
// ============================================

// OAuth2 authorization
app.get("/auth", async (c) => {
  const state = crypto.randomUUID();

  // Persist state for CSRF validation (expires in 10 minutes)
  const stateExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO oauth_tokens (id, access_token, refresh_token, expires_at)
     VALUES ('oura_state', ?, '', ?)
     ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, expires_at = excluded.expires_at`
  )
    .bind(state, stateExpiry)
    .run();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: c.env.OURA_CLIENT_ID,
    redirect_uri: c.env.OURA_REDIRECT_URI,
    scope: "daily heartrate",
    state,
  });
  return c.redirect(`${OURA_AUTH_URL}?${params.toString()}`);
});

// OAuth2 callback
app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code) {
    return c.json({ error: "Missing authorization code" }, 400);
  }

  // Validate state for CSRF protection
  const storedState = await c.env.DB.prepare(
    "SELECT access_token, expires_at FROM oauth_tokens WHERE id = 'oura_state'"
  ).first<{ access_token: string; expires_at: string }>();

  await c.env.DB.prepare("DELETE FROM oauth_tokens WHERE id = 'oura_state'").run();

  if (!storedState || storedState.access_token !== state) {
    return c.json({ error: "Invalid state parameter" }, 400);
  }
  if (new Date(storedState.expires_at) < new Date()) {
    return c.json({ error: "State expired, please retry authorization" }, 400);
  }

  const res = await fetch(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: c.env.OURA_CLIENT_ID,
      client_secret: c.env.OURA_CLIENT_SECRET,
      redirect_uri: c.env.OURA_REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return c.json({ error: "Token exchange failed", detail: text }, 500);
  }

  const token: OuraTokenResponse = await res.json();
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO oauth_tokens (id, access_token, refresh_token, token_type, expires_at, scope, updated_at)
     VALUES ('oura', ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       token_type = excluded.token_type,
       expires_at = excluded.expires_at,
       scope = excluded.scope,
       updated_at = excluded.updated_at`
  )
    .bind(token.access_token, token.refresh_token, token.token_type, expiresAt, token.scope ?? null)
    .run();

  return c.json({ success: true, message: "Oura connected successfully" });
});

// Manual sync — optional ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
app.post("/sync", async (c) => {
  try {
    const startDate = c.req.query("start_date");
    const endDate = c.req.query("end_date");
    const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

    if ((startDate && !isIsoDate(startDate)) || (endDate && !isIsoDate(endDate))) {
      return c.json(
        { service: "oura", success: false, message: "start_date/end_date must be YYYY-MM-DD" },
        400
      );
    }
    if (startDate && endDate && startDate > endDate) {
      return c.json(
        { service: "oura", success: false, message: "start_date must be <= end_date" },
        400
      );
    }

    const options = startDate || endDate ? { startDate, endDate } : undefined;
    const result = await runSync(c.env, options);
    return c.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("not authenticated") ? 401 : 500;
    return c.json({ service: "oura", success: false, message }, status);
  }
});

// Stats — list R2 objects count (handles pagination)
app.get("/stats", async (c) => {
  const tables = ["daily_sleep", "daily_activity", "daily_readiness", "heart_rate"];
  const stats: Record<string, number> = {};

  for (const table of tables) {
    let count = 0;
    let cursor: string | undefined;
    do {
      const list = await c.env.DATA_LAKE.list({ prefix: `oura/${table}/`, cursor });
      count += list.objects.length;
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    stats[`${table}_files`] = count;
  }

  const syncState = await c.env.DB.prepare(
    "SELECT last_sync_at FROM sync_state WHERE id = 'oura'"
  ).first<{ last_sync_at: string | null }>();

  return c.json({ ...stats, last_sync: syncState?.last_sync_at ?? null });
});

export default app;
