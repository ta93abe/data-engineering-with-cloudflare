import { env, fetchMock, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const OURA_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_type TEXT DEFAULT 'Bearer',
    expires_at TEXT NOT NULL,
    scope TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oura_daily_sleep (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL UNIQUE,
    score INTEGER,
    timestamp TEXT,
    deep_sleep INTEGER,
    efficiency INTEGER,
    latency INTEGER,
    rem_sleep INTEGER,
    restfulness INTEGER,
    timing INTEGER,
    total_sleep INTEGER,
    synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oura_daily_activity (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL UNIQUE,
    score INTEGER,
    active_calories INTEGER,
    total_calories INTEGER,
    steps INTEGER,
    equivalent_walking_distance REAL,
    high_activity_time INTEGER,
    medium_activity_time INTEGER,
    low_activity_time INTEGER,
    sedentary_time INTEGER,
    resting_time INTEGER,
    met_average REAL,
    meet_daily_targets INTEGER,
    move_every_hour INTEGER,
    recovery_time INTEGER,
    stay_active INTEGER,
    training_frequency INTEGER,
    training_volume INTEGER,
    timestamp TEXT,
    synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oura_daily_readiness (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL UNIQUE,
    score INTEGER,
    temperature_deviation REAL,
    temperature_trend_deviation REAL,
    timestamp TEXT,
    activity_balance INTEGER,
    body_temperature INTEGER,
    hrv_balance INTEGER,
    previous_day_activity INTEGER,
    previous_night INTEGER,
    recovery_index INTEGER,
    resting_heart_rate INTEGER,
    sleep_balance INTEGER,
    synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oura_heart_rate (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bpm INTEGER NOT NULL,
    source TEXT,
    timestamp TEXT NOT NULL,
    day TEXT NOT NULL,
    synced_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_oura_daily_sleep_day ON oura_daily_sleep(day DESC);
CREATE INDEX IF NOT EXISTS idx_oura_daily_activity_day ON oura_daily_activity(day DESC);
CREATE INDEX IF NOT EXISTS idx_oura_daily_readiness_day ON oura_daily_readiness(day DESC);
CREATE INDEX IF NOT EXISTS idx_oura_heart_rate_day ON oura_heart_rate(day DESC);
CREATE INDEX IF NOT EXISTS idx_oura_heart_rate_timestamp ON oura_heart_rate(timestamp DESC);

CREATE VIEW IF NOT EXISTS v_oura_daily_summary AS
SELECT
    s.day,
    s.score AS sleep_score,
    a.score AS activity_score,
    r.score AS readiness_score,
    a.steps,
    a.total_calories,
    a.active_calories,
    r.temperature_deviation,
    s.deep_sleep AS sleep_deep_sleep,
    s.efficiency AS sleep_efficiency,
    s.total_sleep AS sleep_total_sleep
FROM oura_daily_sleep s
LEFT JOIN oura_daily_activity a ON s.day = a.day
LEFT JOIN oura_daily_readiness r ON s.day = r.day
ORDER BY s.day DESC;

CREATE TABLE IF NOT EXISTS data_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL,
    api_endpoint TEXT,
    schedule_cron TEXT,
    is_active INTEGER DEFAULT 1,
    config_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,
    data_source_id TEXT NOT NULL,
    last_sync_at TEXT,
    last_cursor TEXT,
    metadata_json TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (data_source_id) REFERENCES data_sources(id)
);

INSERT OR IGNORE INTO data_sources (id, name, source_type, api_endpoint, schedule_cron)
VALUES ('oura', 'Oura Ring', 'api', 'https://api.ouraring.com', '0 0 * * *');

INSERT OR IGNORE INTO sync_state (id, data_source_id, last_sync_at)
VALUES ('oura', 'oura', NULL);
`;

async function insertTestToken(expiresAt?: string) {
  const expires = expiresAt ?? new Date(Date.now() + 3600 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO oauth_tokens (id, access_token, refresh_token, expires_at)
     VALUES ('oura', 'test-access-token', 'test-refresh-token', ?)`
  )
    .bind(expires)
    .run();
}

beforeAll(async () => {
  const statements = OURA_MIGRATION_SQL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }

  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe("oura oauth2", () => {
  it("redirects to Oura auth page on GET /oura/auth", async () => {
    const res = await SELF.fetch("https://example.com/oura/auth", { redirect: "manual" });
    expect(res.status).toBe(302);

    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("cloud.ouraring.com/oauth/authorize");
    expect(location).toContain("client_id=");
    expect(location).toContain("redirect_uri=");
    expect(location).toContain("scope=daily+heartrate");
  });

  it("returns error when callback has no code", async () => {
    const res = await SELF.fetch("https://example.com/oura/callback");
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json).toHaveProperty("error", "Missing authorization code");
  });

  it("exchanges code for token on callback with valid state", async () => {
    // Pre-store state for CSRF validation
    const futureExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO oauth_tokens (id, access_token, refresh_token, expires_at)
       VALUES ('oura_state', 'test-state-value', '', ?)`
    )
      .bind(futureExpiry)
      .run();

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, {
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        token_type: "Bearer",
        expires_in: 86400,
        scope: "daily heartrate",
      });

    const res = await SELF.fetch(
      "https://example.com/oura/callback?code=test-auth-code&state=test-state-value"
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty("success", true);

    // Verify token was saved
    const token = await env.DB.prepare("SELECT * FROM oauth_tokens WHERE id = 'oura'").first();
    expect(token).not.toBeNull();
    expect(token?.access_token).toBe("new-access-token");
  });

  it("rejects callback with invalid state", async () => {
    const futureExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO oauth_tokens (id, access_token, refresh_token, expires_at)
       VALUES ('oura_state', 'correct-state', '', ?)`
    )
      .bind(futureExpiry)
      .run();

    const res = await SELF.fetch(
      "https://example.com/oura/callback?code=test-auth-code&state=wrong-state"
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json).toHaveProperty("error", "Invalid state parameter");
  });
});

describe("oura sync", () => {
  it("syncs sleep data to R2 Parquet", async () => {
    await insertTestToken();
    // Set last_sync_at to recent date so only 1 monthly chunk is created
    await env.DB.prepare(
      "UPDATE sync_state SET last_sync_at = '2026-03-10' WHERE id = 'oura'"
    ).run();

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_sleep/ })
      .reply(200, {
        data: [
          {
            id: "sleep-001",
            day: "2026-03-11",
            score: 85,
            timestamp: "2026-03-11T07:00:00+00:00",
            contributors: {
              deep_sleep: 80,
              efficiency: 90,
              latency: 85,
              rem_sleep: 75,
              restfulness: 88,
              timing: 82,
              total_sleep: 86,
            },
          },
        ],
        next_token: null,
      });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_activity/ })
      .reply(200, { data: [], next_token: null });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_readiness/ })
      .reply(200, { data: [], next_token: null });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/heartrate/ })
      .reply(200, { data: [], next_token: null });

    const res = await SELF.fetch("https://example.com/oura/sync", { method: "POST" });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { success: boolean; count: number };
    expect(json.success).toBe(true);
    expect(json.count).toBe(1);

    // Verify Parquet file written to R2
    const obj = await env.DATA_LAKE.head("oura/daily_sleep/2026-03-11.parquet");
    expect(obj).not.toBeNull();
    expect(obj!.size).toBeGreaterThan(0);
  });

  it("syncs activity and readiness data to R2 Parquet", async () => {
    await insertTestToken();
    await env.DB.prepare(
      "UPDATE sync_state SET last_sync_at = '2026-03-10' WHERE id = 'oura'"
    ).run();

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_sleep/ })
      .reply(200, { data: [], next_token: null });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_activity/ })
      .reply(200, {
        data: [
          {
            id: "activity-001",
            day: "2026-03-11",
            score: 90,
            active_calories: 500,
            total_calories: 2200,
            steps: 10000,
            equivalent_walking_distance: 8000,
            high_activity_time: 1800,
            medium_activity_time: 3600,
            low_activity_time: 7200,
            sedentary_time: 28800,
            resting_time: 28800,
            average_met_minutes: 1.5,
            contributors: {
              meet_daily_targets: 85,
              move_every_hour: 90,
              recovery_time: 80,
              stay_active: 88,
              training_frequency: 75,
              training_volume: 82,
            },
            timestamp: "2026-03-11T23:59:59+00:00",
          },
        ],
        next_token: null,
      });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_readiness/ })
      .reply(200, {
        data: [
          {
            id: "readiness-001",
            day: "2026-03-11",
            score: 88,
            temperature_deviation: 0.1,
            temperature_trend_deviation: -0.05,
            timestamp: "2026-03-11T07:00:00+00:00",
            contributors: {
              activity_balance: 85,
              body_temperature: 90,
              hrv_balance: 80,
              previous_day_activity: 88,
              previous_night: 92,
              recovery_index: 86,
              resting_heart_rate: 84,
              sleep_balance: 87,
            },
          },
        ],
        next_token: null,
      });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/heartrate/ })
      .reply(200, { data: [], next_token: null });

    const res = await SELF.fetch("https://example.com/oura/sync", { method: "POST" });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { success: boolean; count: number };
    expect(json.success).toBe(true);
    expect(json.count).toBe(2);

    // Verify activity Parquet file on R2
    const activityObj = await env.DATA_LAKE.head("oura/daily_activity/2026-03-11.parquet");
    expect(activityObj).not.toBeNull();
    expect(activityObj!.size).toBeGreaterThan(0);

    // Verify readiness Parquet file on R2
    const readinessObj = await env.DATA_LAKE.head("oura/daily_readiness/2026-03-11.parquet");
    expect(readinessObj).not.toBeNull();
    expect(readinessObj!.size).toBeGreaterThan(0);
  });

  it("syncs heart rate data to R2 Parquet", async () => {
    await insertTestToken();
    await env.DB.prepare(
      "UPDATE sync_state SET last_sync_at = '2026-03-10' WHERE id = 'oura'"
    ).run();

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_sleep/ })
      .reply(200, { data: [], next_token: null });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_activity/ })
      .reply(200, { data: [], next_token: null });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_readiness/ })
      .reply(200, { data: [], next_token: null });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/heartrate/ })
      .reply(200, {
        data: [
          { bpm: 65, source: "awake", timestamp: "2026-03-11T10:00:00+00:00" },
          { bpm: 58, source: "rest", timestamp: "2026-03-11T03:00:00+00:00" },
        ],
        next_token: null,
      });

    const res = await SELF.fetch("https://example.com/oura/sync", { method: "POST" });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { success: boolean; count: number };
    expect(json.count).toBe(2);

    // Verify heart rate Parquet file on R2
    const hrObj = await env.DATA_LAKE.head("oura/heart_rate/2026-03-11.parquet");
    expect(hrObj).not.toBeNull();
    expect(hrObj!.size).toBeGreaterThan(0);
  });

  it("handles pagination with next_token", async () => {
    await insertTestToken();
    await env.DB.prepare(
      "UPDATE sync_state SET last_sync_at = '2026-03-10' WHERE id = 'oura'"
    ).run();

    // Page 1
    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_sleep(?!.*next_token)/ })
      .reply(200, {
        data: [
          {
            id: "sleep-page1",
            day: "2026-03-10",
            score: 80,
            timestamp: "2026-03-10T07:00:00+00:00",
            contributors: {
              deep_sleep: 70,
              efficiency: 80,
              latency: 75,
              rem_sleep: 65,
              restfulness: 78,
              timing: 72,
              total_sleep: 76,
            },
          },
        ],
        next_token: "page2token",
      });

    // Page 2
    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_sleep.*next_token=page2token/ })
      .reply(200, {
        data: [
          {
            id: "sleep-page2",
            day: "2026-03-11",
            score: 75,
            timestamp: "2026-03-11T07:00:00+00:00",
            contributors: {
              deep_sleep: 65,
              efficiency: 75,
              latency: 70,
              rem_sleep: 60,
              restfulness: 73,
              timing: 68,
              total_sleep: 71,
            },
          },
        ],
        next_token: null,
      });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_activity/ })
      .reply(200, { data: [], next_token: null });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_readiness/ })
      .reply(200, { data: [], next_token: null });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/heartrate/ })
      .reply(200, { data: [], next_token: null });

    const res = await SELF.fetch("https://example.com/oura/sync", { method: "POST" });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { success: boolean; count: number };
    expect(json.count).toBe(2);
  });

  it("handles missing contributors gracefully", async () => {
    await insertTestToken();
    await env.DB.prepare(
      "UPDATE sync_state SET last_sync_at = '2026-03-10' WHERE id = 'oura'"
    ).run();

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_sleep/ })
      .reply(200, {
        data: [
          {
            id: "sleep-no-contrib",
            day: "2026-03-11",
            score: null,
            timestamp: "2026-03-11T07:00:00+00:00",
          },
        ],
        next_token: null,
      });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_activity/ })
      .reply(200, {
        data: [
          {
            id: "activity-no-contrib",
            day: "2026-03-11",
            score: null,
            active_calories: 200,
            total_calories: 1800,
            steps: 5000,
            equivalent_walking_distance: 4000,
            high_activity_time: 0,
            medium_activity_time: 1800,
            low_activity_time: 3600,
            sedentary_time: 30000,
            resting_time: 28800,
            average_met_minutes: 1.2,
            timestamp: "2026-03-11T23:59:59+00:00",
          },
        ],
        next_token: null,
      });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/daily_readiness/ })
      .reply(200, {
        data: [
          {
            id: "readiness-no-contrib",
            day: "2026-03-11",
            score: null,
            temperature_deviation: null,
            temperature_trend_deviation: null,
            timestamp: "2026-03-11T07:00:00+00:00",
          },
        ],
        next_token: null,
      });

    fetchMock
      .get("https://api.ouraring.com")
      .intercept({ path: /\/v2\/usercollection\/heartrate/ })
      .reply(200, { data: [], next_token: null });

    const res = await SELF.fetch("https://example.com/oura/sync", { method: "POST" });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { success: boolean; count: number };
    expect(json.success).toBe(true);
    expect(json.count).toBe(3);

    // Verify Parquet files written even with null contributors
    const sleepObj = await env.DATA_LAKE.head("oura/daily_sleep/2026-03-11.parquet");
    expect(sleepObj).not.toBeNull();

    const activityObj = await env.DATA_LAKE.head("oura/daily_activity/2026-03-11.parquet");
    expect(activityObj).not.toBeNull();

    const readinessObj = await env.DATA_LAKE.head("oura/daily_readiness/2026-03-11.parquet");
    expect(readinessObj).not.toBeNull();
  });

  it("returns 401 when not authenticated", async () => {
    // Remove token
    await env.DB.prepare("DELETE FROM oauth_tokens WHERE id = 'oura'").run();

    const res = await SELF.fetch("https://example.com/oura/sync", { method: "POST" });
    expect(res.status).toBe(401);

    const json = (await res.json()) as { success: boolean; message: string };
    expect(json.success).toBe(false);
    expect(json.message).toContain("not authenticated");
  });
});

describe("oura query routes", () => {
  it("returns stats on GET /oura/stats", async () => {
    const res = await SELF.fetch("https://example.com/oura/stats");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty("daily_sleep_files");
    expect(json).toHaveProperty("daily_activity_files");
    expect(json).toHaveProperty("daily_readiness_files");
    expect(json).toHaveProperty("heart_rate_files");
    expect(json).toHaveProperty("last_sync");
  });
});
