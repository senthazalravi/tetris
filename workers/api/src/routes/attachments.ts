import { Hono } from "hono";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  MAX_USER_ATTACHMENT_BYTES,
  PENDING_ATTACHMENT_TTL_MS,
} from "@tetris/config";
import { requireUnlocked, type AppEnv } from "../lib/session";
import { hit } from "../lib/ratelimit";
import { randomId } from "../lib/util";

export const attachmentRoutes = new Hono<AppEnv>();

/** AES-GCM adds a 12-byte nonce + 16-byte tag. */
const CIPHER_OVERHEAD = 28;

async function isMember(
  db: D1Database,
  convId: string,
  userId: string,
  epoch: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM conversation_members
       WHERE conversation_id = ? AND user_id = ? AND communication_epoch = ?`,
    )
    .bind(convId, userId, epoch)
    .first();
  return Boolean(row);
}

/** Upload one already-encrypted blob. The server cannot read it. */
attachmentRoutes.put("/conversations/:id/attachments", requireUnlocked, async (c) => {
  const me = c.get("user");
  const convId = c.req.param("id");
  if (!(await hit(c.env, `upload:${me.id}`, 40, 60_000))) {
    return c.json({ error: "Uploading too fast" }, 429);
  }
  if (!(await isMember(c.env.DB, convId, me.id, me.communication_epoch))) {
    return c.json({ error: "Not a member of this conversation" }, 403);
  }
  // Stream straight into R2: a Worker only has 128 MB of memory, so never
  // buffer a whole upload. The length must be declared up front.
  const size = Number(c.req.header("content-length") ?? 0);
  const limit = MAX_ATTACHMENT_BYTES + CIPHER_OVERHEAD;
  if (!Number.isFinite(size) || size <= CIPHER_OVERHEAD) {
    return c.json({ error: "Empty or unsized upload" }, 400);
  }
  if (size > limit) {
    return c.json({ error: "File too large (90 MB max)" }, 413);
  }
  if (!c.req.raw.body) return c.json({ error: "Empty upload" }, 400);

  const used = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(size), 0) AS total FROM attachments WHERE owner_user_id = ?`,
  )
    .bind(me.id)
    .first<{ total: number }>();
  // Free-tier guard: never let total stored bytes approach the R2 free allowance.
  const everyone = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(size), 0) AS total FROM attachments`,
  ).first<{ total: number }>();
  if ((everyone?.total ?? 0) + size > MAX_TOTAL_ATTACHMENT_BYTES) {
    return c.json({ error: "Storage is full for now. It frees up as files expire." }, 507);
  }
  if ((used?.total ?? 0) + size > MAX_USER_ATTACHMENT_BYTES) {
    return c.json({ error: "Attachment quota reached. It frees up as files expire." }, 413);
  }

  const id = randomId("att");
  const key = `att/${convId}/${id}`;
  const stored = await c.env.ATTACHMENTS.put(key, c.req.raw.body, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  if (stored.size !== size) {
    await c.env.ATTACHMENTS.delete(key);
    return c.json({ error: "Upload was cut short" }, 400);
  }
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO attachments (id, owner_user_id, conversation_id, message_id, object_key, size, created_at, expires_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
  )
    .bind(id, me.id, convId, key, size, now, now + PENDING_ATTACHMENT_TTL_MS)
    .run();
  return c.json({ attachmentId: id, size }, 201);
});

attachmentRoutes.get("/attachments/:id", requireUnlocked, async (c) => {
  const me = c.get("user");
  const row = await c.env.DB.prepare(
    `SELECT owner_user_id, conversation_id, message_id, object_key, expires_at
     FROM attachments WHERE id = ?`,
  )
    .bind(c.req.param("id"))
    .first<{
      owner_user_id: string;
      conversation_id: string;
      message_id: string | null;
      object_key: string;
      expires_at: number;
    }>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.expires_at <= Date.now()) return c.json({ error: "This file has expired" }, 410);
  if (!(await isMember(c.env.DB, row.conversation_id, me.id, me.communication_epoch))) {
    return c.json({ error: "Not found" }, 404);
  }
  if (!row.message_id && row.owner_user_id !== me.id) {
    return c.json({ error: "Not found" }, 404);
  }
  const obj = await c.env.ATTACHMENTS.get(row.object_key);
  if (!obj) return c.json({ error: "This file has expired" }, 410);
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(obj.size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
