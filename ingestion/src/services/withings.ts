import { Hono } from "hono";
import type { Env, SyncResult } from "../types";

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
// Sync Functions
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

async function syncMeasures(
  db: D1Database,
  token: string,
  startDate: string,
  endDate: string
): Promise<number> {
  let offset = 0;
  let totalCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const body = await postWithings<MeasureBody>(WITHINGS_MEASURE_URL, token, {
      action: "getmeas",
      category: "1",
      startdate: String(toUnix(startDate)),
      enddate: String(toUnix(endDate) + 86400), // include end date
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

      await db
        .prepare(
          `INSERT INTO withings_measures (grpid, date, timestamp, weight, fat_ratio, fat_mass, fat_free_mass, muscle_mass, bone_mass, hydration, heart_pulse, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(grpid) DO UPDATE SET
             date = excluded.date,
             timestamp = excluded.timestamp,
             weight = excluded.weight,
             fat_ratio = excluded.fat_ratio,
             fat_mass = excluded.fat_mass,
             fat_free_mass = excluded.fat_free_mass,
             muscle_mass = excluded.muscle_mass,
             bone_mass = excluded.bone_mass,
             hydration = excluded.hydration,
             heart_pulse = excluded.heart_pulse,
             synced_at = excluded.synced_at`
        )
        .bind(
          grp.grpid,
          date,
          grp.date,
          values.weight ?? null,
          values.fat_ratio ?? null,
          values.fat_mass ?? null,
          values.fat_free_mass ?? null,
          values.muscle_mass ?? null,
          values.bone_mass ?? null,
          values.hydration ?? null,
          values.heart_pulse ?? null
        )
        .run();
    }

    totalCount += body.measuregrps.length;

    if (!body.more) break;
    offset = body.offset;
  }

  return totalCount;
}

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

async function syncSleep(
  db: D1Database,
  token: string,
  startDate: string,
  endDate: string
): Promise<number> {
  let offset = 0;
  let totalCount = 0;

  while (true) {
    const body = await postWithings<SleepBody>(WITHINGS_SLEEP_URL, token, {
      action: "getsummary",
      startdateymd: startDate,
      enddateymd: endDate,
      data_fields: SLEEP_DATA_FIELDS,
      offset: String(offset),
    });

    for (const item of body.series) {
      const id = `${item.startdate}_${item.enddate}`;

      await db
        .prepare(
          `INSERT INTO withings_sleep (id, date, startdate, enddate,
            total_sleep_duration, deep_sleep_duration, light_sleep_duration, rem_sleep_duration,
            wakeup_duration, sleep_score, sleep_efficiency, sleep_latency,
            hr_average, hr_min, hr_max, rr_average, rr_min, rr_max,
            snoring, snoring_episode_count, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             date = excluded.date,
             total_sleep_duration = excluded.total_sleep_duration,
             deep_sleep_duration = excluded.deep_sleep_duration,
             light_sleep_duration = excluded.light_sleep_duration,
             rem_sleep_duration = excluded.rem_sleep_duration,
             wakeup_duration = excluded.wakeup_duration,
             sleep_score = excluded.sleep_score,
             sleep_efficiency = excluded.sleep_efficiency,
             sleep_latency = excluded.sleep_latency,
             hr_average = excluded.hr_average,
             hr_min = excluded.hr_min,
             hr_max = excluded.hr_max,
             rr_average = excluded.rr_average,
             rr_min = excluded.rr_min,
             rr_max = excluded.rr_max,
             snoring = excluded.snoring,
             snoring_episode_count = excluded.snoring_episode_count,
             synced_at = excluded.synced_at`
        )
        .bind(
          id,
          item.date,
          item.startdate,
          item.enddate,
          item.data.totalsleepduration ?? null,
          item.data.deepsleepduration ?? null,
          item.data.lightsleepduration ?? null,
          item.data.remsleepduration ?? null,
          item.data.wakeupduration ?? null,
          item.data.sleep_score ?? null,
          item.data.sleep_efficiency ?? null,
          item.data.sleep_latency ?? null,
          item.data.hr_average ?? null,
          item.data.hr_min ?? null,
          item.data.hr_max ?? null,
          item.data.rr_average ?? null,
          item.data.rr_min ?? null,
          item.data.rr_max ?? null,
          item.data.snoring ?? null,
          item.data.snoringepisodecount ?? null
        )
        .run();
    }

    totalCount += body.series.length;

    if (!body.more) break;
    offset = body.offset;
  }

  return totalCount;
}

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

async function syncActivity(
  db: D1Database,
  token: string,
  startDate: string,
  endDate: string
): Promise<number> {
  let offset = 0;
  let totalCount = 0;

  while (true) {
    const body = await postWithings<ActivityBody>(WITHINGS_ACTIVITY_URL, token, {
      action: "getactivity",
      startdateymd: startDate,
      enddateymd: endDate,
      data_fields: ACTIVITY_DATA_FIELDS,
      offset: String(offset),
    });

    for (const item of body.activities) {
      await db
        .prepare(
          `INSERT INTO withings_activity (date, steps, distance, elevation, soft, moderate, intense, active, calories, total_calories, hr_average, hr_min, hr_max, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(date) DO UPDATE SET
             steps = excluded.steps,
             distance = excluded.distance,
             elevation = excluded.elevation,
             soft = excluded.soft,
             moderate = excluded.moderate,
             intense = excluded.intense,
             active = excluded.active,
             calories = excluded.calories,
             total_calories = excluded.total_calories,
             hr_average = excluded.hr_average,
             hr_min = excluded.hr_min,
             hr_max = excluded.hr_max,
             synced_at = excluded.synced_at`
        )
        .bind(
          item.date,
          item.steps ?? null,
          item.distance ?? null,
          item.elevation ?? null,
          item.soft ?? null,
          item.moderate ?? null,
          item.intense ?? null,
          item.active ?? null,
          item.calories ?? null,
          item.totalcalories ?? null,
          item.hr_average ?? null,
          item.hr_min ?? null,
          item.hr_max ?? null
        )
        .run();
    }

    totalCount += body.activities.length;

    if (!body.more) break;
    offset = body.offset;
  }

  return totalCount;
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
    .prepare("SELECT last_sync_at FROM sync_state WHERE id = 'withings'")
    .first<{ last_sync_at: string | null }>();

  const lastSyncAt = syncState?.last_sync_at ?? null;
  const { startDate: defaultStart, endDate: defaultEnd } = getDateRange(lastSyncAt);
  const startDate = overrideStartDate ?? defaultStart;
  const endDate = overrideEndDate ?? defaultEnd;

  const measureCount = await syncMeasures(db, token, startDate, endDate);
  const sleepCount = await syncSleep(db, token, startDate, endDate);
  const activityCount = await syncActivity(db, token, startDate, endDate);

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
    message: `Synced ${measureCount} measures, ${sleepCount} sleep, ${activityCount} activity records`,
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

// Stats
app.get("/stats", async (c) => {
  const stats = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM withings_measures) as measure_records,
       (SELECT COUNT(*) FROM withings_sleep) as sleep_records,
       (SELECT COUNT(*) FROM withings_activity) as activity_records,
       (SELECT last_sync_at FROM sync_state WHERE id = 'withings') as last_sync`
  ).first();
  return c.json(stats);
});

function parseLimit(raw: string | undefined, defaultVal: number, max = 1000): number {
  const parsed = Number.parseInt(raw ?? String(defaultVal), 10);
  if (Number.isNaN(parsed) || parsed < 1) return defaultVal;
  return Math.min(parsed, max);
}

// Data endpoints
app.get("/measures", async (c) => {
  const limit = parseLimit(c.req.query("limit"), 30);
  const results = await c.env.DB.prepare(
    "SELECT * FROM withings_measures ORDER BY date DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return c.json(results.results);
});

app.get("/sleep", async (c) => {
  const limit = parseLimit(c.req.query("limit"), 30);
  const results = await c.env.DB.prepare("SELECT * FROM withings_sleep ORDER BY date DESC LIMIT ?")
    .bind(limit)
    .all();
  return c.json(results.results);
});

app.get("/activity", async (c) => {
  const limit = parseLimit(c.req.query("limit"), 30);
  const results = await c.env.DB.prepare(
    "SELECT * FROM withings_activity ORDER BY date DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return c.json(results.results);
});

app.get("/daily-summary", async (c) => {
  const limit = parseLimit(c.req.query("limit"), 30);
  const results = await c.env.DB.prepare(
    "SELECT * FROM v_withings_daily_summary ORDER BY date DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return c.json(results.results);
});

export default app;
