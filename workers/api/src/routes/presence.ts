import { Hono } from "hono";
import type { Env } from "../env";
import {
  loadSessionUser,
  readSessionToken,
  type AppVars,
} from "../lib/session";

export const presenceRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

async function authed(c: {
  env: Env;
  req: { header: (n: string) => string | undefined };
}) {
  const token = readSessionToken(c as never);
  if (!token) return null;
  return loadSessionUser(c.env, token);
}

async function pushToUser(env: Env, userId: string, payload: unknown) {
  try {
    const id = env.USER_GATEWAY.idFromName(userId);
    const stub = env.USER_GATEWAY.get(id);
    await stub.fetch("https://do/push", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch {
    /* ignore */
  }
}

presenceRoutes.post("/conversations/:id/typing", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);
  const conversationId = c.req.param("id");
  const body = await c.req.json<{ active?: boolean }>();

  const peers = await c.env.DB.prepare(
    `SELECT user_id FROM conversation_members
     WHERE conversation_id = ? AND user_id != ?`,
  )
    .bind(conversationId, loaded.user.id)
    .all<{ user_id: string }>();

  for (const peer of peers.results ?? []) {
    await pushToUser(c.env, peer.user_id, {
      type: body.active === false ? "typing.stop" : "typing.start",
      conversationId,
      userId: loaded.user.id,
      username: loaded.user.username,
      displayName: loaded.user.display_name,
    });
  }

  return c.json({ ok: true });
});
