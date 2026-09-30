import { Hono } from "hono";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_USER_ATTACHMENT_BYTES,
  PENDING_ATTACHMENT_TTL_MS,
} from "@lop/config";
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
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_ATTACHMENT_BYTES + CIPHER_OVERHEAD) {
    return c.json({ error: "File too large (25 MB max)" }, 413);
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength <= CIPHER_OVERHEAD || bytes.byteLength > MAX_ATTACHMENT_BYTES + CIPHER_OVERHEAD) {
    return c.json({ error: "File too large (25 MB max)" }, 413);
  }

  const used = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(size), 0) AS total FROM attachments WHERE owner_user_id = ?`,
  )
    .bind(me.id)
    .first<{ total: number }>();
  if ((used?.total ?? 0) + bytes.byteLength > MAX_USER_ATTACHMENT_BYTES) {
    return c.json({ error: "Attachment quota reached. It frees up as files expire." }, 413);
  }

  const id = randomId("att");
  const key = `att/${convId}/${id}`;
  await c.env.ATTACHMENTS.put(key, bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO attachments (id, owner_user_id, conversation_id, message_id, object_key, size, created_at, expires_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
  )
    .bind(id, me.id, convId, key, bytes.byteLength, now, now + PENDING_ATTACHMENT_TTL_MS)
    .run();
  return c.json({ attachmentId: id, size: bytes.byteLength }, 201);
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
