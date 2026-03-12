import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  encodeDailyActivity,
  encodeDailyReadiness,
  encodeDailySleep,
  encodeHeartRate,
  initParquetWasm,
} from "../services/parquet";

beforeAll(() => {
  const wasmPath = resolve(__dirname, "../../node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);
  initParquetWasm(wasmBytes);
});

function expectParquetMagic(buffer: Uint8Array) {
  expect(buffer).toBeInstanceOf(Uint8Array);
  expect(buffer.length).toBeGreaterThan(0);
  // Parquet magic bytes: PAR1
  expect(buffer[0]).toBe(0x50); // P
  expect(buffer[1]).toBe(0x41); // A
  expect(buffer[2]).toBe(0x52); // R
  expect(buffer[3]).toBe(0x31); // 1
}

describe("encodeDailySleep", () => {
  it("should encode sleep data to valid Parquet", async () => {
    const data = [
      {
        day: "2026-03-12",
        score: 85,
        deep_sleep: 70,
        efficiency: 90,
        latency: 80,
        rem_sleep: 75,
        restfulness: 88,
        timing: 92,
        total_sleep: 82,
        timestamp: "2026-03-12T07:00:00+00:00",
        synced_at: "2026-03-12T09:00:00Z",
      },
    ];
    const buffer = await encodeDailySleep(data);
    expectParquetMagic(buffer);
  });

  it("should handle nullable fields", async () => {
    const data = [
      {
        day: "2026-03-12",
        score: null,
        deep_sleep: null,
        efficiency: null,
        latency: null,
        rem_sleep: null,
        restfulness: null,
        timing: null,
        total_sleep: null,
        timestamp: "2026-03-12T07:00:00+00:00",
        synced_at: "2026-03-12T09:00:00Z",
      },
    ];
    const buffer = await encodeDailySleep(data);
    expectParquetMagic(buffer);
  });
});

describe("encodeDailyActivity", () => {
  it("should encode activity data to valid Parquet", async () => {
    const data = [
      {
        day: "2026-03-12",
        score: 90,
        active_calories: 450,
        total_calories: 2200,
        steps: 8500,
        equivalent_walking_distance: 6500.5,
        high_activity_time: 1800,
        medium_activity_time: 3600,
        low_activity_time: 7200,
        sedentary_time: 28800,
        resting_time: 32400,
        met_average: 1.8,
        meet_daily_targets: 80,
        move_every_hour: 75,
        recovery_time: 85,
        stay_active: 70,
        training_frequency: 60,
        training_volume: 65,
        timestamp: "2026-03-12T23:59:59+00:00",
        synced_at: "2026-03-13T00:05:00Z",
      },
    ];
    const buffer = await encodeDailyActivity(data);
    expectParquetMagic(buffer);
  });
});

describe("encodeDailyReadiness", () => {
  it("should encode readiness data to valid Parquet", async () => {
    const data = [
      {
        day: "2026-03-12",
        score: 88,
        temperature_deviation: 0.15,
        temperature_trend_deviation: -0.05,
        activity_balance: 80,
        body_temperature: 85,
        hrv_balance: 78,
        previous_day_activity: 90,
        previous_night: 88,
        recovery_index: 82,
        resting_heart_rate: 75,
        sleep_balance: 86,
        timestamp: "2026-03-12T07:00:00+00:00",
        synced_at: "2026-03-12T09:00:00Z",
      },
    ];
    const buffer = await encodeDailyReadiness(data);
    expectParquetMagic(buffer);
  });
});

describe("encodeHeartRate", () => {
  it("should encode heart rate data to valid Parquet", async () => {
    const data = [
      {
        bpm: 72,
        source: "awake",
        timestamp: "2026-03-12T10:00:00+00:00",
        day: "2026-03-12",
        synced_at: "2026-03-12T12:00:00Z",
      },
      {
        bpm: 65,
        source: "rest",
        timestamp: "2026-03-12T10:05:00+00:00",
        day: "2026-03-12",
        synced_at: "2026-03-12T12:00:00Z",
      },
    ];
    const buffer = await encodeHeartRate(data);
    expectParquetMagic(buffer);
  });
});
