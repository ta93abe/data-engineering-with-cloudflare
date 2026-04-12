import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("streaming worker", () => {
  it("returns health check on GET /health", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({ status: "ok" });
  });

  it("returns service info on GET /", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty("name", "streaming");
    expect(json).toHaveProperty("endpoints");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await SELF.fetch("https://example.com/unknown");
    expect(res.status).toBe(404);
  });

  it("returns 401 when Linear webhook has no signature", async () => {
    const res = await SELF.fetch("https://example.com/webhooks/linear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", type: "Issue" }),
    });
    expect(res.status).toBe(401);
  });
});
