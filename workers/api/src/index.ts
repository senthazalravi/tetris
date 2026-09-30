import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { authRoutes } from "./routes/auth";
import { contactRoutes } from "./routes/contacts";
import { deviceRoutes } from "./routes/devices";
import { messageRoutes } from "./routes/messages";
import { runExpiryCleanup } from "./services/expiry";
import type { AppVars } from "./lib/session";

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

app.post("/api/v1/internal/expiry-sweep", async (c) => {
  const deleted = await runExpiryCleanup(c.env);
  return c.json({ deleted });
});

app.route("/api/v1/auth", authRoutes);
app.route("/api/v1", contactRoutes);
app.route("/api/v1", deviceRoutes);
app.route("/api/v1", messageRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runExpiryCleanup(env));
    void event;
  },
};

