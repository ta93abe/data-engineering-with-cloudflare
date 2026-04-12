import { Hono } from "hono";
import { verifySignature } from "../lib/signature";
import type { Env, LinearStreamEvent, LinearWebhookPayload } from "../types";

const TIMESTAMP_TOLERANCE_MS = 60_000;

/**
 * Linear Webhook ペイロードを Stream スキーマに正規化する
 */
export function normalizePayload(payload: LinearWebhookPayload): LinearStreamEvent {
  return {
    action: payload.action,
    type: payload.type,
    created_at: payload.createdAt,
    webhook_id: payload.webhookId,
    webhook_timestamp: payload.webhookTimestamp,
    organization_id: payload.organizationId,
    url: payload.url ?? null,
    actor: payload.actor ?? null,
    data: payload.data,
    updated_from: payload.updatedFrom ?? null,
  };
}

/**
 * Webhook タイムスタンプが許容範囲内か検証する（リプレイ攻撃防止）
 */
export function validateTimestamp(webhookTimestamp: number): boolean {
  const now = Date.now();
  const diff = Math.abs(now - webhookTimestamp);
  return diff <= TIMESTAMP_TOLERANCE_MS;
}

const linear = new Hono<{ Bindings: Env }>();

linear.post("/", async (c) => {
  const signature = c.req.header("Linear-Signature");
  if (!signature) {
    return c.json({ error: "Missing signature" }, 401);
  }

  const rawBody = await c.req.text();

  const secret = await c.env.LINEAR_WEBHOOK_SECRET.get();
  const isValid = await verifySignature(rawBody, signature, secret);
  if (!isValid) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as LinearWebhookPayload;
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  if (!validateTimestamp(payload.webhookTimestamp)) {
    return c.json({ error: "Timestamp out of range" }, 401);
  }

  const event = normalizePayload(payload);

  await c.env.STREAM.send([event]);

  return c.json({ success: true }, 200);
});

export default linear;
