import type {
  CatalogModel,
  DbtCatalogNode,
  DbtManifest,
  DbtManifestNode,
  DbtRunResult,
} from "./types";

// Layer ordering for sorting (more specific/upstream first)
const LAYER_ORDER: CatalogModel["layer"][] = [
  "marts",
  "business_vault",
  "raw_vault",
  "staging",
  "other",
];

/**
 * Infers the dbt layer from the model's fully-qualified name (fqn).
 * Scans each segment looking for known layer keywords.
 */
export function inferLayer(fqn: string[]): CatalogModel["layer"] {
  const known: CatalogModel["layer"][] = [
    "staging",
    "raw_vault",
    "business_vault",
    "marts",
  ];
  for (const segment of fqn) {
    const matched = known.find((layer) => segment === layer);
    if (matched) return matched;
  }
  return "other";
}

/**
 * Transforms a single dbt manifest node into a CatalogModel.
 *
 * - Prefers catalog columns (which have runtime type info) over manifest columns.
 * - Uses case-insensitive key matching when looking up manifest column descriptions
 *   (Snowflake uppercases column names in catalog.json).
 * - Sorts columns by catalog index.
 * - Uses childMap to populate referencedBy.
 */
export function transformManifestNode(
  node: DbtManifestNode,
  catalogNode: DbtCatalogNode | undefined,
  runResult: DbtRunResult | undefined,
  childMap: Record<string, string[]>
): CatalogModel {
  // Build a lowercase -> manifest column description lookup
  const manifestColumnDescriptions: Record<string, string> = {};
  for (const [key, col] of Object.entries(node.columns)) {
    manifestColumnDescriptions[key.toLowerCase()] = col.description;
  }

  let columns: CatalogModel["columns"];

  if (catalogNode) {
    // Use catalog columns (have type info), enrich with manifest descriptions
    columns = Object.values(catalogNode.columns)
      .map((col) => ({
        name: col.name,
        type: col.type,
        description: manifestColumnDescriptions[col.name.toLowerCase()] ?? "",
        index: col.index,
      }))
      .sort((a, b) => a.index - b.index);
  } else {
    // Fall back to manifest columns only
    columns = Object.values(node.columns).map((col, idx) => ({
      name: col.name,
      type: col.data_type ?? "",
      description: col.description,
      index: idx + 1,
    }));
  }

  return {
    uniqueId: node.unique_id,
    name: node.name,
    description: node.description,
    schema: node.schema,
    database: node.database,
    materialization: node.config.materialized,
    layer: inferLayer(node.fqn),
    tags: node.tags,
    columns,
    dependsOn: node.depends_on.nodes,
    referencedBy: childMap[node.unique_id] ?? [],
    lastRunStatus: runResult?.status ?? null,
    lastRunTime: runResult?.execution_time ?? null,
    path: node.path,
  };
}

// ── R2-dependent functions ────────────────────────────────────────────────────

async function fetchJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return (await obj.json()) as T;
}

/**
 * Fetches manifest.json, catalog.json, and run_results.json from R2 in parallel.
 * Filters to resource_type === "model" only.
 * Sorts by layer order (marts first) then by name.
 */
export async function loadAllModels(bucket: R2Bucket): Promise<CatalogModel[]> {
  const [manifest, catalog, runResults] = await Promise.all([
    fetchJson<DbtManifest>(bucket, "manifest.json"),
    fetchJson<{ nodes: Record<string, DbtCatalogNode> }>(bucket, "catalog.json"),
    fetchJson<{ results: DbtRunResult[] }>(bucket, "run_results.json"),
  ]);

  if (!manifest) return [];

  // Build run result lookup by unique_id
  const runResultMap: Record<string, DbtRunResult> = {};
  for (const r of runResults?.results ?? []) {
    runResultMap[r.unique_id] = r;
  }

  const catalogNodes = catalog?.nodes ?? {};

  const models = Object.values(manifest.nodes)
    .filter((node) => node.resource_type === "model")
    .map((node) =>
      transformManifestNode(
        node,
        catalogNodes[node.unique_id],
        runResultMap[node.unique_id],
        manifest.child_map
      )
    );

  // Sort: layer order first, then alphabetically by name
  models.sort((a, b) => {
    const layerDiff =
      LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer);
    if (layerDiff !== 0) return layerDiff;
    return a.name.localeCompare(b.name);
  });

  return models;
}

/**
 * Loads all models and finds one by name.
 */
export async function loadModel(
  bucket: R2Bucket,
  modelName: string
): Promise<CatalogModel | null> {
  const models = await loadAllModels(bucket);
  return models.find((m) => m.name === modelName) ?? null;
}

/**
 * Returns dbt version and generation timestamp from manifest metadata.
 */
export async function loadManifestMetadata(
  bucket: R2Bucket
): Promise<{ dbtVersion: string; generatedAt: string } | null> {
  const manifest = await fetchJson<DbtManifest>(bucket, "manifest.json");
  if (!manifest) return null;
  return {
    dbtVersion: manifest.metadata.dbt_version,
    generatedAt: manifest.metadata.generated_at,
  };
}
