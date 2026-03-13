import { describe, expect, it, vi } from "vitest";
import {
  encodeDailyActivity,
  encodeDailyReadiness,
  encodeDailySleep,
  encodeGitHubCommit,
  encodeGitHubRepo,
  encodeGitHubUser,
  encodeHeartRate,
  encodeLinearIssue,
  encodeLinearLabel,
  encodeLinearProject,
  encodeWithingsActivity,
  encodeWithingsMeasure,
  encodeWithingsSleep,
} from "../services/parquet";

// Parquet magic bytes: PAR1
const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31]);

/** Create a mock Fetcher that returns fake Parquet bytes and captures the request. */
function createMockEncoder() {
  let capturedBody: { schema: string; rows: unknown[] } | null = null;
  const encoder = {
    fetch: vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      // Return fake Parquet bytes (PAR1 header + padding + PAR1 footer)
      const buf = new Uint8Array(12);
      buf.set(PARQUET_MAGIC, 0);
      buf.set(PARQUET_MAGIC, 8);
      return new Response(buf, { status: 200 });
    }),
  } as unknown as Fetcher;
  return { encoder, getCapturedBody: () => capturedBody };
}

describe("encodeDailySleep", () => {
  it("should call encoder with correct schema and rows", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
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
    const buffer = await encodeDailySleep(encoder, data);
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(0);
    expect(getCapturedBody()?.schema).toBe("oura_daily_sleep");
    expect(getCapturedBody()?.rows).toHaveLength(1);
  });

  it("should handle nullable fields", async () => {
    const { encoder } = createMockEncoder();
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
    const buffer = await encodeDailySleep(encoder, data);
    expect(buffer).toBeInstanceOf(Uint8Array);
  });
});

describe("encodeDailyActivity", () => {
  it("should call encoder with correct schema", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
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
    await encodeDailyActivity(encoder, data);
    expect(getCapturedBody()?.schema).toBe("oura_daily_activity");
  });
});

describe("encodeDailyReadiness", () => {
  it("should call encoder with correct schema", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
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
    await encodeDailyReadiness(encoder, data);
    expect(getCapturedBody()?.schema).toBe("oura_daily_readiness");
  });
});

describe("encodeHeartRate", () => {
  it("should call encoder with correct schema", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
    const data = [
      {
        bpm: 72,
        source: "awake",
        timestamp: "2026-03-12T10:00:00+00:00",
        day: "2026-03-12",
        synced_at: "2026-03-12T12:00:00Z",
      },
    ];
    await encodeHeartRate(encoder, data);
    expect(getCapturedBody()?.schema).toBe("oura_heart_rate");
  });
});

// ============================================
// GitHub encoders
// ============================================

describe("encodeGitHubUser", () => {
  it("should call encoder with correct schema and rows", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
    const data = [
      {
        id: 1,
        login: "octocat",
        name: "The Octocat",
        avatar_url: "https://avatars.githubusercontent.com/u/1",
        synced_at: "2026-03-12T09:00:00Z",
      },
    ];
    await encodeGitHubUser(encoder, data);
    expect(getCapturedBody()?.schema).toBe("github_user");
    expect(getCapturedBody()?.rows).toHaveLength(1);
  });

  it("should handle nullable name", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
    const data = [
      {
        id: 2,
        login: "ghost",
        name: null,
        avatar_url: "https://avatars.githubusercontent.com/u/2",
        synced_at: "2026-03-12T09:00:00Z",
      },
    ];
    await encodeGitHubUser(encoder, data);
    expect(getCapturedBody()?.rows[0]).toHaveProperty("name", null);
  });
});

describe("encodeGitHubRepo", () => {
  it("should call encoder with correct schema", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
    const data = [
      {
        id: 100,
        owner_id: 1,
        name: "hello-world",
        full_name: "octocat/hello-world",
        description: "My first repo",
        language: "TypeScript",
        stars: 42,
        forks: 5,
        is_private: 0,
        default_branch: "main",
        synced_at: "2026-03-12T09:00:00Z",
      },
    ];
    await encodeGitHubRepo(encoder, data);
    expect(getCapturedBody()?.schema).toBe("github_repo");
  });

  it("should handle nullable fields", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
    const data = [
      {
        id: 101,
        owner_id: 1,
        name: "empty-repo",
        full_name: "octocat/empty-repo",
        description: null,
        language: null,
        stars: 0,
        forks: 0,
        is_private: 1,
        default_branch: "main",
        synced_at: "2026-03-12T09:00:00Z",
      },
    ];
    await encodeGitHubRepo(encoder, data);
    expect(getCapturedBody()?.rows[0]).toHaveProperty("description", null);
  });
});

describe("encodeGitHubCommit", () => {
  it("should call encoder with correct schema", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
    const data = [
      {
        sha: "abc123def456",
        repo_id: 100,
        repo_full_name: "octocat/hello-world",
        message: "Initial commit",
        author_name: "The Octocat",
        author_email: "octocat@github.com",
        author_date: "2026-03-12T10:00:00Z",
        day: "2026-03-12",
        synced_at: "2026-03-12T12:00:00Z",
      },
    ];
    await encodeGitHubCommit(encoder, data);
    expect(getCapturedBody()?.schema).toBe("github_commit");
  });
});

// ============================================
// Linear encoders
// ============================================

describe("encodeLinearIssue", () => {
  it("should call encoder with correct schema", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
    const data = [
      {
        id: "issue-uuid-1",
        identifier: "TA-100",
        title: "Implement feature X",
        description_length: 250,
        priority: 2,
        estimate: 3,
        state_name: "In Progress",
        state_type: "started",
        label_names: "feature,frontend",
        project_name: "de-study",
        cycle_number: 5,
        assignee_name: "ta93abe",
        created_at: "2026-03-01T10:00:00Z",
        updated_at: "2026-03-12T08:00:00Z",
        started_at: "2026-03-02T09:00:00Z",
        completed_at: null,
        canceled_at: null,
        due_date: "2026-03-20",
        synced_at: "2026-03-12T09:00:00Z",
      },
    ];
    await encodeLinearIssue(encoder, data);
    expect(getCapturedBody()?.schema).toBe("linear_issue");
  });
});

describe("encodeLinearProject", () => {
  it("should call encoder with correct schema", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
    const data = [
      {
        id: "proj-uuid-1",
        name: "de-study",
        state: "started",
        progress: 0.65,
        start_date: "2026-01-01",
        target_date: "2026-06-30",
        created_at: "2025-12-15T10:00:00Z",
        updated_at: "2026-03-12T08:00:00Z",
        completed_at: null,
        synced_at: "2026-03-12T09:00:00Z",
      },
    ];
    await encodeLinearProject(encoder, data);
    expect(getCapturedBody()?.schema).toBe("linear_project");
  });
});

describe("encodeLinearLabel", () => {
  it("should call encoder with correct schema", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
    const data = [
      {
        id: "label-uuid-1",
        name: "feature",
        color: "#0088ff",
        synced_at: "2026-03-12T09:00:00Z",
      },
    ];
    await encodeLinearLabel(encoder, data);
    expect(getCapturedBody()?.schema).toBe("linear_label");
  });
});

// ============================================
// Withings encoders
// ============================================

describe("encodeWithingsMeasure", () => {
  it("should call encoder with correct schema", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
    const data = [
      {
        grpid: 12345,
        date: "2026-03-12",
        timestamp: 1773504000,
        weight: 72.5,
        fat_ratio: 18.2,
        fat_mass: 13.2,
        fat_free_mass: 59.3,
        muscle_mass: 56.1,
        bone_mass: 3.2,
        hydration: 55.0,
        heart_pulse: 68,
        synced_at: "2026-03-12T09:00:00Z",
      },
    ];
    await encodeWithingsMeasure(encoder, data);
    expect(getCapturedBody()?.schema).toBe("withings_measure");
  });
});

describe("encodeWithingsSleep", () => {
  it("should call encoder with correct schema", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
    const data = [
      {
        date: "2026-03-12",
        startdate: 1773462000,
        enddate: 1773490800,
        total_sleep_duration: 28800,
        deep_sleep_duration: 7200,
        light_sleep_duration: 14400,
        rem_sleep_duration: 5400,
        wakeup_duration: 1800,
        sleep_score: 82,
        sleep_efficiency: 91,
        sleep_latency: 600,
        hr_average: 58,
        hr_min: 48,
        hr_max: 72,
        rr_average: 15,
        rr_min: 12,
        rr_max: 18,
        snoring: 120,
        snoring_episode_count: 3,
        synced_at: "2026-03-12T09:00:00Z",
      },
    ];
    await encodeWithingsSleep(encoder, data);
    expect(getCapturedBody()?.schema).toBe("withings_sleep");
  });
});

describe("encodeWithingsActivity", () => {
  it("should call encoder with correct schema", async () => {
    const { encoder, getCapturedBody } = createMockEncoder();
    const data = [
      {
        date: "2026-03-12",
        steps: 10500,
        distance: 7800.5,
        elevation: 45.2,
        soft: 3600,
        moderate: 1800,
        intense: 900,
        active: 6300,
        calories: 450.5,
        total_calories: 2200.0,
        hr_average: 75,
        hr_min: 52,
        hr_max: 145,
        synced_at: "2026-03-12T23:59:00Z",
      },
    ];
    await encodeWithingsActivity(encoder, data);
    expect(getCapturedBody()?.schema).toBe("withings_activity");
  });
});

describe("error handling", () => {
  it("should throw on non-OK response from encoder", async () => {
    const encoder = {
      fetch: vi.fn(async () => new Response("Unknown schema: bad", { status: 400 })),
    } as unknown as Fetcher;

    await expect(encodeDailySleep(encoder, [])).rejects.toThrow("parquet-encoder error (400)");
  });
});
