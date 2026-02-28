import { createMcpHandler } from "agents/mcp";
import { Hono } from "hono";
import { bearerAuth } from "./middleware/auth";
import { createMcpServer } from "./server";
import type { Bindings } from "./types";

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", bearerAuth);

app.get("/health", (c) => c.text("OK"));

app.all("/mcp", async (c) => {
  const server = createMcpServer(c.env);
  const handler = createMcpHandler(server);
  return handler(c.req.raw, c.env, c.executionCtx);
});

export default app;
