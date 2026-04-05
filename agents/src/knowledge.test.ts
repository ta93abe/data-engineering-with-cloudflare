import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Env } from "./types";

// モジュールモック: 外部依存を制御下に置く
vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({ text: "生成されたインサイト" }),
}));
vi.mock("workers-ai-provider", () => ({
  createWorkersAI: () => (model: string) => ({ modelId: model }),
}));
vi.mock("./embeddings", () => ({
  embedAndStore: vi.fn().mockResolvedValue("vec-id-123"),
  semanticSearch: vi.fn().mockResolvedValue([]),
}));

import { generateText } from "ai";
import { embedAndStore, semanticSearch } from "./embeddings";
import { generateDailyInsight, generateWeeklySummary, retrieveRelevantContext } from "./knowledge";

function createMockEnv(dbResults: unknown[] = []): Env {
  const mockStmt = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: dbResults }),
  };
  return {
    AI: {} as Ai,
    DB: { prepare: vi.fn().mockReturnValue(mockStmt) } as unknown as D1Database,
    VECTORIZE: {} as VectorizeIndex,
    DATA_LAKE: {} as R2Bucket,
    DataAgent: {} as DurableObjectNamespace,
    SLACK_BOT_TOKEN: "",
    SLACK_SIGNING_SECRET: "",
  };
}

describe("generateDailyInsight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("前日のデータがある場合、インサイトを生成して埋め込み保存する", async () => {
    const env = createMockEnv([
      {
        day: "2026-04-03",
        sleep_score: 85,
        activity_score: 72,
        readiness_score: 90,
        steps: 8500,
        total_calories: 2200,
      },
    ]);

    const result = await generateDailyInsight(env);

    expect(result).toBe("生成されたインサイト");
    expect(generateText).toHaveBeenCalledOnce();
    expect(embedAndStore).toHaveBeenCalledWith(
      env.AI,
      env.VECTORIZE,
      env.DB,
      "生成されたインサイト",
      "insight",
      { day: "2026-04-03", source: "daily_auto" }
    );
  });

  it("前日のデータがない場合、nullを返しAI呼び出しをしない", async () => {
    const env = createMockEnv([]);

    const result = await generateDailyInsight(env);

    expect(result).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
    expect(embedAndStore).not.toHaveBeenCalled();
  });
});

describe("generateWeeklySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("過去7日分のデータがある場合、週次サマリーを生成して保存する", async () => {
    const weekData = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 2, 25 + i)); // 2026-03-25 ~ 2026-03-31
      return d;
    }).map((d, i) => ({
      day: d.toISOString().slice(0, 10),
      sleep_score: 80 + i,
      activity_score: 70 + i,
      readiness_score: 85 + i,
      steps: 7000 + i * 500,
      total_calories: 2000 + i * 100,
    }));
    const env = createMockEnv(weekData);

    const result = await generateWeeklySummary(env);

    expect(result).toBe("生成されたインサイト");
    expect(generateText).toHaveBeenCalledOnce();
    expect(embedAndStore).toHaveBeenCalledWith(
      env.AI,
      env.VECTORIZE,
      env.DB,
      "生成されたインサイト",
      "weekly_summary",
      expect.objectContaining({ source: "weekly_auto" })
    );
  });

  it("データがない場合、nullを返す", async () => {
    const env = createMockEnv([]);

    const result = await generateWeeklySummary(env);

    expect(result).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("retrieveRelevantContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("検索結果がある場合、フォーマットされたコンテキスト文字列を返す", async () => {
    (semanticSearch as Mock).mockResolvedValueOnce([
      {
        id: "1",
        content: "先週の睡眠は良好",
        contentType: "weekly_summary",
        score: 0.9,
        metadata: null,
      },
      {
        id: "2",
        content: "運動量と睡眠の相関",
        contentType: "insight",
        score: 0.8,
        metadata: null,
      },
    ]);
    const env = createMockEnv();

    const result = await retrieveRelevantContext(env, "睡眠の傾向は？", 3);

    expect(result).toBe("[weekly_summary] 先週の睡眠は良好\n\n[insight] 運動量と睡眠の相関");
    expect(semanticSearch).toHaveBeenCalledWith(env.AI, env.VECTORIZE, env.DB, "睡眠の傾向は？", 3);
  });

  it("検索結果がない場合、nullを返す", async () => {
    (semanticSearch as Mock).mockResolvedValueOnce([]);
    const env = createMockEnv();

    const result = await retrieveRelevantContext(env, "存在しないトピック");

    expect(result).toBeNull();
  });
});
