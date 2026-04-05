import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Env } from "./types";

// モジュールモック
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));
vi.mock("workers-ai-provider", () => ({
  createWorkersAI: () => (model: string) => ({ modelId: model }),
}));
vi.mock("./embeddings", () => ({
  embedAndStore: vi.fn().mockResolvedValue("vec-report-id"),
}));

import { generateText } from "ai";
import { embedAndStore } from "./embeddings";
import { generateHealthReport, listReports } from "./reports";

function createMockEnv(dbResults: unknown[] = []): Env {
  const mockStmt = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: dbResults }),
    run: vi.fn().mockResolvedValue({ success: true }),
  };
  return {
    AI: {} as Ai,
    DB: { prepare: vi.fn().mockReturnValue(mockStmt) } as unknown as D1Database,
    VECTORIZE: {} as VectorizeIndex,
    DATA_LAKE: {
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket,
    DataAgent: {} as DurableObjectNamespace,
    SLACK_BOT_TOKEN: "",
    SLACK_SIGNING_SECRET: "",
  };
}

describe("generateHealthReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "report-uuid-1" });
    (generateText as Mock)
      .mockResolvedValueOnce({ text: "# レポート本文\n詳細な分析..." })
      .mockResolvedValueOnce({ text: "週間サマリー要約" });
  });

  it("D1からデータを取得し、レポート生成→D1記録→R2保存→埋め込みの順で実行する", async () => {
    const env = createMockEnv([
      {
        day: "2026-03-28",
        sleep_score: 80,
        activity_score: 70,
        readiness_score: 85,
        steps: 8000,
        total_calories: 2100,
        active_calories: 500,
        temperature_deviation: 0.1,
        sleep_deep_sleep: 90,
        sleep_efficiency: 88,
        sleep_total_sleep: 420,
      },
    ]);

    const result = await generateHealthReport(env, "weekly_health", "2026-03-28", "2026-04-03");

    // 返り値の検証
    expect(result.id).toBe("report-uuid-1");
    expect(result.title).toContain("週次");
    expect(result.r2Key).toMatch(/^reports\/weekly_health\/2026-03-28_2026-04-03_.+\.md$/);
    expect(result.summary).toBe("週間サマリー要約");

    // R2に保存されている
    expect(env.DATA_LAKE.put).toHaveBeenCalledWith(
      expect.stringMatching(/^reports\/weekly_health\/2026-03-28_2026-04-03_.+\.md$/),
      "# レポート本文\n詳細な分析...",
      expect.objectContaining({
        customMetadata: expect.objectContaining({
          report_id: "report-uuid-1",
          type: "weekly_health",
        }),
      })
    );

    // Vectorizeに埋め込まれている
    expect(embedAndStore).toHaveBeenCalledWith(
      env.AI,
      env.VECTORIZE,
      env.DB,
      "週間サマリー要約",
      "report",
      expect.objectContaining({
        report_id: "report-uuid-1",
        period_start: "2026-03-28",
        period_end: "2026-04-03",
      })
    );
  });

  it("データがない期間を指定するとエラーをスローする", async () => {
    const env = createMockEnv([]);

    await expect(
      generateHealthReport(env, "weekly_health", "2020-01-01", "2020-01-07")
    ).rejects.toThrow("データが見つかりません");
  });

  it("月次レポートのタイトルに「月次」が含まれる", async () => {
    const env = createMockEnv([{ day: "2026-03-01" }]);

    const result = await generateHealthReport(env, "monthly_health", "2026-03-01", "2026-03-31");

    expect(result.title).toContain("月次");
  });
});

describe("listReports", () => {
  it("タイプ指定なしで全レポートを取得する", async () => {
    const mockStmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({
        results: [
          {
            id: "r1",
            report_type: "weekly_health",
            title: "週次レポート",
            period_start: "2026-03-28",
            period_end: "2026-04-03",
            summary: "要約",
            created_at: "2026-04-04",
          },
        ],
      }),
    };
    const db = { prepare: vi.fn().mockReturnValue(mockStmt) } as unknown as D1Database;

    const result = await listReports(db, undefined, 10);

    expect(result.results).toHaveLength(1);
    expect(mockStmt.bind).toHaveBeenCalledWith(10);
  });

  it("タイプ指定ありでフィルタリングする", async () => {
    const mockStmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    const db = { prepare: vi.fn().mockReturnValue(mockStmt) } as unknown as D1Database;

    await listReports(db, "monthly_health", 5);

    expect(mockStmt.bind).toHaveBeenCalledWith("monthly_health", 5);
  });
});
