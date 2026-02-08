-- ============================================
-- OAuth2 Token Storage
-- ============================================

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

-- ============================================
-- Oura Ring Tables
-- ============================================

-- Daily Sleep
CREATE TABLE IF NOT EXISTS oura_daily_sleep (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL UNIQUE,
    score INTEGER,
    timestamp TEXT,
    -- contributors
    deep_sleep INTEGER,
    efficiency INTEGER,
    latency INTEGER,
    rem_sleep INTEGER,
    restfulness INTEGER,
    timing INTEGER,
    total_sleep INTEGER,
    synced_at TEXT DEFAULT (datetime('now'))
);

-- Daily Activity
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
    -- contributors
    meet_daily_targets INTEGER,
    move_every_hour INTEGER,
    recovery_time INTEGER,
    stay_active INTEGER,
    training_frequency INTEGER,
    training_volume INTEGER,
    timestamp TEXT,
    synced_at TEXT DEFAULT (datetime('now'))
);

-- Daily Readiness
CREATE TABLE IF NOT EXISTS oura_daily_readiness (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL UNIQUE,
    score INTEGER,
    temperature_deviation REAL,
    temperature_trend_deviation REAL,
    timestamp TEXT,
    -- contributors
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

-- Heart Rate (high volume: ~288 records/day at 5min intervals)
CREATE TABLE IF NOT EXISTS oura_heart_rate (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bpm INTEGER NOT NULL,
    source TEXT,
    timestamp TEXT NOT NULL,
    day TEXT NOT NULL,
    synced_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- Oura Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_oura_daily_sleep_day ON oura_daily_sleep(day DESC);
CREATE INDEX IF NOT EXISTS idx_oura_daily_activity_day ON oura_daily_activity(day DESC);
CREATE INDEX IF NOT EXISTS idx_oura_daily_readiness_day ON oura_daily_readiness(day DESC);
CREATE INDEX IF NOT EXISTS idx_oura_heart_rate_day ON oura_heart_rate(day DESC);
CREATE INDEX IF NOT EXISTS idx_oura_heart_rate_timestamp ON oura_heart_rate(timestamp DESC);

-- ============================================
-- Oura Views
-- ============================================

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

-- ============================================
-- Initial Data
-- ============================================

INSERT OR IGNORE INTO data_sources (id, name, source_type, api_endpoint, schedule_cron)
VALUES ('oura', 'Oura Ring', 'api', 'https://api.ouraring.com', '0 0 * * *');

INSERT OR IGNORE INTO sync_state (id, data_source_id, last_sync_at)
VALUES ('oura', 'oura', NULL);
