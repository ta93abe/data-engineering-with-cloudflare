import { Hono } from "hono";
import type { Env, SyncResult } from "../types";

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
// Sync Functions
// ============================================

function getDateRange(lastSyncAt: string | null): { startDate: string; endDate: string } {
  const endDate = new Date().toISOString().split("T")[0];

  if (!lastSyncAt) {
    // First sync: past 30 days
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { startDate: start.toISOString().split("T")[0], endDate };
  }

  // Incremental: from last sync - 1 day
  const start = new Date(lastSyncAt);
  start.setDate(start.getDate() - 1);
  return { startDate: start.toISOString().split("T")[0], endDate };
}

function getHeartRateDateRange(lastSyncAt: string | null): {
  startDate: string;
  endDate: string;
} {
  const endDate = new Date().toISOString().split("T")[0];

  if (!lastSyncAt) {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    return { startDate: start.toISOString().split("T")[0], endDate };
  }

  const start = new Date(lastSyncAt);
  start.setDate(start.getDate() - 1);
  // Limit to 7 days max
  const maxStart = new Date();
  maxStart.setDate(maxStart.getDate() - 7);
  const effectiveStart = start > maxStart ? start : maxStart;
  return { startDate: effectiveStart.toISOString().split("T")[0], endDate };
}

async function syncDailySleep(
  db: D1Database,
  token: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const data = await fetchAllPages<OuraDailySleep>("/v2/usercollection/daily_sleep", token, {
    start_date: startDate,
    end_date: endDate,
  });

  for (const item of data) {
    await db
      .prepare(
        `INSERT INTO oura_daily_sleep (id, day, score, timestamp,
          deep_sleep, efficiency, latency, rem_sleep, restfulness, timing, total_sleep,
          synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           score = excluded.score,
           timestamp = excluded.timestamp,
           deep_sleep = excluded.deep_sleep,
           efficiency = excluded.efficiency,
           latency = excluded.latency,
           rem_sleep = excluded.rem_sleep,
           restfulness = excluded.restfulness,
           timing = excluded.timing,
           total_sleep = excluded.total_sleep,
           synced_at = excluded.synced_at`
      )
      .bind(
        item.id,
        item.day,
        item.score ?? null,
        item.timestamp,
        item.contributors?.deep_sleep ?? null,
        item.contributors?.efficiency ?? null,
        item.contributors?.latency ?? null,
        item.contributors?.rem_sleep ?? null,
        item.contributors?.restfulness ?? null,
        item.contributors?.timing ?? null,
        item.contributors?.total_sleep ?? null
      )
      .run();
  }

  return data.length;
}

async function syncDailyActivity(
  db: D1Database,
  token: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const data = await fetchAllPages<OuraDailyActivity>("/v2/usercollection/daily_activity", token, {
    start_date: startDate,
    end_date: endDate,
  });

  for (const item of data) {
    await db
      .prepare(
        `INSERT INTO oura_daily_activity (id, day, score, active_calories, total_calories, steps,
          equivalent_walking_distance, high_activity_time, medium_activity_time, low_activity_time,
          sedentary_time, resting_time, met_average,
          meet_daily_targets, move_every_hour, recovery_time, stay_active, training_frequency, training_volume,
          timestamp, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           score = excluded.score,
           active_calories = excluded.active_calories,
           total_calories = excluded.total_calories,
           steps = excluded.steps,
           equivalent_walking_distance = excluded.equivalent_walking_distance,
           high_activity_time = excluded.high_activity_time,
           medium_activity_time = excluded.medium_activity_time,
           low_activity_time = excluded.low_activity_time,
           sedentary_time = excluded.sedentary_time,
           resting_time = excluded.resting_time,
           met_average = excluded.met_average,
           meet_daily_targets = excluded.meet_daily_targets,
           move_every_hour = excluded.move_every_hour,
           recovery_time = excluded.recovery_time,
           stay_active = excluded.stay_active,
           training_frequency = excluded.training_frequency,
           training_volume = excluded.training_volume,
           timestamp = excluded.timestamp,
           synced_at = excluded.synced_at`
      )
      .bind(
        item.id,
        item.day,
        item.score ?? null,
        item.active_calories,
        item.total_calories,
        item.steps,
        item.equivalent_walking_distance,
        item.high_activity_time,
        item.medium_activity_time,
        item.low_activity_time,
        item.sedentary_time,
        item.resting_time,
        item.average_met_minutes ?? null,
        item.contributors?.meet_daily_targets ?? null,
        item.contributors?.move_every_hour ?? null,
        item.contributors?.recovery_time ?? null,
        item.contributors?.stay_active ?? null,
        item.contributors?.training_frequency ?? null,
        item.contributors?.training_volume ?? null,
        item.timestamp
      )
      .run();
  }

  return data.length;
}

async function syncDailyReadiness(
  db: D1Database,
  token: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const data = await fetchAllPages<OuraDailyReadiness>(
    "/v2/usercollection/daily_readiness",
    token,
    { start_date: startDate, end_date: endDate }
  );

  for (const item of data) {
    await db
      .prepare(
        `INSERT INTO oura_daily_readiness (id, day, score, temperature_deviation, temperature_trend_deviation,
          timestamp, activity_balance, body_temperature, hrv_balance, previous_day_activity,
          previous_night, recovery_index, resting_heart_rate, sleep_balance, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           score = excluded.score,
           temperature_deviation = excluded.temperature_deviation,
           temperature_trend_deviation = excluded.temperature_trend_deviation,
           timestamp = excluded.timestamp,
           activity_balance = excluded.activity_balance,
           body_temperature = excluded.body_temperature,
           hrv_balance = excluded.hrv_balance,
           previous_day_activity = excluded.previous_day_activity,
           previous_night = excluded.previous_night,
           recovery_index = excluded.recovery_index,
           resting_heart_rate = excluded.resting_heart_rate,
           sleep_balance = excluded.sleep_balance,
           synced_at = excluded.synced_at`
      )
      .bind(
        item.id,
        item.day,
        item.score ?? null,
        item.temperature_deviation ?? null,
        item.temperature_trend_deviation ?? null,
        item.timestamp,
        item.contributors?.activity_balance ?? null,
        item.contributors?.body_temperature ?? null,
        item.contributors?.hrv_balance ?? null,
        item.contributors?.previous_day_activity ?? null,
        item.contributors?.previous_night ?? null,
        item.contributors?.recovery_index ?? null,
        item.contributors?.resting_heart_rate ?? null,
        item.contributors?.sleep_balance ?? null
      )
      .run();
  }

  return data.length;
}

async function syncHeartRate(
  db: D1Database,
  token: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const data = await fetchAllPages<OuraHeartRate>("/v2/usercollection/heartrate", token, {
    start_datetime: `${startDate}T00:00:00+00:00`,
    end_datetime: `${endDate}T23:59:59+00:00`,
  });

  // DELETE + INSERT for heart rate (no stable ID), batched for atomicity
  const deleteStmt = db
    .prepare("DELETE FROM oura_heart_rate WHERE day >= ? AND day <= ?")
    .bind(startDate, endDate);

  if (data.length === 0) {
    await deleteStmt.run();
    return 0;
  }

  const insertStmt = db.prepare(
    `INSERT INTO oura_heart_rate (bpm, source, timestamp, day, synced_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  );
  const inserts = data.map((item) => {
    const day = item.timestamp.split("T")[0];
    return insertStmt.bind(item.bpm, item.source, item.timestamp, day);
  });

  await db.batch([deleteStmt, ...inserts]);

  return data.length;
}

// ============================================
// Main Sync
// ============================================

export async function runSync(
  env: Env,
  overrideStartDate?: string,
  overrideEndDate?: string
): Promise<SyncResult> {
  const db = env.DB;
  const token = await getValidToken(db, env);

  const syncState = await db
    .prepare("SELECT last_sync_at FROM sync_state WHERE id = 'oura'")
    .first<{ last_sync_at: string | null }>();

  const lastSyncAt = syncState?.last_sync_at ?? null;
  const { startDate: defaultStart, endDate: defaultEnd } = getDateRange(lastSyncAt);
  const startDate = overrideStartDate ?? defaultStart;
  const endDate = overrideEndDate ?? defaultEnd;

  // Heart rate API has a 30-day limit; include only when range fits
  const daysDiff =
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24);
  const hrRange = overrideStartDate ? { startDate, endDate } : getHeartRateDateRange(lastSyncAt);

  const sleepCount = await syncDailySleep(db, token, startDate, endDate);
  const activityCount = await syncDailyActivity(db, token, startDate, endDate);
  const readinessCount = await syncDailyReadiness(db, token, startDate, endDate);
  const heartRateCount =
    daysDiff > 30 ? 0 : await syncHeartRate(db, token, hrRange.startDate, hrRange.endDate);

  // Only update sync_state when not doing a historical backfill
  if (!overrideStartDate) {
    await db
      .prepare(
        "UPDATE sync_state SET last_sync_at = datetime('now'), updated_at = datetime('now') WHERE id = 'oura'"
      )
      .run();
  }

  const total = sleepCount + activityCount + readinessCount + heartRateCount;

  return {
    service: "oura",
    success: true,
    message: `Synced ${sleepCount} sleep, ${activityCount} activity, ${readinessCount} readiness, ${heartRateCount} heart rate records`,
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

// Manual sync
app.post("/sync", async (c) => {
  try {
    const startDate = c.req.query("start_date");
    const endDate = c.req.query("end_date");
    const result = await runSync(c.env, startDate, endDate);
    return c.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("not authenticated") ? 401 : 500;
    return c.json({ service: "oura", success: false, message }, status);
  }
});

// Stats
app.get("/stats", async (c) => {
  const stats = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM oura_daily_sleep) as sleep_records,
       (SELECT COUNT(*) FROM oura_daily_activity) as activity_records,
       (SELECT COUNT(*) FROM oura_daily_readiness) as readiness_records,
       (SELECT COUNT(*) FROM oura_heart_rate) as heart_rate_records,
       (SELECT last_sync_at FROM sync_state WHERE id = 'oura') as last_sync`
  ).first();
  return c.json(stats);
});

// Parse and clamp limit query parameter
function parseLimit(raw: string | undefined, defaultVal: number, max = 1000): number {
  const parsed = Number.parseInt(raw ?? String(defaultVal), 10);
  if (Number.isNaN(parsed) || parsed < 1) return defaultVal;
  return Math.min(parsed, max);
}

// Daily summary
app.get("/daily-summary", async (c) => {
  const limit = parseLimit(c.req.query("limit"), 30);
  const results = await c.env.DB.prepare(
    "SELECT * FROM v_oura_daily_summary ORDER BY day DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return c.json(results.results);
});

// Individual data endpoints
app.get("/sleep", async (c) => {
  const limit = parseLimit(c.req.query("limit"), 30);
  const results = await c.env.DB.prepare("SELECT * FROM oura_daily_sleep ORDER BY day DESC LIMIT ?")
    .bind(limit)
    .all();
  return c.json(results.results);
});

app.get("/activity", async (c) => {
  const limit = parseLimit(c.req.query("limit"), 30);
  const results = await c.env.DB.prepare(
    "SELECT * FROM oura_daily_activity ORDER BY day DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return c.json(results.results);
});

app.get("/readiness", async (c) => {
  const limit = parseLimit(c.req.query("limit"), 30);
  const results = await c.env.DB.prepare(
    "SELECT * FROM oura_daily_readiness ORDER BY day DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return c.json(results.results);
});

app.get("/heart-rate", async (c) => {
  const limit = parseLimit(c.req.query("limit"), 288);
  const results = await c.env.DB.prepare(
    "SELECT * FROM oura_heart_rate ORDER BY timestamp DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return c.json(results.results);
});

export default app;
