import { Hono } from "hono";
import type { Env, SyncResult } from "../types";
import {
  encodeWithingsActivity,
  encodeWithingsMeasure,
  encodeWithingsSleep,
  type WithingsActivityRow,
  type WithingsMeasureRow,
  type WithingsSleepRow,
} from "./parquet";

const app = new Hono<{ Bindings: Env }>();

const WITHINGS_AUTH_URL = "https://account.withings.com/oauth2_user/authorize2";
const WITHINGS_TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2";
const WITHINGS_MEASURE_URL = "https://wbsapi.withings.net/measure";
const WITHINGS_SLEEP_URL = "https://wbsapi.withings.net/v2/sleep";
const WITHINGS_ACTIVITY_URL = "https://wbsapi.withings.net/v2/measure";

// ============================================
// Types
// ============================================

interface WithingsResponse<T> {
  status: number;
  body: T;
  error?: string;
}

interface WithingsTokenBody {
  userid: number;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface MeasureGroup {
  grpid: number;
  date: number;
  measures: { type: number; value: number; unit: number }[];
}

interface MeasureBody {
  updatetime: number;
  timezone: string;
  measuregrps: MeasureGroup[];
  more: number;
  offset: number;
}

interface SleepSeries {
  startdate: number;
  enddate: number;
  date: string;
  data: Record<string, number | null>;
}

interface SleepBody {
  series: SleepSeries[];
  more: boolean;
  offset: number;
}

interface ActivityEntry {
  date: string;
  steps: number;
  distance: number;
  elevation: number;
  soft: number;
  moderate: number;
  intense: number;
  active: number;
  calories: number;
  totalcalories: number;
  hr_average: number;
  hr_min: number;
  hr_max: number;
}

interface ActivityBody {
  activities: ActivityEntry[];
  more: boolean;
  offset: number;
}

// Measure type codes
const MEASURE_TYPES: Record<number, string> = {
  1: "weight",
  5: "fat_free_mass",
  6: "fat_ratio",
  8: "fat_mass",
  11: "heart_pulse",
  76: "muscle_mass",
  77: "hydration",
  88: "bone_mass",
};

// ============================================
// OAuth2
// ============================================

async function getValidToken(db: D1Database, env: Env): Promise<string> {
  const row = await db
    .prepare(
      "SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE id = 'withings'"
    )
    .first<{ access_token: string; refresh_token: string; expires_at: string }>();

  if (!row) {
    throw new Error("Withings not authenticated. Visit /withings/auth to connect.");
  }

  const now = new Date();
  const expiresAt = new Date(row.expires_at);

  if (now < expiresAt) {
    return row.access_token;
  }

  // Refresh token (Withings uses action=requesttoken)
  const res = await fetch(WITHINGS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      action: "requesttoken",
      grant_type: "refresh_token",
      client_id: env.WITHINGS_CLIENT_ID,
      client_secret: env.WITHINGS_CLIENT_SECRET,
      refresh_token: row.refresh_token,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Withings token refresh HTTP error: ${res.status} ${text}`);
  }

  const json: WithingsResponse<WithingsTokenBody> = await res.json();
  if (json.status !== 0) {
    throw new Error(`Withings token refresh failed: status=${json.status} error=${json.error}`);
  }

  const newExpiresAt = new Date(Date.now() + json.body.expires_in * 1000).toISOString();

  await db
    .prepare(
      `UPDATE oauth_tokens SET
        access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
       WHERE id = 'withings'`
    )
    .bind(json.body.access_token, json.body.refresh_token, newExpiresAt)
    .run();

  return json.body.access_token;
}

// ============================================
// API Client
// ============================================

async function postWithings<T>(
  url: string,
  token: string,
  params: Record<string, string>
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${token}`,
    },
    body: new URLSearchParams(params),
  });

  if (res.status === 429) {
    throw new Error("Withings API rate limit exceeded");
  }
  if (res.status === 401) {
    throw new Error("Withings API unauthorized - token may be expired");
  }
  if (!res.ok) {
    const body = await res.text();
    const truncated = body.length > 500 ? `${body.slice(0, 500)}...(truncated)` : body;
    throw new Error(`Withings API HTTP error: ${res.status} - ${truncated || "no response body"}`);
  }

  const json: WithingsResponse<T> = await res.json();
  if (json.status !== 0) {
    throw new Error(`Withings API error: status=${json.status} error=${json.error}`);
  }

  return json.body;
}

// ============================================
// Helpers
// ============================================

function getDateRange(lastSyncAt: string | null): { startDate: string; endDate: string } {
  const endDate = new Date().toISOString().split("T")[0];

  if (!lastSyncAt) {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { startDate: start.toISOString().split("T")[0], endDate };
  }

  const start = new Date(lastSyncAt);
  start.setDate(start.getDate() - 1);
  return { startDate: start.toISOString().split("T")[0], endDate };
}

function toUnix(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

/** Convert Withings raw value: actual = value * 10^unit */
function toActualValue(value: number, unit: number): number {
  return value * 10 ** unit;
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

// ============================================
// Sync Functions (R2 Parquet)
// ============================================

const SLEEP_DATA_FIELDS = [
  "totalsleepduration",
  "deepsleepduration",
  "lightsleepduration",
  "remsleepduration",
  "wakeupduration",
  "sleep_score",
  "sleep_efficiency",
  "sleep_latency",
  "hr_average",
  "hr_min",
  "hr_max",
  "rr_average",
  "rr_min",
  "rr_max",
  "snoring",
  "snoringepisodecount",
].join(",");

const ACTIVITY_DATA_FIELDS = [
  "steps",
  "distance",
  "elevation",
  "soft",
  "moderate",
  "intense",
  "active",
  "calories",
  "totalcalories",
  "hr_average",
  "hr_min",
  "hr_max",
].join(",");

async function syncMeasures(
  r2: R2Bucket,
  encoder: Fetcher,
  token: string,
  startDate: string,
  endDate: string,
  synced_at: string
): Promise<number> {
  let offset = 0;
  const allRows: WithingsMeasureRow[] = [];

  while (true) {
    const body = await postWithings<MeasureBody>(WITHINGS_MEASURE_URL, token, {
      action: "getmeas",
      category: "1",
      startdate: String(toUnix(startDate)),
      enddate: String(toUnix(endDate) + 86400),
      offset: String(offset),
    });

    for (const grp of body.measuregrps) {
      const values: Record<string, number | null> = {};
      for (const m of grp.measures) {
        const field = MEASURE_TYPES[m.type];
        if (field) {
          values[field] = toActualValue(m.value, m.unit);
        }
      }

      const date = new Date(grp.date * 1000).toISOString().split("T")[0];

      allRows.push({
        grpid: grp.grpid,
        date,
        timestamp: grp.date,
        weight: values.weight ?? null,
        fat_ratio: values.fat_ratio ?? null,
        fat_mass: values.fat_mass ?? null,
        fat_free_mass: values.fat_free_mass ?? null,
        muscle_mass: values.muscle_mass ?? null,
        bone_mass: values.bone_mass ?? null,
        hydration: values.hydration ?? null,
        heart_pulse: values.heart_pulse ?? null,
        synced_at,
      });
    }

    if (!body.more) break;
    offset = body.offset;
  }

  // Group by day and write daily Parquet files
  const grouped = groupByDay(allRows, (r) => r.date);
  for (const [day, rows] of grouped) {
    const parquet = await encodeWithingsMeasure(encoder, rows);
    await r2.put(`withings/measures/${day}.parquet`, parquet);
  }

  return allRows.length;
}

async function syncSleep(
  r2: R2Bucket,
  encoder: Fetcher,
  token: string,
  startDate: string,
  endDate: string,
  synced_at: string
): Promise<number> {
  let offset = 0;
  const allRows: WithingsSleepRow[] = [];

  while (true) {
    const body = await postWithings<SleepBody>(WITHINGS_SLEEP_URL, token, {
      action: "getsummary",
      startdateymd: startDate,
      enddateymd: endDate,
      data_fields: SLEEP_DATA_FIELDS,
      offset: String(offset),
    });

    for (const item of body.series) {
      allRows.push({
        date: item.date,
        startdate: item.startdate,
        enddate: item.enddate,
        total_sleep_duration: item.data.totalsleepduration ?? null,
        deep_sleep_duration: item.data.deepsleepduration ?? null,
        light_sleep_duration: item.data.lightsleepduration ?? null,
        rem_sleep_duration: item.data.remsleepduration ?? null,
        wakeup_duration: item.data.wakeupduration ?? null,
        sleep_score: item.data.sleep_score ?? null,
        sleep_efficiency: item.data.sleep_efficiency ?? null,
        sleep_latency: item.data.sleep_latency ?? null,
        hr_average: item.data.hr_average ?? null,
        hr_min: item.data.hr_min ?? null,
        hr_max: item.data.hr_max ?? null,
        rr_average: item.data.rr_average ?? null,
        rr_min: item.data.rr_min ?? null,
        rr_max: item.data.rr_max ?? null,
        snoring: item.data.snoring ?? null,
        snoring_episode_count: item.data.snoringepisodecount ?? null,
        synced_at,
      });
    }

    if (!body.more) break;
    offset = body.offset;
  }

  // Group by day and write daily Parquet files
  const grouped = groupByDay(allRows, (r) => r.date);
  for (const [day, rows] of grouped) {
    const parquet = await encodeWithingsSleep(encoder, rows);
    await r2.put(`withings/sleep/${day}.parquet`, parquet);
  }

  return allRows.length;
}

async function syncActivity(
  r2: R2Bucket,
  encoder: Fetcher,
  token: string,
  startDate: string,
  endDate: string,
  synced_at: string
): Promise<number> {
  let offset = 0;
  const allRows: WithingsActivityRow[] = [];

  while (true) {
    const body = await postWithings<ActivityBody>(WITHINGS_ACTIVITY_URL, token, {
      action: "getactivity",
      startdateymd: startDate,
      enddateymd: endDate,
      data_fields: ACTIVITY_DATA_FIELDS,
      offset: String(offset),
    });

    for (const item of body.activities) {
      allRows.push({
        date: item.date,
        steps: item.steps ?? null,
        distance: item.distance ?? null,
        elevation: item.elevation ?? null,
        soft: item.soft ?? null,
        moderate: item.moderate ?? null,
        intense: item.intense ?? null,
        active: item.active ?? null,
        calories: item.calories ?? null,
        total_calories: item.totalcalories ?? null,
        hr_average: item.hr_average ?? null,
        hr_min: item.hr_min ?? null,
        hr_max: item.hr_max ?? null,
        synced_at,
      });
    }

    if (!body.more) break;
    offset = body.offset;
  }

  // Group by day and write daily Parquet files
  const grouped = groupByDay(allRows, (r) => r.date);
  for (const [day, rows] of grouped) {
    const parquet = await encodeWithingsActivity(encoder, rows);
    await r2.put(`withings/activity/${day}.parquet`, parquet);
  }

  return allRows.length;
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
  const r2 = env.DATA_LAKE;
  const encoder = env.PARQUET_ENCODER;

  const token = await getValidToken(db, env);
  const synced_at = new Date().toISOString();

  const syncState = await db
    .prepare("SELECT last_sync_at FROM sync_state WHERE id = 'withings'")
    .first<{ last_sync_at: string | null }>();

  const lastSyncAt = syncState?.last_sync_at ?? null;
  const { startDate: defaultStart, endDate: defaultEnd } = getDateRange(lastSyncAt);
  const startDate = overrideStartDate ?? defaultStart;
  const endDate = overrideEndDate ?? defaultEnd;

  const measureCount = await syncMeasures(r2, encoder, token, startDate, endDate, synced_at);
  const sleepCount = await syncSleep(r2, encoder, token, startDate, endDate, synced_at);
  const activityCount = await syncActivity(r2, encoder, token, startDate, endDate, synced_at);

  if (!overrideStartDate) {
    await db
      .prepare(
        "UPDATE sync_state SET last_sync_at = datetime('now'), updated_at = datetime('now') WHERE id = 'withings'"
      )
      .run();
  }

  const total = measureCount + sleepCount + activityCount;

  return {
    service: "withings",
    success: true,
    message: `Synced ${measureCount} measures, ${sleepCount} sleep, ${activityCount} activity records to R2 Parquet`,
    count: total,
  };
}

// ============================================
// Routes
// ============================================

// OAuth2 authorization
app.get("/auth", async (c) => {
  const state = crypto.randomUUID();

  const stateExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO oauth_tokens (id, access_token, refresh_token, expires_at)
     VALUES ('withings_state', ?, '', ?)
     ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, expires_at = excluded.expires_at`
  )
    .bind(state, stateExpiry)
    .run();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: c.env.WITHINGS_CLIENT_ID,
    redirect_uri: c.env.WITHINGS_REDIRECT_URI,
    scope: "user.info,user.metrics,user.activity",
    state,
  });
  return c.redirect(`${WITHINGS_AUTH_URL}?${params.toString()}`);
});

// OAuth2 callback
app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code) {
    return c.json({ error: "Missing authorization code" }, 400);
  }

  const storedState = await c.env.DB.prepare(
    "SELECT access_token, expires_at FROM oauth_tokens WHERE id = 'withings_state'"
  ).first<{ access_token: string; expires_at: string }>();

  await c.env.DB.prepare("DELETE FROM oauth_tokens WHERE id = 'withings_state'").run();

  if (!storedState || storedState.access_token !== state) {
    return c.json({ error: "Invalid state parameter" }, 400);
  }
  if (new Date(storedState.expires_at) < new Date()) {
    return c.json({ error: "State expired, please retry authorization" }, 400);
  }

  // Withings uses action=requesttoken for token exchange
  const res = await fetch(WITHINGS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      action: "requesttoken",
      grant_type: "authorization_code",
      client_id: c.env.WITHINGS_CLIENT_ID,
      client_secret: c.env.WITHINGS_CLIENT_SECRET,
      code,
      redirect_uri: c.env.WITHINGS_REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return c.json({ error: "Token exchange HTTP error", detail: text }, 500);
  }

  const json: WithingsResponse<WithingsTokenBody> = await res.json();
  if (json.status !== 0) {
    return c.json({ error: "Token exchange failed", status: json.status, detail: json.error }, 500);
  }

  const expiresAt = new Date(Date.now() + json.body.expires_in * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO oauth_tokens (id, access_token, refresh_token, token_type, expires_at, scope, updated_at)
     VALUES ('withings', ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       token_type = excluded.token_type,
       expires_at = excluded.expires_at,
       scope = excluded.scope,
       updated_at = excluded.updated_at`
  )
    .bind(
      json.body.access_token,
      json.body.refresh_token,
      json.body.token_type,
      expiresAt,
      json.body.scope
    )
    .run();

  return c.json({ success: true, message: "Withings connected successfully" });
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
    return c.json({ service: "withings", success: false, message }, status);
  }
});

// Stats — list R2 objects
app.get("/stats", async (c) => {
  const r2 = c.env.DATA_LAKE;
  const tables = ["measures", "sleep", "activity"];
  const stats: Record<string, number> = {};

  for (const table of tables) {
    let count = 0;
    let cursor: string | undefined;
    do {
      const list = await r2.list({ prefix: `withings/${table}/`, cursor });
      count += list.objects.length;
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    stats[`${table}_files`] = count;
  }

  const syncState = await c.env.DB.prepare(
    "SELECT last_sync_at FROM sync_state WHERE id = 'withings'"
  ).first<{ last_sync_at: string | null }>();

  return c.json({ ...stats, last_sync: syncState?.last_sync_at ?? null });
});

export default app;
