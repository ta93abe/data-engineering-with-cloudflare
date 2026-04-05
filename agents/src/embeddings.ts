import { EMBEDDING_MODEL } from "./models";

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

  // Write D1 first (source of truth), then Vectorize (search index)
  await db
    .prepare(
      "INSERT INTO agent_knowledge_base (id, content, content_type, metadata_json, vector_id) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(id, content, contentType, metadata ? JSON.stringify(metadata) : null, id)
    .run();

  await vectorize.upsert([
    {
      id,
      values: embedding,
      metadata: { content_type: contentType, ...metadata },
    },
  ]);

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

  // Filter by score before D1 query to avoid unnecessary reads
  const relevantMatches = matches.matches.filter((m) => m.score > 0.6);
  if (!relevantMatches.length) {
    return [];
  }

  const ids = relevantMatches.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT id, content, content_type, metadata_json FROM agent_knowledge_base WHERE id IN (${placeholders})`
    )
    .bind(...ids)
    .all<{ id: string; content: string; content_type: string; metadata_json: string | null }>();

  const contentMap = new Map(rows.results.map((r) => [r.id, r]));

  const results: SearchResult[] = [];
  for (const m of relevantMatches) {
    const row = contentMap.get(m.id);
    if (!row) continue;

    let metadata: Record<string, string> | null = null;
    if (row.metadata_json) {
      try {
        metadata = JSON.parse(row.metadata_json);
      } catch {
        console.error(`Failed to parse metadata_json for id=${m.id}`);
      }
    }
    results.push({
      id: m.id,
      content: row.content,
      contentType: row.content_type,
      score: m.score,
      metadata,
    });
  }
  return results;
}
