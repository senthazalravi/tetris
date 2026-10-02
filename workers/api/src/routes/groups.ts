import { Hono } from "hono";
import {
  GROUP_CODE_ATTEMPTS,
  GROUP_CODE_PATTERN,
  UNLOCK_WINDOW_MS,
} from "@tetris/config";
import type { Env } from "../env";
import { requireUnlocked, type AppEnv } from "../lib/session";
import { hit } from "../lib/ratelimit";
import { pushToUser } from "../lib/push";
import { verifyGroupCode } from "../lib/groupcode";

/**
 * Entry code for a group. Each member gets one run at it: the first time they
 * open the group the clock starts (30 seconds, the same window as sign-in) and
 * they have two tries. The right code opens the group for good; a wrong second
 * try, or the clock running out, closes it for good. Everything is decided
 * here on the server, so a modified client gains nothing.
 */
export const groupRoutes = new Hono<AppEnv>();

/** A little slack for the network on top of the 30 seconds the person sees. */
const GRACE_MS = 3_000;

/** Close a group to one person for good: no sync, no messages, no notifications. */
export async function denyMember(env: Env, convId: string, userId: string) {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE group_members SET access = 'denied'
       WHERE conversation_id = ?1 AND user_id = ?2 AND access = 'pending'`,
    ).bind(convId, userId),
    env.DB.prepare(
      `DELETE FROM conversation_members WHERE conversation_id = ?1 AND user_id = ?2`,
    ).bind(convId, userId),
    env.DB.prepare(
      `DELETE FROM messages WHERE conversation_id = ?1 AND recipient_user_id = ?2`,
    ).bind(convId, userId),
  ]);
}

/** Anyone whose 30 seconds ran out without a right code is shut out now. */
export async function settleGroupAccess(env: Env, userId: string) {
  const stale = await env.DB.prepare(
    `SELECT conversation_id FROM group_members
     WHERE user_id = ? AND access = 'pending' AND unlock_started_at IS NOT NULL
       AND unlock_started_at < ?`,
  )
    .bind(userId, Date.now() - UNLOCK_WINDOW_MS - GRACE_MS)
    .all<{ conversation_id: string }>();
  for (const r of stale.results ?? [])
    await denyMember(env, r.conversation_id, userId);
}

interface Row {
  access: "pending" | "granted" | "denied";
  attempts: number;
  unlock_started_at: number | null;
  access_code_hash: string | null;
}

function loadRow(env: Env, convId: string, userId: string) {
  return env.DB.prepare(
    `SELECT gm.access, gm.attempts, gm.unlock_started_at, c.access_code_hash
     FROM group_members gm JOIN conversations c ON c.id = gm.conversation_id
     WHERE gm.conversation_id = ? AND gm.user_id = ? AND c.kind = 'group'`,
  )
    .bind(convId, userId)
    .first<Row>();
}

const expired = (startedAt: number) =>
  Date.now() > startedAt + UNLOCK_WINDOW_MS + GRACE_MS;

/** The clock starts the first time the group is opened; reopening keeps the same clock. */
groupRoutes.post("/groups/:id/unlock/start", requireUnlocked, async (c) => {
  const me = c.get("user");
  const convId = c.req.param("id");
  if (!(await hit(c.env, `gstart:${me.id}`, 30, 60_000))) {
    return c.json({ error: "Too many requests" }, 429);
  }
  let row = await loadRow(c.env, convId, me.id);
  if (!row) return c.json({ error: "Group not found" }, 404);
  if (row.access === "granted") return c.json({ access: "granted" });
  if (row.access === "denied") return c.json({ access: "denied" }, 403);

  if (row.unlock_started_at === null) {
    await c.env.DB.prepare(
      `UPDATE group_members SET unlock_started_at = ?
       WHERE conversation_id = ? AND user_id = ? AND unlock_started_at IS NULL`,
    )
      .bind(Date.now(), convId, me.id)
      .run();
    row = (await loadRow(c.env, convId, me.id)) ?? row;
  }
  const startedAt = row.unlock_started_at ?? Date.now();
  if (Date.now() > startedAt + UNLOCK_WINDOW_MS) {
    await denyMember(c.env, convId, me.id);
    return c.json({ access: "denied" }, 403);
  }
  return c.json({
    access: "pending",
    remainingMs: startedAt + UNLOCK_WINDOW_MS - Date.now(),
    attemptsLeft: Math.max(0, GROUP_CODE_ATTEMPTS - row.attempts),
  });
});

groupRoutes.post("/groups/:id/unlock", requireUnlocked, async (c) => {
  const me = c.get("user");
  const convId = c.req.param("id");
  if (!(await hit(c.env, `gunlock:${me.id}`, 20, 60_000))) {
    return c.json({ error: "Too many requests" }, 429);
  }
  const body = await c.req
    .json<{ code?: string }>()
    .catch(() => ({}) as { code?: string });
  if (typeof body.code !== "string" || !GROUP_CODE_PATTERN.test(body.code)) {
    return c.json({ error: "The code is four digits." }, 400);
  }

  const row = await loadRow(c.env, convId, me.id);
  if (!row) return c.json({ error: "Group not found" }, 404);
  if (row.access === "granted") return c.json({ ok: true });
  if (row.access === "denied") return c.json({ ok: false, denied: true }, 403);
  if (row.unlock_started_at === null)
    return c.json({ error: "Open the group first." }, 409);
  if (expired(row.unlock_started_at)) {
    await denyMember(c.env, convId, me.id);
    return c.json({ ok: false, denied: true }, 403);
  }
  if (!row.access_code_hash)
    return c.json({ error: "This group has no code yet." }, 503);

  // Count the try before checking it, so parallel guesses cannot beat the limit.
  const counted = await c.env.DB.prepare(
    `UPDATE group_members SET attempts = attempts + 1
     WHERE conversation_id = ? AND user_id = ? AND access = 'pending' AND attempts < ?`,
  )
    .bind(convId, me.id, GROUP_CODE_ATTEMPTS)
    .run();
  if (!counted.meta.changes) {
    await denyMember(c.env, convId, me.id);
    return c.json({ ok: false, denied: true }, 403);
  }

  if (await verifyGroupCode(body.code, row.access_code_hash)) {
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE group_members SET access = 'granted'
         WHERE conversation_id = ?1 AND user_id = ?2 AND access = 'pending'`,
      ).bind(convId, me.id),
      c.env.DB.prepare(
        `INSERT INTO conversation_members (conversation_id, user_id, joined_at, communication_epoch)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(conversation_id, user_id) DO UPDATE SET communication_epoch = ?4`,
      ).bind(convId, me.id, now, me.communication_epoch),
    ]);
    // Everyone already inside needs the new member in their roster to include them.
    const members = await c.env.DB.prepare(
      `SELECT user_id FROM group_members WHERE conversation_id = ? AND access = 'granted'`,
    )
      .bind(convId)
      .all<{ user_id: string }>();
    for (const m of members.results ?? []) {
      await pushToUser(c.env, m.user_id, { type: "conversation.refresh" });
    }
    return c.json({ ok: true });
  }

  const left = GROUP_CODE_ATTEMPTS - (row.attempts + 1);
  if (left <= 0) {
    await denyMember(c.env, convId, me.id);
    return c.json({ ok: false, denied: true }, 403);
  }
  return c.json({ ok: false, attemptsLeft: left });
});
