import { describe, expect, it } from "vitest";
import { timingSafeEqual, verifySignature } from "../lib/signature";

describe("timingSafeEqual", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(timingSafeEqual("abc", "def")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("verifySignature", () => {
  const secret = "test-webhook-secret";

  it("returns true for valid signature", async () => {
    const body = '{"action":"create","type":"Issue"}';
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await verifySignature(body, hex, secret);
    expect(result).toBe(true);
  });

  it("returns false for invalid signature", async () => {
    const body = '{"action":"create","type":"Issue"}';
    const result = await verifySignature(body, "invalid-signature", secret);
    expect(result).toBe(false);
  });

  it("returns false for tampered body", async () => {
    const body = '{"action":"create","type":"Issue"}';
    const tamperedBody = '{"action":"remove","type":"Issue"}';
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await verifySignature(tamperedBody, hex, secret);
    expect(result).toBe(false);
  });
});
