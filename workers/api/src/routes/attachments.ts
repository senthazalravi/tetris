import { Hono } from "hono";
import { MAX_ATTACHMENT_BYTES, MESSAGE_TTL_MS } from "@lop/config";
import type { Env } from "../env";
import {
  loadSessionUser,
  readSessionToken,
  type AppVars,
} from "../lib/session";
import { randomId } from "../lib/crypto";

export const attachmentRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

async function authed(c: {
  env: Env;
  req: { header: (n: string) => string | undefined };
}) {
  const token = readSessionToken(c as never);
  if (!token) return null;
  return loadSessionUser(c.env, token);
}

attachmentRoutes.post("/attachments/upload-token", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ size?: number }>();
  const size = body.size ?? 0;
  if (size <= 0 || size > MAX_ATTACHMENT_BYTES) {
    return c.json({ error: "Invalid attachment size" }, 400);
  }

  const attachmentId = randomId("att");
  const objectKey = `${loaded.user.id}/${attachmentId}`;
  const expiresAt = Date.now() + MESSAGE_TTL_MS;

  // Placeholder row until complete — message_id filled on complete
  await c.env.DB.prepare(
    `INSERT INTO attachments (id, message_id, object_key, ciphertext_size, expires_at)
     VALUES (?, '', ?, ?, ?)`,
  )
    .bind(attachmentId, objectKey, size, expiresAt)
    .run();

  return c.json({
    attachmentId,
    objectKey,
    uploadPath: `/api/v1/attachments/${attachmentId}/data`,
    expiresAt,
  });
});

attachmentRoutes.put("/attachments/:id/data", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT id, object_key, ciphertext_size FROM attachments WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: string; object_key: string; ciphertext_size: number }>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!row.object_key.startsWith(`${loaded.user.id}/`)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_ATTACHMENT_BYTES) {
    return c.json({ error: "Invalid body size" }, 400);
  }

  await c.env.ATTACHMENTS.put(row.object_key, buf, {
    httpMetadata: { contentType: "application/octet-stream" },
  });

  await c.env.DB.prepare(
    `UPDATE attachments SET ciphertext_size = ? WHERE id = ?`,
  )
    .bind(buf.byteLength, id)
    .run();

  return c.json({ ok: true, ciphertextSize: buf.byteLength });
});

attachmentRoutes.post("/attachments/:id/complete", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = await c.req.json<{ messageId?: string }>();
  if (!body.messageId) return c.json({ error: "messageId required" }, 400);

  const row = await c.env.DB.prepare(
    `SELECT id, object_key FROM attachments WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: string; object_key: string }>();
  if (!row || !row.object_key.startsWith(`${loaded.user.id}/`)) {
    return c.json({ error: "Not found" }, 404);
  }

  await c.env.DB.prepare(`UPDATE attachments SET message_id = ? WHERE id = ?`)
    .bind(body.messageId, id)
    .run();

  return c.json({ ok: true });
});

attachmentRoutes.get("/attachments/:id/download", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT object_key, expires_at FROM attachments WHERE id = ?`,
  )
    .bind(id)
    .first<{ object_key: string; expires_at: number }>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.expires_at <= Date.now()) return c.json({ error: "Expired" }, 410);

  const obj = await c.env.ATTACHMENTS.get(row.object_key);
  if (!obj) return c.json({ error: "Missing object" }, 404);

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
});
