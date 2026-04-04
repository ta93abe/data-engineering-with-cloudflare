const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5" as const;

export type SearchResult = {
  id: string;
  content: string;
  contentType: string;
  score: number;
  metadata: Record<string, string> | null;
};

export async function embedText(ai: Ai, text: string): Promise<number[]> {
  const result = (await ai.run(EMBEDDING_MODEL, { text: [text] })) as { data: number[][] };
  return result.data[0];
}

export async function embedAndStore(
  ai: Ai,
  vectorize: VectorizeIndex,
  db: D1Database,
  content: string,
  contentType: string,
  metadata?: Record<string, string>
): Promise<string> {
  const id = crypto.randomUUID();
  const embedding = await embedText(ai, content);

  await vectorize.upsert([
    {
      id,
      values: embedding,
      metadata: { content_type: contentType, ...metadata },
    },
  ]);

  await db
    .prepare(
      "INSERT INTO agent_knowledge_base (id, content, content_type, metadata_json, vector_id) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(id, content, contentType, metadata ? JSON.stringify(metadata) : null, id)
    .run();

  return id;
}

export async function semanticSearch(
  ai: Ai,
  vectorize: VectorizeIndex,
  db: D1Database,
  query: string,
  topK = 5
): Promise<SearchResult[]> {
  const queryEmbedding = await embedText(ai, query);
  const matches = await vectorize.query(queryEmbedding, {
    topK,
    returnMetadata: "all",
  });

  if (!matches.matches.length) {
    return [];
  }

  const ids = matches.matches.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT id, content, content_type, metadata_json FROM agent_knowledge_base WHERE id IN (${placeholders})`
    )
    .bind(...ids)
    .all<{ id: string; content: string; content_type: string; metadata_json: string | null }>();

  const contentMap = new Map(rows.results.map((r) => [r.id, r]));

  return matches.matches
    .filter((m) => m.score > 0.6)
    .map((m) => {
      const row = contentMap.get(m.id);
      return {
        id: m.id,
        content: row?.content ?? "",
        contentType: row?.content_type ?? "",
        score: m.score,
        metadata: row?.metadata_json ? JSON.parse(row.metadata_json) : null,
      };
    });
}
