import { describe, expect, it } from "vitest";
import { isSafeQuery } from "./utils";

describe("isSafeQuery", () => {
  describe("許可されるクエリ", () => {
    it("SELECTクエリを許可する", () => {
      expect(isSafeQuery("SELECT * FROM users")).toBe(true);
    });

    it("WITHクエリ (CTE) を許可する", () => {
      expect(isSafeQuery("WITH cte AS (SELECT 1) SELECT * FROM cte")).toBe(true);
    });

    it("末尾にセミコロンがあるSELECTクエリを許可する", () => {
      expect(isSafeQuery("SELECT 1;")).toBe(true);
    });

    it("小文字のselectを許可する", () => {
      expect(isSafeQuery("select day, score from oura_daily_sleep")).toBe(true);
    });

    it("前後に空白があるクエリを許可する", () => {
      expect(isSafeQuery("  SELECT 1  ")).toBe(true);
    });
  });

  describe("拒否されるクエリ", () => {
    it("INSERTクエリを拒否する", () => {
      expect(isSafeQuery("INSERT INTO users VALUES (1)")).toBe(false);
    });

    it("UPDATEクエリを拒否する", () => {
      expect(isSafeQuery("UPDATE users SET name = 'x'")).toBe(false);
    });

    it("DELETEクエリを拒否する", () => {
      expect(isSafeQuery("DELETE FROM users")).toBe(false);
    });

    it("DROP TABLEを拒否する", () => {
      expect(isSafeQuery("DROP TABLE users")).toBe(false);
    });

    it("WITH + DELETEを拒否する", () => {
      expect(
        isSafeQuery("WITH cte AS (SELECT 1) DELETE FROM users WHERE id IN (SELECT * FROM cte)")
      ).toBe(false);
    });

    it("WITH + UPDATEを拒否する", () => {
      expect(isSafeQuery("WITH cte AS (SELECT 1) UPDATE users SET name = 'x'")).toBe(false);
    });

    it("WITH + INSERTを拒否する", () => {
      expect(isSafeQuery("WITH cte AS (SELECT 1) INSERT INTO users SELECT * FROM cte")).toBe(false);
    });

    it("複数ステートメント (SQLインジェクション) を拒否する", () => {
      expect(isSafeQuery("SELECT 1; DROP TABLE users")).toBe(false);
    });

    it("空文字列を拒否する", () => {
      expect(isSafeQuery("")).toBe(false);
    });
  });
});
