// ── Type Definitions ──────────────────────────────────────────────────────────

export interface DbtManifestColumn {
  name: string;
  description: string;
  data_type: string | null;
}

export interface DbtManifestNode {
  unique_id: string;
  name: string;
  resource_type: string;
  description: string;
  schema: string;
  database: string;
  fqn: string[];
  tags: string[];
  config: { materialized: string; [key: string]: unknown };
  depends_on: { nodes: string[]; macros: string[] };
  columns: Record<string, DbtManifestColumn>;
  path: string;
}

export interface DbtManifest {
  nodes: Record<string, DbtManifestNode>;
  metadata: { dbt_version: string; generated_at: string; project_name: string };
  child_map: Record<string, string[]>;
}

export interface DbtCatalogColumn {
  name: string;
  type: string;
  index: number;
  comment: string | null;
}

export interface DbtCatalogNode {
  unique_id: string;
  metadata: { type: string; schema: string; name: string; database: string };
  columns: Record<string, DbtCatalogColumn>;
}

export interface DbtCatalog {
  nodes: Record<string, DbtCatalogNode>;
}

// ── inferFolder ───────────────────────────────────────────────────────────────

/**
 * Maps a model's fqn to a folder path.
 * Drops the first element (project name) and last element (model name),
 * then joins remaining segments with "/".
 * Falls back to "other" if no intermediate segments remain.
 *
 * Example: ["modeling", "marts", "datavault", "facts", "fct_visits"]
 *          → "marts/datavault/facts"
 */
export function inferFolder(fqn: string[]): string {
  // Need at least 3 elements to have any intermediate segments
  if (fqn.length < 3) return "other";
  const intermediate = fqn.slice(1, -1);
  if (intermediate.length === 0) return "other";
  return intermediate.join("/");
}

// ── generateModelMarkdown ─────────────────────────────────────────────────────

/**
 * Generates a Markdown document for a single dbt model.
 *
 * - If catalogNode is provided, uses catalog columns (runtime type info)
 *   and merges descriptions from manifest columns (case-insensitive key match).
 * - If catalogNode is absent, falls back to manifest columns.
 * - Sorts catalog columns by index.
 * - Extracts the last segment after "." for each upstream dependency.
 */
export function generateModelMarkdown(
  node: DbtManifestNode,
  catalogNode: DbtCatalogNode | undefined
): string {
  const description = node.description.trim() || "説明なし";
  const tags = node.tags.length > 0 ? node.tags.join(", ") : "なし";

  // Build lowercase -> description lookup from manifest columns
  const manifestDescriptions: Record<string, string> = {};
  for (const [key, col] of Object.entries(node.columns)) {
    manifestDescriptions[key.toLowerCase()] = col.description;
  }

  // Build column rows
  let columnRows: string;
  if (catalogNode) {
    const rows = Object.values(catalogNode.columns)
      .sort((a, b) => a.index - b.index)
      .map((col) => {
        const desc = manifestDescriptions[col.name.toLowerCase()] ?? "";
        return `| ${col.name} | ${col.type} | ${desc} |`;
      });
    columnRows = rows.join("\n");
  } else {
    const rows = Object.values(node.columns).map((col) => {
      const type = col.data_type ?? "";
      return `| ${col.name} | ${type} | ${col.description} |`;
    });
    columnRows = rows.join("\n");
  }

  // Build upstream list (extract last segment after ".")
  const upstream = node.depends_on.nodes
    .map((id) => {
      const parts = id.split(".");
      return parts[parts.length - 1];
    })
    .join(", ");

  return `# ${node.name}

## 概要
${description}

## テーブル情報
- **データベース**: ${node.database}
- **スキーマ**: ${node.schema}
- **マテリアライゼーション**: ${node.config.materialized}
- **タグ**: ${tags}

## カラム

| カラム名 | 型 | 説明 |
|---------|------|------|
${columnRows}

## リネージ
- 上流: ${upstream}
`;
}
