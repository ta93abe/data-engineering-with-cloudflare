import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { SpotifyContainer } from "../index";

// Access outbound handler directly — it's a static property, not an HTTP route
const handler = SpotifyContainer.outboundByHost?.["kv.internal"];

describe("outbound kv.internal handler", () => {
  beforeEach(async () => {
    await env.SPOTIFY_STATE_KV.delete("refresh_token");
    await env.SPOTIFY_STATE_KV.delete("cursor");
  });

  it("returns 404 when key missing", async () => {
    if (!handler) throw new Error("handler not registered");
    const res = await handler(
      new Request("http://kv.internal/refresh_token"),
      env as Env,
      {} as ExecutionContext
    );
    expect(res.status).toBe(404);
  });

  it("returns stored value on GET", async () => {
    if (!handler) throw new Error("handler not registered");
    await env.SPOTIFY_STATE_KV.put("refresh_token", "AQB-xyz");
    const res = await handler(
      new Request("http://kv.internal/refresh_token"),
      env as Env,
      {} as ExecutionContext
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("AQB-xyz");
  });

  it("writes and reads back with PUT", async () => {
    if (!handler) throw new Error("handler not registered");
    const putRes = await handler(
      new Request("http://kv.internal/cursor", {
        method: "PUT",
        body: "1713500400000",
      }),
      env as Env,
      {} as ExecutionContext
    );
    expect(putRes.status).toBe(204);
    expect(await env.SPOTIFY_STATE_KV.get("cursor")).toBe("1713500400000");
  });

  it("rejects unknown method with 405", async () => {
    if (!handler) throw new Error("handler not registered");
    const res = await handler(
      new Request("http://kv.internal/refresh_token", { method: "DELETE" }),
      env as Env,
      {} as ExecutionContext
    );
    expect(res.status).toBe(405);
  });

  it("rejects empty key with 400", async () => {
    if (!handler) throw new Error("handler not registered");
    const res = await handler(
      new Request("http://kv.internal/"),
      env as Env,
      {} as ExecutionContext
    );
    expect(res.status).toBe(400);
  });
});
