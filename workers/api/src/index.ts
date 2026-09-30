import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { authRoutes } from "./routes/auth";
import { contactRoutes } from "./routes/contacts";
import {
  loadSessionUser,
  readSessionToken,
  type AppVars,
} from "./lib/session";

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

app.use(
  "*",
  cors({
    origin: (origin, c) => origin || c.env.APP_ORIGIN || "*",
    credentials: true,
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/api/v1/health", (c) =>
  c.json({ ok: true, service: "lop-api", time: Date.now() }),
);

app.route("/api/v1/auth", authRoutes);
app.route("/api/v1", contactRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

export default app;

/** Optional helper for authenticated routes. */
export async function requireUser(c: {
  env: Env;
  req: { header: (n: string) => string | undefined };
  set: (k: "user" | "session", v: unknown) => void;
  json: (body: unknown, status?: number) => Response;
}) {
  const cookieHeader = c.req.header("Cookie");
  // thin wrapper used by future routes — auth routes handle cookies directly
  void cookieHeader;
  const token = readSessionToken(c as never);
  if (!token) return null;
  return loadSessionUser(c.env, token);
}
