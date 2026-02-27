import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("Auth Middleware", () => {
  it("should allow health check without auth", async () => {
    const response = await SELF.fetch("http://localhost/health");
    expect(response.status).toBe(200);
  });

  it("should reject /mcp without auth header", async () => {
    const response = await SELF.fetch("http://localhost/mcp", { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("should reject /mcp with invalid token", async () => {
    const response = await SELF.fetch("http://localhost/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(response.status).toBe(401);
  });

  it("should accept /mcp with valid token", async () => {
    const response = await SELF.fetch("http://localhost/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-secret-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
        id: 1,
      }),
    });
    // Should not be 401 (auth passed), may be 200 or other MCP response
    expect(response.status).not.toBe(401);
  });
});
