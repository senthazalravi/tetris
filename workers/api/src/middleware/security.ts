import type { Context, Next } from "hono";
import type { Env } from "../env";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(opts: {
  key: (c: Context<{ Bindings: Env }>) => string;
  limit: number;
  windowMs: number;
}) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const id = opts.key(c);
    const now = Date.now();
    let bucket = buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(id, bucket);
    }
    bucket.count += 1;
    if (bucket.count > opts.limit) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }
    await next();
  };
}

export async function securityHeaders(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "no-referrer");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; frame-ancestors 'none'",
  );
}
