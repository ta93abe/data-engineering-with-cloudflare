import type { Pipeline } from "cloudflare:pipelines";

export interface Env {
  STREAM: Pipeline;
  LINEAR_WEBHOOK_SECRET: string;
}

// Linear Webhook の生ペイロード（camelCase）
export interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: string;
  createdAt: string;
  webhookId: string;
  webhookTimestamp: number;
  organizationId: string;
  url?: string;
  actor?: Record<string, unknown>;
  data: Record<string, unknown>;
  updatedFrom?: Record<string, unknown>;
}

// Stream に送信する正規化済みイベント（snake_case）
export interface LinearStreamEvent {
  action: string;
  type: string;
  created_at: string;
  webhook_id: string;
  webhook_timestamp: number;
  organization_id: string;
  url: string | null;
  actor: Record<string, unknown> | null;
  data: Record<string, unknown>;
  updated_from: Record<string, unknown> | null;
}
