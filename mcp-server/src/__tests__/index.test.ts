import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("MCP Server", () => {
  it("should return OK on health check", async () => {
    const response = await SELF.fetch("http://localhost/health");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });

  it("should return 401 on unknown routes without auth", async () => {
    const response = await SELF.fetch("http://localhost/unknown");
    expect(response.status).toBe(401);
  });

  it("should return 404 on unknown routes with auth", async () => {
    const response = await SELF.fetch("http://localhost/unknown", {
      headers: { Authorization: "Bearer test-secret-token" },
    });
    expect(response.status).toBe(404);
  });
});
