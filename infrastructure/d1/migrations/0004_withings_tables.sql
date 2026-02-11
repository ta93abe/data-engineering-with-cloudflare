-- =============================================
-- Withings Health Data Tables
-- =============================================

-- Body composition measurements (weight, fat, muscle, etc.)
CREATE TABLE IF NOT EXISTS withings_measures (
  grpid     INTEGER PRIMARY KEY,
  date      TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  weight        REAL,
  fat_ratio     REAL,
  fat_mass      REAL,
  fat_free_mass REAL,
  muscle_mass   REAL,
  bone_mass     REAL,
  hydration     REAL,
  heart_pulse   INTEGER,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_withings_measures_date ON withings_measures(date DESC);

-- Sleep summary
CREATE TABLE IF NOT EXISTS withings_sleep (
  id        TEXT PRIMARY KEY,
  date      TEXT NOT NULL,
  startdate INTEGER NOT NULL,
  enddate   INTEGER NOT NULL,
  total_sleep_duration  INTEGER,
  deep_sleep_duration   INTEGER,
  light_sleep_duration  INTEGER,
  rem_sleep_duration    INTEGER,
  wakeup_duration       INTEGER,
  sleep_score           INTEGER,
  sleep_efficiency      REAL,
  sleep_latency         INTEGER,
  hr_average  REAL,
  hr_min      INTEGER,
  hr_max      INTEGER,
  rr_average  REAL,
  rr_min      REAL,
  rr_max      REAL,
  snoring               INTEGER,
  snoring_episode_count INTEGER,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_withings_sleep_date ON withings_sleep(date DESC);

-- Daily activity
CREATE TABLE IF NOT EXISTS withings_activity (
  date      TEXT PRIMARY KEY,
  steps     INTEGER,
  distance  REAL,
  elevation REAL,
  soft      INTEGER,
  moderate  INTEGER,
  intense   INTEGER,
  active    INTEGER,
  calories      REAL,
  total_calories REAL,
  hr_average  REAL,
  hr_min      INTEGER,
  hr_max      INTEGER,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily summary view (measures + sleep + activity joined by date)
CREATE VIEW IF NOT EXISTS v_withings_daily_summary AS
SELECT
  COALESCE(m.date, s.date, a.date) AS date,
  m.weight,
  m.fat_ratio,
  m.fat_mass,
  m.muscle_mass,
  m.bone_mass,
  s.total_sleep_duration,
  s.deep_sleep_duration,
  s.light_sleep_duration,
  s.rem_sleep_duration,
  s.sleep_score,
  s.sleep_efficiency,
  a.steps,
  a.distance,
  a.calories,
  a.total_calories,
  a.active
FROM withings_measures m
LEFT JOIN withings_sleep s ON m.date = s.date
LEFT JOIN withings_activity a ON m.date = a.date
UNION
SELECT
  COALESCE(s.date, a.date) AS date,
  NULL, NULL, NULL, NULL, NULL,
  s.total_sleep_duration,
  s.deep_sleep_duration,
  s.light_sleep_duration,
  s.rem_sleep_duration,
  s.sleep_score,
  s.sleep_efficiency,
  a.steps,
  a.distance,
  a.calories,
  a.total_calories,
  a.active
FROM withings_sleep s
LEFT JOIN withings_activity a ON s.date = a.date
WHERE s.date NOT IN (SELECT date FROM withings_measures)
UNION
SELECT
  a.date,
  NULL, NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, NULL,
  a.steps,
  a.distance,
  a.calories,
  a.total_calories,
  a.active
FROM withings_activity a
WHERE a.date NOT IN (SELECT date FROM withings_measures)
  AND a.date NOT IN (SELECT date FROM withings_sleep);

-- Initialize sync_state for Withings
INSERT OR IGNORE INTO sync_state (id, last_sync_at, last_cursor, updated_at)
VALUES ('withings', NULL, NULL, datetime('now'));
