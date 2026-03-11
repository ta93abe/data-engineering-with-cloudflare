export const D1_SCHEMA = `
-- ============ Oura Ring データ ============

-- oura_daily_sleep: 日別睡眠データ
--   id TEXT PK, day TEXT (YYYY-MM-DD), score INTEGER (睡眠スコア 0-100)
--   deep_sleep INTEGER, efficiency INTEGER, latency INTEGER
--   rem_sleep INTEGER, restfulness INTEGER, timing INTEGER, total_sleep INTEGER

-- oura_daily_activity: 日別活動データ
--   id TEXT PK, day TEXT, score INTEGER (活動スコア 0-100)
--   active_calories INTEGER, total_calories INTEGER, steps INTEGER
--   high_activity_time INTEGER, medium_activity_time INTEGER
--   low_activity_time INTEGER, sedentary_time INTEGER, resting_time INTEGER
--   met_average REAL

-- oura_daily_readiness: 日別コンディション
--   id TEXT PK, day TEXT, score INTEGER (コンディションスコア 0-100)
--   temperature_deviation REAL, temperature_trend_deviation REAL
--   activity_balance INTEGER, body_temperature INTEGER
--   hrv_balance INTEGER, previous_day_activity INTEGER
--   previous_night INTEGER, recovery_index INTEGER
--   resting_heart_rate INTEGER, sleep_balance INTEGER

-- oura_heart_rate: 心拍数 (5分間隔、1日約288レコード)
--   id INTEGER PK, bpm INTEGER, source TEXT, timestamp TEXT, day TEXT

-- v_oura_daily_summary: Oura日次サマリービュー (集計済み)
--   day, sleep_score, activity_score, readiness_score
--   steps, total_calories, active_calories
--   temperature_deviation
--   sleep_deep_sleep, sleep_efficiency, sleep_total_sleep

-- 注意: 日付は TEXT 型 (ISO 8601)。SQLite の date() / strftime() を使うこと。
`;
