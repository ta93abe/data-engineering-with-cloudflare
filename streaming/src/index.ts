import { Hono } from "hono";
import type { Env } from "./types";
import linear from "./webhooks/linear";

const app = new Hono<{ Bindings: Env }>();

// Webhook routes
app.route("/webhooks/linear", linear);

// Root
app.get("/", (c) => {
  return c.json({
    name: "streaming",
    endpoints: {
      "POST /webhooks/linear": "Receive Linear webhook events",
      "GET /health": "Health check",
    },
  });
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
