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

-- Daily summary view
-- Uses subqueries to pick the latest measure per date (avoids cartesian product)
CREATE VIEW IF NOT EXISTS v_withings_daily_summary AS
SELECT
  d.date,
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
FROM (
  SELECT date FROM withings_measures
  UNION
  SELECT date FROM withings_sleep
  UNION
  SELECT date FROM withings_activity
) d
LEFT JOIN (
  SELECT m1.*
  FROM withings_measures m1
  INNER JOIN (
    SELECT date, MAX(grpid) AS max_grpid FROM withings_measures GROUP BY date
  ) m2 ON m1.grpid = m2.max_grpid
) m ON d.date = m.date
LEFT JOIN (
  SELECT s1.*
  FROM withings_sleep s1
  INNER JOIN (
    SELECT date, MAX(id) AS max_id FROM withings_sleep GROUP BY date
  ) s2 ON s1.id = s2.max_id
) s ON d.date = s.date
LEFT JOIN withings_activity a ON d.date = a.date
ORDER BY d.date DESC;

-- =============================================
-- Initial Data
-- =============================================

INSERT OR IGNORE INTO data_sources (id, name, source_type, api_endpoint, schedule_cron)
VALUES ('withings', 'Withings', 'api', 'https://wbsapi.withings.net', '0 */12 * * *');

INSERT OR IGNORE INTO sync_state (id, data_source_id, last_sync_at)
VALUES ('withings', 'withings', NULL);
