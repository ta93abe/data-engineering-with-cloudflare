import type { Context, Next } from "hono";
import type { Bindings } from "../types";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  return crypto.subtle.timingSafeEqual(bufA, bufB);
}

export async function bearerAuth(c: Context<{ Bindings: Bindings }>, next: Next) {
  if (c.req.path === "/health") {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  if (!timingSafeEqual(token, c.env.MCP_AUTH_TOKEN)) {
    return c.json({ error: "Invalid token" }, 401);
  }

  return next();
}
