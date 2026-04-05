import { beforeEach, describe, expect, it, vi } from "vitest";
import { embedAndStore, embedText, semanticSearch } from "./embeddings";

// --- テストヘルパー: モック生成 ---

function createMockAi(embedding: number[] = [0.1, 0.2, 0.3]): Ai {
  return {
    run: vi.fn().mockResolvedValue({ data: [embedding] }),
  } as unknown as Ai;
}

function createMockVectorize(matches: Array<{ id: string; score: number }> = []): VectorizeIndex {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ matches }),
  } as unknown as VectorizeIndex;
}

function createMockDb(
  results: unknown[] = []
): D1Database & { _prepareArgs: string[]; _bindArgs: unknown[][] } {
  const bindArgs: unknown[][] = [];
  const prepareArgs: string[] = [];
  const mockStmt = {
    bind: vi.fn((...args: unknown[]) => {
      bindArgs.push(args);
      return mockStmt;
    }),
    run: vi.fn().mockResolvedValue({ success: true }),
    all: vi.fn().mockResolvedValue({ results }),
  };
  return {
    prepare: vi.fn((sql: string) => {
      prepareArgs.push(sql);
      return mockStmt;
    }),
    _prepareArgs: prepareArgs,
    _bindArgs: bindArgs,
  } as unknown as D1Database & { _prepareArgs: string[]; _bindArgs: unknown[][] };
}

// --- テスト本体 ---

describe("embedText", () => {
  it("Workers AIの埋め込みモデルを呼び出して結果を返す", async () => {
    const expectedEmbedding = [0.1, 0.2, 0.3];
    const ai = createMockAi(expectedEmbedding);

    const result = await embedText(ai, "テストテキスト");

    expect(result).toEqual(expectedEmbedding);
    expect(ai.run).toHaveBeenCalledWith("@cf/baai/bge-m3", {
      text: ["テストテキスト"],
    });
  });

  it("空文字列でも呼び出し可能", async () => {
    const ai = createMockAi([0, 0, 0]);

    const result = await embedText(ai, "");

    expect(result).toEqual([0, 0, 0]);
  });
});

describe("embedAndStore", () => {
  let ai: Ai;
  let vectorize: VectorizeIndex;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    ai = createMockAi([0.5, 0.6, 0.7]);
    vectorize = createMockVectorize();
    db = createMockDb();
    vi.stubGlobal("crypto", {
      randomUUID: () => "test-uuid-1234",
    });
  });

  it("埋め込みを生成してVectorizeに保存し、D1にメタデータを記録する", async () => {
    const id = await embedAndStore(ai, vectorize, db, "インサイト内容", "insight", {
      day: "2026-04-03",
    });

    // UUIDを返す
    expect(id).toBe("test-uuid-1234");

    // Vectorizeにupsertされる
    expect(vectorize.upsert).toHaveBeenCalledWith([
      {
        id: "test-uuid-1234",
        values: [0.5, 0.6, 0.7],
        metadata: { content_type: "insight", day: "2026-04-03" },
      },
    ]);

    // D1にINSERTされる
    expect(db._prepareArgs[0]).toContain("INSERT INTO agent_knowledge_base");
    expect(db._bindArgs[0]).toEqual([
      "test-uuid-1234",
      "インサイト内容",
      "insight",
      '{"day":"2026-04-03"}',
      "test-uuid-1234",
    ]);
  });

  it("metadataがundefinedの場合、D1にはnullが保存される", async () => {
    await embedAndStore(ai, vectorize, db, "content", "pattern");

    expect(db._bindArgs[0][3]).toBeNull();
  });
});

describe("semanticSearch", () => {
  it("Vectorize検索結果をD1と結合して返す", async () => {
    const ai = createMockAi([0.1, 0.2, 0.3]);
    const vectorize = createMockVectorize([
      { id: "vec-1", score: 0.95 },
      { id: "vec-2", score: 0.8 },
    ]);
    const db = createMockDb([
      { id: "vec-1", content: "高スコアの結果", content_type: "insight", metadata_json: null },
      {
        id: "vec-2",
        content: "中スコアの結果",
        content_type: "weekly_summary",
        metadata_json: '{"period":"2026-W14"}',
      },
    ]);

    const results = await semanticSearch(ai, vectorize, db, "検索クエリ", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: "vec-1",
      content: "高スコアの結果",
      contentType: "insight",
      score: 0.95,
      metadata: null,
    });
    expect(results[1]).toEqual({
      id: "vec-2",
      content: "中スコアの結果",
      contentType: "weekly_summary",
      score: 0.8,
      metadata: { period: "2026-W14" },
    });
  });

  it("スコアが0.6以下の結果をフィルタリングする", async () => {
    const ai = createMockAi();
    const vectorize = createMockVectorize([
      { id: "high", score: 0.9 },
      { id: "low", score: 0.5 },
    ]);
    const db = createMockDb([
      { id: "high", content: "関連あり", content_type: "insight", metadata_json: null },
      { id: "low", content: "関連薄い", content_type: "insight", metadata_json: null },
    ]);

    const results = await semanticSearch(ai, vectorize, db, "query");

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("high");
  });

  it("Vectorizeから結果がない場合、空配列を返す", async () => {
    const ai = createMockAi();
    const vectorize = createMockVectorize([]);
    const db = createMockDb();

    const results = await semanticSearch(ai, vectorize, db, "存在しないトピック");

    expect(results).toEqual([]);
    // D1は呼ばれない
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("topKパラメータをVectorizeに渡す", async () => {
    const ai = createMockAi();
    const vectorize = createMockVectorize([]);
    const db = createMockDb();

    await semanticSearch(ai, vectorize, db, "query", 3);

    expect(vectorize.query).toHaveBeenCalledWith([0.1, 0.2, 0.3], {
      topK: 3,
      returnMetadata: "all",
    });
  });
});
