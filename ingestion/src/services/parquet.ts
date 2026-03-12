import { tableFromArrays, tableToIPC } from "apache-arrow";
import { initSync, Table as WasmTable, writeParquet } from "parquet-wasm/esm";

// ============================================
// Types — flattened row types for Parquet
// ============================================

export interface DailySleepRow {
  day: string;
  score: number | null;
  deep_sleep: number | null;
  efficiency: number | null;
  latency: number | null;
  rem_sleep: number | null;
  restfulness: number | null;
  timing: number | null;
  total_sleep: number | null;
  timestamp: string;
  synced_at: string;
}

export interface DailyActivityRow {
  day: string;
  score: number | null;
  active_calories: number | null;
  total_calories: number | null;
  steps: number | null;
  equivalent_walking_distance: number | null;
  high_activity_time: number | null;
  medium_activity_time: number | null;
  low_activity_time: number | null;
  sedentary_time: number | null;
  resting_time: number | null;
  met_average: number | null;
  meet_daily_targets: number | null;
  move_every_hour: number | null;
  recovery_time: number | null;
  stay_active: number | null;
  training_frequency: number | null;
  training_volume: number | null;
  timestamp: string;
  synced_at: string;
}

export interface DailyReadinessRow {
  day: string;
  score: number | null;
  temperature_deviation: number | null;
  temperature_trend_deviation: number | null;
  activity_balance: number | null;
  body_temperature: number | null;
  hrv_balance: number | null;
  previous_day_activity: number | null;
  previous_night: number | null;
  recovery_index: number | null;
  resting_heart_rate: number | null;
  sleep_balance: number | null;
  timestamp: string;
  synced_at: string;
}

export interface HeartRateRow {
  bpm: number;
  source: string;
  timestamp: string;
  day: string;
  synced_at: string;
}

// ============================================
// WASM initialization
// ============================================

let wasmInitialized = false;

/**
 * Initialize parquet-wasm synchronously with a pre-loaded WASM module.
 * In Workers: call with the imported .wasm module.
 * In tests: call with the WASM bytes loaded via fs.readFileSync.
 */
export function initParquetWasm(wasmModule: BufferSource | WebAssembly.Module): void {
  if (wasmInitialized) return;
  initSync({ module: wasmModule });
  wasmInitialized = true;
}

function ensureWasmInit(): void {
  if (!wasmInitialized) {
    throw new Error("parquet-wasm not initialized. Call initParquetWasm() first.");
  }
}

// ============================================
// Column extraction helpers
// ============================================

function extractColumn<T, K extends keyof T>(rows: T[], key: K): T[K][] {
  return rows.map((r) => r[key]);
}

// ============================================
// Encode functions
// ============================================

function arrowToParquet(columns: Record<string, unknown[]>): Uint8Array {
  const arrowTable = tableFromArrays(columns);
  const ipcBytes = tableToIPC(arrowTable, "stream");
  const wasmTable = WasmTable.fromIPCStream(ipcBytes);
  return writeParquet(wasmTable);
}

export async function encodeDailySleep(rows: DailySleepRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    day: extractColumn(rows, "day"),
    score: extractColumn(rows, "score"),
    deep_sleep: extractColumn(rows, "deep_sleep"),
    efficiency: extractColumn(rows, "efficiency"),
    latency: extractColumn(rows, "latency"),
    rem_sleep: extractColumn(rows, "rem_sleep"),
    restfulness: extractColumn(rows, "restfulness"),
    timing: extractColumn(rows, "timing"),
    total_sleep: extractColumn(rows, "total_sleep"),
    timestamp: extractColumn(rows, "timestamp"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}

export async function encodeDailyActivity(rows: DailyActivityRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    day: extractColumn(rows, "day"),
    score: extractColumn(rows, "score"),
    active_calories: extractColumn(rows, "active_calories"),
    total_calories: extractColumn(rows, "total_calories"),
    steps: extractColumn(rows, "steps"),
    equivalent_walking_distance: extractColumn(rows, "equivalent_walking_distance"),
    high_activity_time: extractColumn(rows, "high_activity_time"),
    medium_activity_time: extractColumn(rows, "medium_activity_time"),
    low_activity_time: extractColumn(rows, "low_activity_time"),
    sedentary_time: extractColumn(rows, "sedentary_time"),
    resting_time: extractColumn(rows, "resting_time"),
    met_average: extractColumn(rows, "met_average"),
    meet_daily_targets: extractColumn(rows, "meet_daily_targets"),
    move_every_hour: extractColumn(rows, "move_every_hour"),
    recovery_time: extractColumn(rows, "recovery_time"),
    stay_active: extractColumn(rows, "stay_active"),
    training_frequency: extractColumn(rows, "training_frequency"),
    training_volume: extractColumn(rows, "training_volume"),
    timestamp: extractColumn(rows, "timestamp"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}

export async function encodeDailyReadiness(rows: DailyReadinessRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    day: extractColumn(rows, "day"),
    score: extractColumn(rows, "score"),
    temperature_deviation: extractColumn(rows, "temperature_deviation"),
    temperature_trend_deviation: extractColumn(rows, "temperature_trend_deviation"),
    activity_balance: extractColumn(rows, "activity_balance"),
    body_temperature: extractColumn(rows, "body_temperature"),
    hrv_balance: extractColumn(rows, "hrv_balance"),
    previous_day_activity: extractColumn(rows, "previous_day_activity"),
    previous_night: extractColumn(rows, "previous_night"),
    recovery_index: extractColumn(rows, "recovery_index"),
    resting_heart_rate: extractColumn(rows, "resting_heart_rate"),
    sleep_balance: extractColumn(rows, "sleep_balance"),
    timestamp: extractColumn(rows, "timestamp"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}

export async function encodeHeartRate(rows: HeartRateRow[]): Promise<Uint8Array> {
  ensureWasmInit();
  return arrowToParquet({
    bpm: extractColumn(rows, "bpm"),
    source: extractColumn(rows, "source"),
    timestamp: extractColumn(rows, "timestamp"),
    day: extractColumn(rows, "day"),
    synced_at: extractColumn(rows, "synced_at"),
  });
}
