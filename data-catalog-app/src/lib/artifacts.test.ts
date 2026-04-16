import { describe, it, expect } from "vitest";
import {
  inferLayer,
  transformManifestNode,
} from "./artifacts";
import type {
  DbtManifestNode,
  DbtCatalogNode,
  DbtRunResult,
} from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<DbtManifestNode> = {}): DbtManifestNode {
  return {
    unique_id: "model.project.test_model",
    name: "test_model",
    resource_type: "model",
    description: "A test model",
    schema: "PUBLIC",
    database: "DEV",
    fqn: ["project", "staging", "test_model"],
    tags: [],
    config: {
      materialized: "table",
    },
    depends_on: {
      nodes: ["model.project.source_model"],
      macros: [],
    },
    columns: {
      id: {
        name: "id",
        description: "Primary key",
        data_type: null,
        meta: {},
        tags: [],
      },
      name: {
        name: "name",
        description: "User name",
        data_type: null,
        meta: {},
        tags: [],
      },
    },
    meta: {},
    path: "staging/test_model.sql",
    original_file_path: "models/staging/test_model.sql",
    ...overrides,
  };
}

function makeCatalogNode(
  overrides: Partial<DbtCatalogNode> = {}
): DbtCatalogNode {
  return {
    unique_id: "model.project.test_model",
    metadata: {
      type: "table",
      schema: "PUBLIC",
      name: "TEST_MODEL",
      database: "DEV",
      comment: null,
      owner: null,
    },
    columns: {
      ID: {
        name: "ID",
        type: "NUMBER",
        index: 1,
        comment: null,
      },
      NAME: {
        name: "NAME",
        type: "VARCHAR",
        index: 2,
        comment: null,
      },
    },
    stats: {},
    ...overrides,
  };
}

// ── inferLayer ────────────────────────────────────────────────────────────────

describe("inferLayer", () => {
  it("returns 'marts' for fqn containing 'marts'", () => {
    expect(inferLayer(["project", "marts", "fct_orders"])).toBe("marts");
  });

  it("returns 'staging' for fqn containing 'staging'", () => {
    expect(inferLayer(["project", "staging", "stg_orders"])).toBe("staging");
  });

  it("returns 'raw_vault' for fqn containing 'raw_vault'", () => {
    expect(inferLayer(["project", "raw_vault", "hub_customer"])).toBe(
      "raw_vault"
    );
  });

  it("returns 'business_vault' for fqn containing 'business_vault'", () => {
    expect(inferLayer(["project", "business_vault", "bv_customer"])).toBe(
      "business_vault"
    );
  });

  it("returns 'other' for unknown fqn", () => {
    expect(inferLayer(["project", "utils", "some_model"])).toBe("other");
  });
});

// ── transformManifestNode ─────────────────────────────────────────────────────

describe("transformManifestNode", () => {
  it("transforms a manifest node into a CatalogModel correctly", () => {
    const node = makeNode();
    const catalogNode = makeCatalogNode();
    const runResult: DbtRunResult = {
      unique_id: "model.project.test_model",
      status: "success",
      execution_time: 1.23,
      message: "OK",
    };
    const childMap: Record<string, string[]> = {
      "model.project.test_model": ["model.project.downstream_model"],
    };

    const result = transformManifestNode(node, catalogNode, runResult, childMap);

    expect(result.uniqueId).toBe("model.project.test_model");
    expect(result.name).toBe("test_model");
    expect(result.description).toBe("A test model");
    expect(result.schema).toBe("PUBLIC");
    expect(result.database).toBe("DEV");
    expect(result.materialization).toBe("table");
    expect(result.layer).toBe("staging");
    expect(result.tags).toEqual([]);
    expect(result.dependsOn).toEqual(["model.project.source_model"]);
    expect(result.referencedBy).toEqual(["model.project.downstream_model"]);
    expect(result.lastRunStatus).toBe("success");
    expect(result.lastRunTime).toBe(1.23);
    expect(result.path).toBe("staging/test_model.sql");
  });

  it("uses manifest column data when catalog node is missing", () => {
    const node = makeNode();
    const childMap: Record<string, string[]> = {};

    const result = transformManifestNode(node, undefined, undefined, childMap);

    expect(result.columns).toHaveLength(2);
    const idCol = result.columns.find((c) => c.name === "id");
    expect(idCol).toBeDefined();
    expect(idCol?.description).toBe("Primary key");
    expect(idCol?.type).toBe("");
  });

  it("handles missing run result (null status/time)", () => {
    const node = makeNode();
    const childMap: Record<string, string[]> = {};

    const result = transformManifestNode(node, undefined, undefined, childMap);

    expect(result.lastRunStatus).toBeNull();
    expect(result.lastRunTime).toBeNull();
  });

  it("merges catalog column types with manifest descriptions (case-insensitive key matching)", () => {
    // Manifest has lowercase keys: "id", "name"
    // Catalog has uppercase keys (Snowflake): "ID", "NAME"
    const node = makeNode();
    const catalogNode = makeCatalogNode();
    const childMap: Record<string, string[]> = {};

    const result = transformManifestNode(node, catalogNode, undefined, childMap);

    expect(result.columns).toHaveLength(2);

    // Columns should be sorted by catalog index
    expect(result.columns[0].name).toBe("ID");
    expect(result.columns[0].type).toBe("NUMBER");
    // Description from manifest (case-insensitive match)
    expect(result.columns[0].description).toBe("Primary key");
    expect(result.columns[0].index).toBe(1);

    expect(result.columns[1].name).toBe("NAME");
    expect(result.columns[1].type).toBe("VARCHAR");
    expect(result.columns[1].description).toBe("User name");
    expect(result.columns[1].index).toBe(2);
  });
});
