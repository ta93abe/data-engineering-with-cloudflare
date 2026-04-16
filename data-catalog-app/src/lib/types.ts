/**
 * dbt Artifact Type Definitions
 *
 * TypeScript types for dbt manifest.json, catalog.json, and run_results.json
 * These types drive the data catalog application and ensure type safety
 * across all downstream components.
 */

/**
 * Column definition from dbt manifest.json
 */
export interface DbtManifestColumn {
  name: string;
  description: string;
  data_type: string | null;
  meta: Record<string, unknown>;
  tags: string[];
}

/**
 * Node from dbt manifest.json (models, sources, tests, seeds, snapshots)
 */
export interface DbtManifestNode {
  unique_id: string;
  name: string;
  resource_type: "model" | "source" | "test" | "seed" | "snapshot";
  description: string;
  schema: string;
  database: string;
  fqn: string[];
  tags: string[];
  config: {
    materialized: string;
    tags?: string[];
    [key: string]: unknown;
  };
  depends_on: {
    nodes: string[];
    macros: string[];
  };
  columns: Record<string, DbtManifestColumn>;
  meta: Record<string, unknown>;
  path: string;
  original_file_path: string;
}

/**
 * Top-level structure of dbt manifest.json
 */
export interface DbtManifest {
  nodes: Record<string, DbtManifestNode>;
  sources: Record<string, DbtManifestNode>;
  metadata: {
    dbt_version: string;
    generated_at: string;
    project_name: string;
  };
  parent_map: Record<string, string[]>;
  child_map: Record<string, string[]>;
}

/**
 * Column definition from dbt catalog.json
 */
export interface DbtCatalogColumn {
  name: string;
  type: string;
  index: number;
  comment: string | null;
}

/**
 * Node from dbt catalog.json with runtime metadata
 */
export interface DbtCatalogNode {
  unique_id: string;
  metadata: {
    type: string;
    schema: string;
    name: string;
    database: string;
    comment: string | null;
    owner: string | null;
  };
  columns: Record<string, DbtCatalogColumn>;
  stats: Record<
    string,
    {
      id: string;
      label: string;
      value: string | number | null;
      description: string;
    }
  >;
}

/**
 * Top-level structure of dbt catalog.json
 */
export interface DbtCatalog {
  nodes: Record<string, DbtCatalogNode>;
  sources: Record<string, DbtCatalogNode>;
  metadata: {
    generated_at: string;
  };
}

/**
 * Single result from dbt run_results.json
 */
export interface DbtRunResult {
  unique_id: string;
  status: "success" | "error" | "skipped" | "warn";
  execution_time: number;
  message: string;
}

/**
 * Top-level structure of dbt run_results.json
 */
export interface DbtRunResults {
  results: DbtRunResult[];
  metadata: {
    generated_at: string;
  };
}

/**
 * Application-level column type derived from dbt artifacts
 */
export interface CatalogColumn {
  name: string;
  type: string;
  description: string;
  index: number;
}

/**
 * Application-level model type combining manifest and catalog data
 * This is the primary type used throughout the data catalog app
 */
export interface CatalogModel {
  uniqueId: string;
  name: string;
  description: string;
  schema: string;
  database: string;
  materialization: string;
  layer: "staging" | "raw_vault" | "business_vault" | "marts" | "other";
  tags: string[];
  columns: CatalogColumn[];
  dependsOn: string[];
  referencedBy: string[];
  lastRunStatus: DbtRunResult["status"] | null;
  lastRunTime: number | null;
  path: string;
}
