import { describe, expect, it } from "vitest";
import { normalizePayload, validateTimestamp } from "../webhooks/linear";
import type { LinearWebhookPayload } from "../types";

describe("normalizePayload", () => {
  it("converts camelCase keys to snake_case", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Issue",
      createdAt: "2026-04-12T10:00:00.000Z",
      webhookId: "wh-123",
      webhookTimestamp: 1744444800000,
      organizationId: "org-456",
      url: "https://linear.app/team/issue/ID-1",
      actor: { id: "user-1", name: "Test User" },
      data: { id: "issue-1", title: "Test Issue" },
      updatedFrom: { title: "Old Title" },
    };

    const result = normalizePayload(payload);

    expect(result).toEqual({
      action: "create",
      type: "Issue",
      created_at: "2026-04-12T10:00:00.000Z",
      webhook_id: "wh-123",
      webhook_timestamp: 1744444800000,
      organization_id: "org-456",
      url: "https://linear.app/team/issue/ID-1",
      actor: { id: "user-1", name: "Test User" },
      data: { id: "issue-1", title: "Test Issue" },
      updated_from: { title: "Old Title" },
    });
  });

  it("sets optional fields to null when absent", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Issue",
      createdAt: "2026-04-12T10:00:00.000Z",
      webhookId: "wh-123",
      webhookTimestamp: 1744444800000,
      organizationId: "org-456",
      data: { id: "issue-1" },
    };

    const result = normalizePayload(payload);

    expect(result.url).toBeNull();
    expect(result.actor).toBeNull();
    expect(result.updated_from).toBeNull();
  });
});

describe("validateTimestamp", () => {
  it("returns true for timestamp within 60 seconds", () => {
    const now = Date.now();
    expect(validateTimestamp(now)).toBe(true);
  });

  it("returns true for timestamp 30 seconds ago", () => {
    const thirtySecondsAgo = Date.now() - 30_000;
    expect(validateTimestamp(thirtySecondsAgo)).toBe(true);
  });

  it("returns false for timestamp older than 60 seconds", () => {
    const twoMinutesAgo = Date.now() - 120_000;
    expect(validateTimestamp(twoMinutesAgo)).toBe(false);
  });

  it("returns false for timestamp in the far future", () => {
    const fiveMinutesFromNow = Date.now() + 300_000;
    expect(validateTimestamp(fiveMinutesFromNow)).toBe(false);
  });
});
