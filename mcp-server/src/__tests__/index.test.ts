import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("MCP Server", () => {
  it("should return OK on health check", async () => {
    const response = await SELF.fetch("http://localhost/health");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });

  it("should return 404 on unknown routes", async () => {
    const response = await SELF.fetch("http://localhost/unknown");
    expect(response.status).toBe(404);
  });
});
