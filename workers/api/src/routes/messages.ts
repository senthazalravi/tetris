import { Hono } from "hono";
import { MESSAGE_TTL_MS, MAX_CIPHERTEXT_BYTES } from "@lop/config";
import type { Env } from "../env";
import {
  loadSessionUser,
  readSessionToken,
  type AppVars,
} from "../lib/session";
import { randomId } from "../lib/crypto";

async function pushToUser(env: Env, userId: string, payload: unknown) {
  try {
    const id = env.USER_GATEWAY.idFromName(userId);
    const stub = env.USER_GATEWAY.get(id);
    await stub.fetch("https://do/push", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch {
    /* offline / local without DO is fine */
  }
}

export const messageRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

function b64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64Encode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

async function authed(c: {
  env: Env;
  req: { header: (n: string) => string | undefined };
}) {
  const token = readSessionToken(c as never);
  if (!token) return null;
  return loadSessionUser(c.env, token);
}

messageRoutes.post("/conversations", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ peerUserId?: string }>();
  const peerUserId = body.peerUserId ?? "";
  if (!peerUserId || peerUserId === loaded.user.id) {
    return c.json({ error: "Valid peerUserId required" }, 400);
  }

  const peer = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
    .bind(peerUserId)
    .first();
  if (!peer) return c.json({ error: "User not found" }, 404);

  const [userA, userB] =
    loaded.user.id < peerUserId
      ? [loaded.user.id, peerUserId]
      : [peerUserId, loaded.user.id];

  const existing = await c.env.DB.prepare(
    `SELECT conversation_id FROM direct_pairs WHERE user_a = ? AND user_b = ?`,
  )
    .bind(userA, userB)
    .first<{ conversation_id: string }>();

  if (existing) {
    // Re-join membership for current epoch if wiped
    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at, communication_epoch)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(
        existing.conversation_id,
        loaded.user.id,
        now,
        loaded.user.communication_epoch,
      )
      .run();
    return c.json({ conversationId: existing.conversation_id });
  }

  const now = Date.now();
  const conversationId = randomId("cnv");
  await c.env.DB.prepare(
    `INSERT INTO conversations (id, type, created_at) VALUES (?, 'direct', ?)`,
  )
    .bind(conversationId, now)
    .run();

  await c.env.DB.prepare(
    `INSERT INTO conversation_members (conversation_id, user_id, joined_at, communication_epoch)
     VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
  )
    .bind(
      conversationId,
      loaded.user.id,
      now,
      loaded.user.communication_epoch,
      conversationId,
      peerUserId,
      now,
      // peer keeps their own epoch; store their current
      (
        await c.env.DB.prepare(
          `SELECT communication_epoch FROM users WHERE id = ?`,
        )
          .bind(peerUserId)
          .first<{ communication_epoch: number }>()
      )?.communication_epoch ?? 1,
    )
    .run();

  await c.env.DB.prepare(
    `INSERT INTO direct_pairs (user_a, user_b, conversation_id) VALUES (?, ?, ?)`,
  )
    .bind(userA, userB, conversationId)
    .run();

  // Auto-save contact for initiator
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO contacts (owner_user_id, contact_user_id, display_alias, created_at, blocked)
     VALUES (?, ?, NULL, ?, 0)`,
  )
    .bind(loaded.user.id, peerUserId, now)
    .run();

  return c.json({ conversationId }, 201);
});

messageRoutes.get("/conversations", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const rows = await c.env.DB.prepare(
    `SELECT cm.conversation_id, c.created_at
     FROM conversation_members cm
     JOIN conversations c ON c.id = cm.conversation_id
     WHERE cm.user_id = ? AND cm.communication_epoch = ?
     ORDER BY c.created_at DESC`,
  )
    .bind(loaded.user.id, loaded.user.communication_epoch)
    .all<{ conversation_id: string; created_at: number }>();

  const conversations = [];
  for (const row of rows.results ?? []) {
    const peer = await c.env.DB.prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_ref
       FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.conversation_id = ? AND cm.user_id != ?
       LIMIT 1`,
    )
      .bind(row.conversation_id, loaded.user.id)
      .first<{
        id: string;
        username: string;
        display_name: string;
        avatar_ref: string | null;
      }>();

    conversations.push({
      id: row.conversation_id,
      createdAt: row.created_at,
      peer: peer
        ? {
            userId: peer.id,
            username: peer.username,
            displayName: peer.display_name,
            avatarUrl: peer.avatar_ref,
          }
        : null,
    });
  }

  return c.json({ conversations });
});

messageRoutes.post("/conversations/:id/messages", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const conversationId = c.req.param("id");
  const membership = await c.env.DB.prepare(
    `SELECT communication_epoch FROM conversation_members
     WHERE conversation_id = ? AND user_id = ?`,
  )
    .bind(conversationId, loaded.user.id)
    .first<{ communication_epoch: number }>();
  if (!membership) return c.json({ error: "Not a member" }, 403);
  if (membership.communication_epoch !== loaded.user.communication_epoch) {
    return c.json({ error: "Stale communication epoch" }, 409);
  }

  const body = await c.req.json<{
    messageId?: string;
    deviceId?: string;
    communicationEpoch?: number;
    cryptoHeader?: string;
    ciphertext?: string;
  }>();

  if (
    !body.messageId ||
    !body.deviceId ||
    !body.cryptoHeader ||
    !body.ciphertext ||
    body.communicationEpoch !== loaded.user.communication_epoch
  ) {
    return c.json({ error: "Invalid message payload" }, 400);
  }

  const headerBytes = b64Decode(body.cryptoHeader);
  const cipherBytes = b64Decode(body.ciphertext);
  if (cipherBytes.byteLength > MAX_CIPHERTEXT_BYTES) {
    return c.json({ error: "Ciphertext too large" }, 413);
  }

  const now = Date.now();
  const expiresAt = now + MESSAGE_TTL_MS;

  try {
    await c.env.DB.prepare(
      `INSERT INTO messages (
        id, conversation_id, sender_user_id, sender_device_id, communication_epoch,
        ciphertext, crypto_header, created_at, expires_at, delivery_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted')`,
    )
      .bind(
        body.messageId,
        conversationId,
        loaded.user.id,
        body.deviceId,
        loaded.user.communication_epoch,
        cipherBytes,
        headerBytes,
        now,
        expiresAt,
      )
      .run();
  } catch {
    return c.json({ error: "Duplicate or invalid message id" }, 409);
  }

  const peers = await c.env.DB.prepare(
    `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?`,
  )
    .bind(conversationId, loaded.user.id)
    .all<{ user_id: string }>();
  for (const peer of peers.results ?? []) {
    // Keep peer membership + contact so the chat appears on their side.
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO contacts (owner_user_id, contact_user_id, display_alias, created_at, blocked)
       VALUES (?, ?, NULL, ?, 0)`,
    )
      .bind(peer.user_id, loaded.user.id, now)
      .run();
    await pushToUser(c.env, peer.user_id, {
      type: "message.new",
      conversationId,
      messageId: body.messageId,
    });
    await pushToUser(c.env, peer.user_id, {
      type: "conversation.refresh",
      conversationId,
    });
  }

  return c.json({
    messageId: body.messageId,
    createdAt: now,
    expiresAt,
    deliveryState: "accepted",
  }, 201);
});

messageRoutes.get("/conversations/:id/messages", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const conversationId = c.req.param("id");
  const membership = await c.env.DB.prepare(
    `SELECT 1 as ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?`,
  )
    .bind(conversationId, loaded.user.id)
    .first();
  if (!membership) return c.json({ error: "Not a member" }, 403);

  const now = Date.now();
  const rows = await c.env.DB.prepare(
    `SELECT id, sender_user_id, sender_device_id, ciphertext, crypto_header,
            created_at, expires_at, delivery_state
     FROM messages
     WHERE conversation_id = ? AND expires_at > ?
     ORDER BY created_at ASC
     LIMIT 200`,
  )
    .bind(conversationId, now)
    .all<{
      id: string;
      sender_user_id: string;
      sender_device_id: string;
      ciphertext: ArrayBuffer;
      crypto_header: ArrayBuffer;
      created_at: number;
      expires_at: number;
      delivery_state: string;
    }>();

  return c.json({
    messages: (rows.results ?? []).map((m) => ({
      id: m.id,
      senderUserId: m.sender_user_id,
      senderDeviceId: m.sender_device_id,
      ciphertext: b64Encode(m.ciphertext),
      cryptoHeader: b64Encode(m.crypto_header),
      createdAt: m.created_at,
      expiresAt: m.expires_at,
      deliveryState: m.delivery_state,
    })),
  });
});

messageRoutes.post("/messages/:id/ack", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const messageId = c.req.param("id");
  const body = await c.req.json<{ state?: "delivered" | "read" }>();
  if (body.state !== "delivered" && body.state !== "read") {
    return c.json({ error: "Invalid state" }, 400);
  }

  const msg = await c.env.DB.prepare(
    `SELECT id, conversation_id, sender_user_id, delivery_state FROM messages WHERE id = ?`,
  )
    .bind(messageId)
    .first<{
      id: string;
      conversation_id: string;
      sender_user_id: string;
      delivery_state: string;
    }>();
  if (!msg) return c.json({ error: "Not found" }, 404);
  if (msg.sender_user_id === loaded.user.id) {
    return c.json({ ok: true, deliveryState: msg.delivery_state });
  }

  const member = await c.env.DB.prepare(
    `SELECT 1 as ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?`,
  )
    .bind(msg.conversation_id, loaded.user.id)
    .first();
  if (!member) return c.json({ error: "Forbidden" }, 403);

  const rank = { accepted: 0, delivered: 1, read: 2 } as Record<string, number>;
  if ((rank[body.state] ?? 0) > (rank[msg.delivery_state] ?? 0)) {
    await c.env.DB.prepare(
      `UPDATE messages SET delivery_state = ? WHERE id = ?`,
    )
      .bind(body.state, messageId)
      .run();
    await pushToUser(c.env, msg.sender_user_id, {
      type: body.state === "read" ? "message.read" : "message.delivered",
      messageId,
      conversationId: msg.conversation_id,
    });
  }

  return c.json({ ok: true, deliveryState: body.state });
});

messageRoutes.delete("/messages/:id", async (c) => {
  const loaded = await authed(c);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);
  const messageId = c.req.param("id");
  const scope = c.req.query("scope") ?? "me"; // me | everyone

  const msg = await c.env.DB.prepare(
    `SELECT id, conversation_id, sender_user_id FROM messages WHERE id = ?`,
  )
    .bind(messageId)
    .first<{ id: string; conversation_id: string; sender_user_id: string }>();
  if (!msg) return c.json({ error: "Not found" }, 404);

  if (scope === "everyone") {
    if (msg.sender_user_id !== loaded.user.id) {
      return c.json({ error: "Only sender can delete for everyone" }, 403);
    }
    await c.env.DB.prepare(`DELETE FROM messages WHERE id = ?`)
      .bind(messageId)
      .run();
    const peers = await c.env.DB.prepare(
      `SELECT user_id FROM conversation_members WHERE conversation_id = ?`,
    )
      .bind(msg.conversation_id)
      .all<{ user_id: string }>();
    for (const peer of peers.results ?? []) {
      await pushToUser(c.env, peer.user_id, {
        type: "message.deleted",
        messageId,
        conversationId: msg.conversation_id,
      });
    }
    return c.json({ ok: true });
  }

  // delete for me: mark via tombstone in ciphertext not available — soft-hide client-side;
  // for shared DB we replace ciphertext with empty deleted marker for this user only is hard.
  // MVP: if sender, delete for everyone; else client hides locally.
  return c.json({ ok: true, localOnly: true });
});
