import { Hono } from "hono";
import type { Env } from "../env";
import {
  loadSessionUser,
  publicUser,
  readSessionToken,
  type AppVars,
} from "../lib/session";
import { normalizeUsername } from "../lib/crypto";
import { USERNAME_PATTERN } from "@lop/config";

export const contactRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

async function authed(c: {
  env: Env;
  req: { header: (n: string) => string | undefined };
}) {
  const token = readSessionToken(c as never);
  if (!token) return null;
  return loadSessionUser(c.env, token);
}

contactRoutes.get("/users/lookup", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const raw = c.req.query("username") ?? "";
  const username = normalizeUsername(raw);
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username" }, 400);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, username, display_name, avatar_ref FROM users WHERE username = ? LIMIT 1`,
  )
    .bind(username)
    .first<{
      id: string;
      username: string;
      display_name: string;
      avatar_ref: string | null;
    }>();

  if (!user) return c.json({ error: "User not found" }, 404);

  return c.json({
    userId: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_ref,
    identityKeyFingerprint: null,
  });
});

contactRoutes.get("/contacts", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const rows = await c.env.DB.prepare(
    `SELECT c.contact_user_id, c.display_alias, c.blocked, c.created_at,
            u.username, u.display_name, u.avatar_ref
     FROM contacts c
     JOIN users u ON u.id = c.contact_user_id
     WHERE c.owner_user_id = ?
     ORDER BY u.display_name COLLATE NOCASE ASC`,
  )
    .bind(loaded.user.id)
    .all();

  return c.json({
    contacts: (rows.results ?? []).map((r) => ({
      userId: r.contact_user_id,
      username: r.username,
      displayName: r.display_alias || r.display_name,
      avatarUrl: r.avatar_ref,
      blocked: r.blocked === 1,
      createdAt: r.created_at,
    })),
  });
});

contactRoutes.post("/contacts", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{
    contactUserId?: string;
    displayAlias?: string;
  }>();
  const contactUserId = body.contactUserId ?? "";
  if (!contactUserId) return c.json({ error: "contactUserId required" }, 400);
  if (contactUserId === loaded.user.id) {
    return c.json({ error: "Cannot add yourself" }, 400);
  }

  const target = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
    .bind(contactUserId)
    .first();
  if (!target) return c.json({ error: "User not found" }, 404);

  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO contacts (owner_user_id, contact_user_id, display_alias, created_at, blocked)
     VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(owner_user_id, contact_user_id) DO UPDATE SET display_alias = excluded.display_alias`,
  )
    .bind(loaded.user.id, contactUserId, body.displayAlias ?? null, now)
    .run();

  return c.json({ ok: true }, 201);
});

contactRoutes.delete("/contacts/:contactUserId", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);
  const contactUserId = c.req.param("contactUserId");
  await c.env.DB.prepare(
    `DELETE FROM contacts WHERE owner_user_id = ? AND contact_user_id = ?`,
  )
    .bind(loaded.user.id, contactUserId)
    .run();
  return c.json({ ok: true });
});

contactRoutes.post("/contacts/:contactUserId/block", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);
  const contactUserId = c.req.param("contactUserId");
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO contacts (owner_user_id, contact_user_id, display_alias, created_at, blocked)
     VALUES (?, ?, NULL, ?, 1)
     ON CONFLICT(owner_user_id, contact_user_id) DO UPDATE SET blocked = 1`,
  )
    .bind(loaded.user.id, contactUserId, now)
    .run();
  return c.json({ ok: true });
});

// silence unused import until profile routes expand
void publicUser;
