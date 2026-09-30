import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { authRoutes } from "./routes/auth";
import { contactRoutes } from "./routes/contacts";
import { deviceRoutes } from "./routes/devices";
import { attachmentRoutes } from "./routes/attachments";
import { presenceRoutes } from "./routes/presence";
import { messageRoutes } from "./routes/messages";
import { runExpiryCleanup } from "./services/expiry";
import { rateLimit, securityHeaders } from "./middleware/security";
import {
  loadSessionUser,
  readSessionToken,
  type AppVars,
} from "./lib/session";
import { UserGateway } from "./realtime/UserGateway";

export { UserGateway };

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

app.use("*", securityHeaders);

app.use(
  "*",
  cors({
    origin: (origin, c) => origin || c.env.APP_ORIGIN || "*",
    credentials: true,
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.use(
  "/api/v1/auth/login",
  rateLimit({
    key: (c) => `login:${c.req.header("cf-connecting-ip") ?? "local"}`,
    limit: 20,
    windowMs: 60_000,
  }),
);

app.use(
  "/api/v1/auth/register",
  rateLimit({
    key: (c) => `reg:${c.req.header("cf-connecting-ip") ?? "local"}`,
    limit: 10,
    windowMs: 60_000,
  }),
);

app.use(
  "/api/v1/users/lookup",
  rateLimit({
    key: (c) => `lookup:${c.req.header("cf-connecting-ip") ?? "local"}`,
    limit: 30,
    windowMs: 60_000,
  }),
);

app.get("/api/v1/health", (c) =>
  c.json({ ok: true, service: "lop-api", time: Date.now() }),
);

app.post("/api/v1/internal/expiry-sweep", async (c) => {
  const deleted = await runExpiryCleanup(c.env);
  return c.json({ deleted });
});

app.get("/api/v1/ws", async (c) => {
  const upgrade = c.req.header("Upgrade");
  if (upgrade !== "websocket") {
    return c.json({ error: "Expected websocket" }, 426);
  }
  const token = readSessionToken(c);
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const loaded = await loadSessionUser(c.env, token);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const id = c.env.USER_GATEWAY.idFromName(loaded.user.id);
  const stub = c.env.USER_GATEWAY.get(id);
  return stub.fetch("https://do/ws", c.req.raw);
});

app.route("/api/v1/auth", authRoutes);
app.route("/api/v1", contactRoutes);
app.route("/api/v1", deviceRoutes);
app.route("/api/v1", messageRoutes);
app.route("/api/v1", attachmentRoutes);
app.route("/api/v1", presenceRoutes);

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
