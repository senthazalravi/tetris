import { Hono } from "hono";
import type { ContactDto } from "@lop/types";
import { avatarUrl, requireUnlocked, type AppEnv } from "../lib/session";
import { hit } from "../lib/ratelimit";

export const contactRoutes = new Hono<AppEnv>();

/** Only ever the caller's own rows. */
contactRoutes.get("/contacts", requireUnlocked, async (c) => {
  const me = c.get("user");
  const rows = await c.env.DB.prepare(
    `SELECT ct.contact_user_id, ct.blocked, ct.created_at,
            u.username, u.display_name, u.avatar_version
     FROM contacts ct JOIN users u ON u.id = ct.contact_user_id
     WHERE ct.owner_user_id = ?
     ORDER BY u.display_name COLLATE NOCASE ASC`,
  )
    .bind(me.id)
    .all<{
      contact_user_id: string;
      blocked: number;
      created_at: number;
      username: string;
      display_name: string;
      avatar_version: number;
    }>();

  const contacts: ContactDto[] = (rows.results ?? []).map((r) => ({
    userId: r.contact_user_id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: avatarUrl(r.contact_user_id, r.avatar_version),
    blocked: r.blocked === 1,
    createdAt: r.created_at,
  }));
  return c.json({ contacts });
});

contactRoutes.post("/contacts", requireUnlocked, async (c) => {
  const me = c.get("user");
  if (!(await hit(c.env, `contact:${me.id}`, 60, 60_000))) {
    return c.json({ error: "Too many requests" }, 429);
  }
  const body = await c.req
    .json<{ userId?: string }>()
    .catch(() => ({}) as { userId?: string });
  const target = body.userId ?? "";
  if (!target) return c.json({ error: "userId required" }, 400);
  if (target === me.id) return c.json({ error: "You can't add yourself" }, 400);

  const exists = await c.env.DB.prepare(`SELECT 1 AS x FROM users WHERE id = ?`)
    .bind(target)
    .first();
  if (!exists) return c.json({ error: "User not found" }, 404);

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO contacts (owner_user_id, contact_user_id, created_at, blocked)
     VALUES (?, ?, ?, 0)`,
  )
    .bind(me.id, target, Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

contactRoutes.delete("/contacts/:userId", requireUnlocked, async (c) => {
  const me = c.get("user");
  await c.env.DB.prepare(
    `DELETE FROM contacts WHERE owner_user_id = ? AND contact_user_id = ? AND blocked = 0`,
  )
    .bind(me.id, c.req.param("userId"))
    .run();
  return c.json({ ok: true });
});

contactRoutes.post("/contacts/:userId/block", requireUnlocked, async (c) => {
  const me = c.get("user");
  const target = c.req.param("userId");
  if (target === me.id) return c.json({ error: "Invalid target" }, 400);
  const body = await c.req
    .json<{ blocked?: boolean }>()
    .catch(() => ({}) as { blocked?: boolean });
  const blocked = body.blocked === false ? 0 : 1;
  await c.env.DB.prepare(
    `INSERT INTO contacts (owner_user_id, contact_user_id, created_at, blocked)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(owner_user_id, contact_user_id) DO UPDATE SET blocked = ?4`,
  )
    .bind(me.id, target, Date.now(), blocked)
    .run();
  return c.json({ ok: true, blocked: blocked === 1 });
});
