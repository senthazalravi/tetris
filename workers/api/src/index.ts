import { Hono } from "hono";
import type { Env } from "./env";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { contactRoutes } from "./routes/contacts";
import { deviceRoutes } from "./routes/devices";
import { messageRoutes } from "./routes/messages";
import { attachmentRoutes } from "./routes/attachments";
import {
  hasValidVaultToken,
  loadSession,
  originGuard,
  readSessionToken,
  type AppEnv,
} from "./lib/session";
import { runExpiryCleanup } from "./services/expiry";
import { sweepAllChallenges } from "./services/challenges";
import { sweepNotifications } from "./services/notify";
import { UserGateway } from "./realtime/UserGateway";

export { UserGateway };

const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "no-referrer");
});
app.use("/api/*", originGuard);

app.get("/api/v1/health", (c) => c.json({ ok: true, time: Date.now() }));

/**
 * Live event channel. Needs the session cookie AND this tab's vault token.
 * Served outside Hono on purpose: a 101 response carries a webSocket that must
 * reach the runtime untouched, and header middleware would rebuild it.
 */
async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  const json = (error: string, status: number) =>
    Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("Upgrade") !== "websocket") {
    return json("Expected a WebSocket upgrade", 426);
  }
  const token = readSessionToken({ header: (n) => request.headers.get(n) ?? undefined });
  const loaded = token ? await loadSession(env, token) : null;
  if (!loaded) return json("Not signed in", 401);
  const ok = await hasValidVaultToken(
    env,
    new URL(request.url).searchParams.get("vt"),
    loaded.session.id,
  );
  if (!ok) return json("Vault is locked", 403);
  const stub = env.USER_GATEWAY.get(env.USER_GATEWAY.idFromName(loaded.user.id));
  return stub.fetch("https://gateway/ws", request);
}

app.route("/api/v1/auth", authRoutes);
app.route("/api/v1", userRoutes);
app.route("/api/v1", contactRoutes);
app.route("/api/v1", deviceRoutes);
app.route("/api/v1", messageRoutes);
app.route("/api/v1", attachmentRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("unhandled", err instanceof Error ? err.message : "error");
  return c.json({ error: "Something went wrong" }, 500);
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === "/api/v1/ws") return handleWebSocket(request, env);
    return app.fetch(request, env, ctx);
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        await sweepAllChallenges(env);
        await runExpiryCleanup(env);
        await sweepNotifications(env);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;

