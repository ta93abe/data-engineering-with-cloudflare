import { describe, it, expect } from "vitest";
import { inferFolder, generateModelMarkdown } from "./markdown";
import type { DbtManifestNode, DbtCatalogNode } from "./markdown";

// ── inferFolder ───────────────────────────────────────────────────────────────

describe("inferFolder", () => {
  it("maps fqn with multiple intermediate segments to folder path", () => {
    expect(
      inferFolder(["modeling", "marts", "datavault", "facts", "fct_visits"])
    ).toBe("marts/datavault/facts");
  });

  it("maps fqn with a single intermediate segment to that segment", () => {
    expect(inferFolder(["project", "staging", "stg_orders"])).toBe("staging");
  });

  it('falls back to "other" when fqn has only project + model name', () => {
    expect(inferFolder(["project", "model"])).toBe("other");
  });

  it('falls back to "other" when fqn has a single element', () => {
    expect(inferFolder(["model"])).toBe("other");
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<DbtManifestNode> = {}): DbtManifestNode {
  return {
    unique_id: "model.modeling.fct_orders",
    name: "fct_orders",
    resource_type: "model",
    description: "注文ファクトテーブル",
    schema: "marts",
    database: "analytics",
    fqn: ["modeling", "marts", "fct_orders"],
    tags: ["daily", "finance"],
    config: { materialized: "table" },
    depends_on: {
      nodes: ["model.modeling.stg_orders", "model.modeling.dim_customers"],
      macros: [],
    },
    columns: {
      order_id: { name: "order_id", description: "注文ID", data_type: "varchar" },
      amount: { name: "amount", description: "注文金額", data_type: "numeric" },
    },
    path: "marts/fct_orders.sql",
    ...overrides,
  };
}

function makeCatalogNode(overrides: Partial<DbtCatalogNode> = {}): DbtCatalogNode {
  return {
    unique_id: "model.modeling.fct_orders",
    metadata: { type: "table", schema: "marts", name: "fct_orders", database: "analytics" },
    columns: {
      ORDER_ID: { name: "ORDER_ID", type: "VARCHAR", index: 1, comment: null },
      AMOUNT: { name: "AMOUNT", type: "NUMBER(38,2)", index: 2, comment: null },
    },
    ...overrides,
  };
}

// ── generateModelMarkdown ─────────────────────────────────────────────────────

describe("generateModelMarkdown", () => {
  it("generates correct H1 heading with model name", () => {
    const md = generateModelMarkdown(makeNode(), undefined);
    expect(md).toMatch(/^# fct_orders/m);
  });

  it("includes description in 概要 section", () => {
    const md = generateModelMarkdown(makeNode(), undefined);
    expect(md).toContain("## 概要");
    expect(md).toContain("注文ファクトテーブル");
  });

  it('shows "説明なし" when description is empty', () => {
    const md = generateModelMarkdown(makeNode({ description: "" }), undefined);
    expect(md).toContain("説明なし");
  });

  it("shows テーブル情報 with database, schema, materialization, and tags", () => {
    const md = generateModelMarkdown(makeNode(), undefined);
    expect(md).toContain("**データベース**: analytics");
    expect(md).toContain("**スキーマ**: marts");
    expect(md).toContain("**マテリアライゼーション**: table");
    expect(md).toContain("**タグ**: daily, finance");
  });

  it('shows "なし" for tags when tags array is empty', () => {
    const md = generateModelMarkdown(makeNode({ tags: [] }), undefined);
    expect(md).toContain("**タグ**: なし");
  });

  it("generates column table from catalog columns with manifest descriptions (case-insensitive match)", () => {
    const md = generateModelMarkdown(makeNode(), makeCatalogNode());
    expect(md).toContain("## カラム");
    // Catalog column names preserved
    expect(md).toContain("ORDER_ID");
    expect(md).toContain("VARCHAR");
    // Manifest description matched case-insensitively
    expect(md).toContain("注文ID");
    expect(md).toContain("AMOUNT");
    expect(md).toContain("NUMBER(38,2)");
    expect(md).toContain("注文金額");
  });

  it("sorts catalog columns by index", () => {
    const catalog = makeCatalogNode({
      columns: {
        AMOUNT: { name: "AMOUNT", type: "NUMBER(38,2)", index: 2, comment: null },
        ORDER_ID: { name: "ORDER_ID", type: "VARCHAR", index: 1, comment: null },
      },
    });
    const md = generateModelMarkdown(makeNode(), catalog);
    const orderIdPos = md.indexOf("ORDER_ID");
    const amountPos = md.indexOf("AMOUNT");
    expect(orderIdPos).toBeLessThan(amountPos);
  });

  it("falls back to manifest columns when catalog is missing", () => {
    const md = generateModelMarkdown(makeNode(), undefined);
    expect(md).toContain("order_id");
    expect(md).toContain("varchar");
    expect(md).toContain("注文ID");
  });

  it("lists upstream dependencies in リネージ section", () => {
    const md = generateModelMarkdown(makeNode(), undefined);
    expect(md).toContain("## リネージ");
    expect(md).toContain("stg_orders");
    expect(md).toContain("dim_customers");
  });

  it("shows empty upstream when depends_on.nodes is empty", () => {
    const md = generateModelMarkdown(
      makeNode({ depends_on: { nodes: [], macros: [] } }),
      undefined
    );
    expect(md).toContain("上流:");
  });
});
