import { Hono } from "hono";
import catalog from "./api/catalog";
import query from "./api/query";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/query", query);
app.route("/api/catalog", catalog);

app.get("/api/health", (c) => c.json({ status: "ok" }));

export default app;
