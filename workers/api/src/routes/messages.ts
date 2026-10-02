import { Hono } from "hono";
import { GROUP_MESSAGE_TTL_MS, MAX_CIPHERTEXT_BYTES, MESSAGE_TTL_MS } from "@tetris/config";
import type {
  ConversationDto,
  ConversationPeer,
  GroupCopy,
  SyncMessage,
} from "@tetris/types";
import type { Env } from "../env";
import { avatarUrl, requireUnlocked, type AppEnv } from "../lib/session";
import { hit } from "../lib/ratelimit";
import { pushToUser } from "../lib/push";
import {
  MESSAGE_ID_PATTERN,
  b64Decode,
  b64Encode,
  isBase64,
  randomId,
} from "../lib/util";

export const messageRoutes = new Hono<AppEnv>();

/* -------------------------- conversation list -------------------------- */

const CONVERSATION_SELECT = `
  SELECT c.id, c.last_message_at, u.id AS uid, u.username, u.display_name, u.avatar_version,
         d.id AS device_id, d.identity_key, d.signing_key,
         COALESCE(ct.blocked, 0) AS blocked
  FROM conversation_members cm
  JOIN conversations c ON c.id = cm.conversation_id
  JOIN users u ON u.id = CASE WHEN c.user_a = ?1 THEN c.user_b ELSE c.user_a END
  LEFT JOIN devices d ON d.user_id = u.id AND d.revoked_at IS NULL
  LEFT JOIN contacts ct ON ct.owner_user_id = ?1 AND ct.contact_user_id = u.id
  WHERE cm.user_id = ?1 AND cm.communication_epoch = ?2 AND c.kind = 'dm'`;

type ConvRow = {
  id: string;
  last_message_at: number;
  uid: string;
  username: string;
  display_name: string;
  avatar_version: number;
  device_id: string | null;
  identity_key: string | null;
  signing_key: string | null;
  blocked: number;
};

function toDto(r: ConvRow): ConversationDto {
  return {
    id: r.id,
    lastMessageAt: r.last_message_at,
    blocked: r.blocked === 1,
    peer: {
      userId: r.uid,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: avatarUrl(r.uid, r.avatar_version),
      deviceId: r.device_id,
      identityKey: r.identity_key,
      signingKey: r.signing_key,
    },
  };
}

async function loadConversation(env: Env, meId: string, epoch: number, id: string) {
  const row = await env.DB.prepare(`${CONVERSATION_SELECT} AND c.id = ?3`)
    .bind(meId, epoch, id)
    .first<ConvRow>();
  return row ? toDto(row) : null;
}

type GroupMemberRow = {
  uid: string;
  username: string;
  display_name: string;
  avatar_version: number;
  device_id: string | null;
  identity_key: string | null;
  signing_key: string | null;
};

function memberToPeer(r: GroupMemberRow): ConversationPeer {
  return {
    userId: r.uid,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: avatarUrl(r.uid, r.avatar_version),
    deviceId: r.device_id,
    identityKey: r.identity_key,
    signingKey: r.signing_key,
  };
}

/** Members of one group with their current device keys. */
async function loadGroupMembers(env: Env, convId: string): Promise<ConversationPeer[]> {
  const rows = await env.DB.prepare(
    `SELECT u.id AS uid, u.username, u.display_name, u.avatar_version,
            d.id AS device_id, d.identity_key, d.signing_key
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     LEFT JOIN devices d ON d.user_id = u.id AND d.revoked_at IS NULL
     WHERE gm.conversation_id = ?
     ORDER BY u.username`,
  )
    .bind(convId)
    .all<GroupMemberRow>();
  return (rows.results ?? []).map(memberToPeer);
}

/**
 * Group conversations the user belongs to. Membership is permanent, but sync
 * and attachments key off conversation_members for the current epoch, so
 * refresh that row here (a wipe clears it).
 */
async function loadGroups(env: Env, me: { id: string; communication_epoch: number }) {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name, c.last_message_at
     FROM group_members gm JOIN conversations c ON c.id = gm.conversation_id
     WHERE gm.user_id = ? AND c.kind = 'group'`,
  )
    .bind(me.id)
    .all<{ id: string; name: string | null; last_message_at: number }>();
  const groups = rows.results ?? [];
  if (groups.length) {
    const now = Date.now();
    await env.DB.batch(
      groups.map((g) =>
        env.DB.prepare(
          `INSERT INTO conversation_members (conversation_id, user_id, joined_at, communication_epoch)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(conversation_id, user_id) DO UPDATE SET communication_epoch = ?4`,
        ).bind(g.id, me.id, now, me.communication_epoch),
      ),
    );
  }
  const out: ConversationDto[] = [];
  for (const g of groups) {
    const members = await loadGroupMembers(env, g.id);
    const name = g.name ?? "Group";
    out.push({
      id: g.id,
      lastMessageAt: g.last_message_at,
      blocked: false,
      peer: {
        userId: g.id,
        username: name,
        displayName: name,
        avatarUrl: null,
        deviceId: null,
        identityKey: null,
        signingKey: null,
      },
      group: { name, members },
    });
  }
  return out;
}

messageRoutes.get("/conversations", requireUnlocked, async (c) => {
  const me = c.get("user");
  const rows = await c.env.DB.prepare(
    `${CONVERSATION_SELECT} ORDER BY c.last_message_at DESC`,
  )
    .bind(me.id, me.communication_epoch)
    .all<ConvRow>();
  const groups = await loadGroups(c.env, me);
  const all = [...(rows.results ?? []).map(toDto), ...groups].sort(
    (a, b) => b.lastMessageAt - a.lastMessageAt,
  );
  return c.json({ conversations: all });
});

/** Open (or create) the 1:1 conversation with someone found by exact username. */
messageRoutes.post("/conversations", requireUnlocked, async (c) => {
  const me = c.get("user");
  if (!(await hit(c.env, `conv:${me.id}`, 30, 60_000))) {
    return c.json({ error: "Too many requests" }, 429);
  }
  const body = await c.req
    .json<{ peerUserId?: string }>()
    .catch(() => ({}) as { peerUserId?: string });
  const peerId = body.peerUserId ?? "";
  if (!peerId || peerId === me.id) return c.json({ error: "Invalid user" }, 400);
  const peer = await c.env.DB.prepare(`SELECT 1 AS x FROM users WHERE id = ?`)
    .bind(peerId)
    .first();
  if (!peer) return c.json({ error: "User not found" }, 404);

  const [a, b] = me.id < peerId ? [me.id, peerId] : [peerId, me.id];
  const now = Date.now();
  let conv = await c.env.DB.prepare(
    `SELECT id FROM conversations WHERE user_a = ? AND user_b = ?`,
  )
    .bind(a, b)
    .first<{ id: string }>();
  if (!conv) {
    const id = randomId("cnv");
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO conversations (id, user_a, user_b, created_at, last_message_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, a, b, now, now)
      .run();
    conv = await c.env.DB.prepare(
      `SELECT id FROM conversations WHERE user_a = ? AND user_b = ?`,
    )
      .bind(a, b)
      .first<{ id: string }>();
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, joined_at, communication_epoch)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET communication_epoch = ?4`,
    ).bind(conv!.id, me.id, now, me.communication_epoch),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO contacts (owner_user_id, contact_user_id, created_at, blocked)
       VALUES (?, ?, ?, 0)`,
    ).bind(me.id, peerId, now),
  ]);

  const dto = await loadConversation(c.env, me.id, me.communication_epoch, conv!.id);
  return c.json({ conversation: dto }, 201);
});

/* ------------------------------ send ---------------------------------- */

async function memberOf(env: Env, convId: string, userId: string, epoch: number) {
  const row = await env.DB.prepare(
    `SELECT c.user_a, c.user_b, cm.communication_epoch
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?2
     WHERE c.id = ?1 AND c.kind = 'dm'`,
  )
    .bind(convId, userId)
    .first<{ user_a: string; user_b: string; communication_epoch: number }>();
  if (!row || row.communication_epoch !== epoch) return null;
  return { peerId: row.user_a === userId ? row.user_b : row.user_a };
}

interface SendBody {
  messageId?: string;
  senderDeviceId?: string;
  recipientDeviceId?: string;
  cryptoHeader?: string;
  ciphertext?: string;
  attachmentId?: string | null;
  /** false for invisible carriers (reactions, edits, votes): no email nudge. */
  notify?: boolean;
}

messageRoutes.post("/conversations/:id/messages", requireUnlocked, async (c) => {
  const me = c.get("user");
  if (!(await hit(c.env, `send:${me.id}`, 120, 60_000))) {
    return c.json({ error: "You're sending too fast" }, 429);
  }
  const convId = c.req.param("id");
  const member = await memberOf(c.env, convId, me.id, me.communication_epoch);
  if (!member) return c.json({ error: "Not a member of this conversation" }, 403);

  const body = await c.req.json<SendBody>().catch(() => ({}) as SendBody);
  if (
    !body.messageId ||
    !MESSAGE_ID_PATTERN.test(body.messageId) ||
    !body.senderDeviceId ||
    !body.recipientDeviceId ||
    !isBase64(body.cryptoHeader, 4096) ||
    !isBase64(body.ciphertext, MAX_CIPHERTEXT_BYTES)
  ) {
    return c.json({ error: "Invalid message payload" }, 400);
  }
  const header = b64Decode(body.cryptoHeader);
  const cipher = b64Decode(body.ciphertext);
  if (cipher.byteLength > MAX_CIPHERTEXT_BYTES) {
    return c.json({ error: "Message too large" }, 413);
  }

  const myDevice = await c.env.DB.prepare(
    `SELECT id FROM devices WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(me.id)
    .first<{ id: string }>();
  if (!myDevice || myDevice.id !== body.senderDeviceId) {
    return c.json({ error: "This device is no longer active", code: "DEVICE_INVALID" }, 409);
  }
  const peerDevice = await c.env.DB.prepare(
    `SELECT id FROM devices WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(member.peerId)
    .first<{ id: string }>();
  if (!peerDevice) {
    return c.json({ error: "They haven't finished setting up yet", code: "PEER_NOT_READY" }, 409);
  }
  if (peerDevice.id !== body.recipientDeviceId) {
    return c.json(
      { error: "Recipient keys changed", code: "DEVICE_CHANGED", currentDeviceId: peerDevice.id },
      409,
    );
  }

  let attachmentId: string | null = null;
  if (body.attachmentId) {
    const att = await c.env.DB.prepare(
      `SELECT id FROM attachments
       WHERE id = ? AND owner_user_id = ? AND conversation_id = ? AND message_id IS NULL`,
    )
      .bind(body.attachmentId, me.id, convId)
      .first();
    if (!att) return c.json({ error: "Attachment not found" }, 400);
    attachmentId = body.attachmentId;
  }

  // Idempotent retries: same id from the same sender returns the original stamp.
  const dup = await c.env.DB.prepare(
    `SELECT sender_user_id, created_at, expires_at FROM messages WHERE id = ?`,
  )
    .bind(body.messageId)
    .first<{ sender_user_id: string; created_at: number; expires_at: number }>();
  if (dup) {
    if (dup.sender_user_id !== me.id) return c.json({ error: "Duplicate id" }, 409);
    return c.json({ messageId: body.messageId, createdAt: dup.created_at, expiresAt: dup.expires_at });
  }

  const now = Date.now();
  const expiresAt = now + MESSAGE_TTL_MS;
  const peerUser = await c.env.DB.prepare(
    `SELECT communication_epoch FROM users WHERE id = ?`,
  )
    .bind(member.peerId)
    .first<{ communication_epoch: number }>();
  const hadMembership = await c.env.DB.prepare(
    `SELECT 1 AS x FROM conversation_members WHERE conversation_id = ? AND user_id = ?`,
  )
    .bind(convId, member.peerId)
    .first();

  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO messages (id, conversation_id, sender_user_id, sender_device_id,
         recipient_user_id, recipient_device_id, ciphertext, crypto_header, attachment_id,
         delivery_state, created_at, expires_at, updated_at, deleted_at, notify)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, NULL, ?)`,
    ).bind(
      body.messageId,
      convId,
      me.id,
      myDevice.id,
      member.peerId,
      peerDevice.id,
      cipher,
      header,
      attachmentId,
      now,
      expiresAt,
      now,
      body.notify === false ? 0 : 1,
    ),
    c.env.DB.prepare(`UPDATE conversations SET last_message_at = ? WHERE id = ?`).bind(now, convId),
    // Recipient's side of the thread exists as soon as something arrives (WhatsApp-style).
    c.env.DB.prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, joined_at, communication_epoch)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET communication_epoch = ?4`,
    ).bind(convId, member.peerId, now, peerUser?.communication_epoch ?? 1),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO contacts (owner_user_id, contact_user_id, created_at, blocked)
       VALUES (?, ?, ?, 0)`,
    ).bind(member.peerId, me.id, now),
  ];
  if (attachmentId) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE attachments SET message_id = ?, expires_at = ? WHERE id = ?`,
      ).bind(body.messageId, expiresAt, attachmentId),
    );
  }
  try {
    await c.env.DB.batch(stmts);
  } catch {
    return c.json({ error: "Could not store message" }, 409);
  }

  const blocked = await c.env.DB.prepare(
    `SELECT 1 AS x FROM contacts WHERE owner_user_id = ? AND contact_user_id = ? AND blocked = 1`,
  )
    .bind(member.peerId, me.id)
    .first();
  if (!blocked) {
    if (!hadMembership) await pushToUser(c.env, member.peerId, { type: "conversation.refresh" });
    await pushToUser(c.env, member.peerId, { type: "message.new", conversationId: convId });
  }

  return c.json({ messageId: body.messageId, createdAt: now, expiresAt }, 201);
});

/* --------------------------- group send ------------------------------- */

interface GroupSendBody {
  messageId?: string;
  senderDeviceId?: string;
  copies?: GroupCopy[];
  attachmentId?: string | null;
  /** false for invisible carriers (reactions, edits, votes): no email nudge. */
  notify?: boolean;
}

messageRoutes.post("/conversations/:id/group-messages", requireUnlocked, async (c) => {
  const me = c.get("user");
  if (!(await hit(c.env, `send:${me.id}`, 120, 60_000))) {
    return c.json({ error: "You're sending too fast" }, 429);
  }
  const convId = c.req.param("id");
  const isMember = await c.env.DB.prepare(
    `SELECT 1 AS x FROM group_members gm JOIN conversations c ON c.id = gm.conversation_id
     WHERE gm.conversation_id = ? AND gm.user_id = ? AND c.kind = 'group'`,
  )
    .bind(convId, me.id)
    .first();
  if (!isMember) return c.json({ error: "Not a member of this group" }, 403);

  const body = await c.req.json<GroupSendBody>().catch(() => ({}) as GroupSendBody);
  const copies = body.copies ?? [];
  if (
    !body.messageId ||
    !MESSAGE_ID_PATTERN.test(body.messageId) ||
    !body.senderDeviceId ||
    copies.length === 0 ||
    copies.length > 100
  ) {
    return c.json({ error: "Invalid message payload" }, 400);
  }
  const seen = new Set<string>();
  for (const cp of copies) {
    if (
      !cp ||
      typeof cp.recipientUserId !== "string" ||
      typeof cp.recipientDeviceId !== "string" ||
      cp.recipientUserId === me.id ||
      seen.has(cp.recipientUserId) ||
      !isBase64(cp.cryptoHeader, 4096) ||
      !isBase64(cp.ciphertext, MAX_CIPHERTEXT_BYTES)
    ) {
      return c.json({ error: "Invalid message payload" }, 400);
    }
    seen.add(cp.recipientUserId);
  }

  const myDevice = await c.env.DB.prepare(
    `SELECT id FROM devices WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(me.id)
    .first<{ id: string }>();
  if (!myDevice || myDevice.id !== body.senderDeviceId) {
    return c.json({ error: "This device is no longer active", code: "DEVICE_INVALID" }, 409);
  }

  // Every copy must go to a current member's current device.
  const ids = [...seen];
  const marks = ids.map((_, i) => `?${i + 2}`).join(",");
  const targets = await c.env.DB.prepare(
    `SELECT u.id AS uid, u.communication_epoch AS epoch, d.id AS device_id,
            (SELECT 1 FROM group_members gm WHERE gm.conversation_id = ?1 AND gm.user_id = u.id) AS member
     FROM users u LEFT JOIN devices d ON d.user_id = u.id AND d.revoked_at IS NULL
     WHERE u.id IN (${marks})`,
  )
    .bind(convId, ...ids)
    .all<{ uid: string; epoch: number; device_id: string | null; member: number | null }>();
  const byUser = new Map((targets.results ?? []).map((t) => [t.uid, t]));
  for (const cp of copies) {
    const t = byUser.get(cp.recipientUserId);
    if (!t || !t.member) return c.json({ error: "Recipient is not in this group" }, 400);
    if (!t.device_id) {
      return c.json(
        { error: "A member has not finished setting up", code: "PEER_NOT_READY", userId: t.uid },
        409,
      );
    }
    if (t.device_id !== cp.recipientDeviceId) {
      return c.json(
        {
          error: "Recipient keys changed",
          code: "DEVICE_CHANGED",
          userId: t.uid,
          currentDeviceId: t.device_id,
        },
        409,
      );
    }
  }

  let attachmentId: string | null = null;
  if (body.attachmentId) {
    const att = await c.env.DB.prepare(
      `SELECT id FROM attachments
       WHERE id = ? AND owner_user_id = ? AND conversation_id = ? AND message_id IS NULL`,
    )
      .bind(body.attachmentId, me.id, convId)
      .first();
    if (!att) return c.json({ error: "Attachment not found" }, 400);
    attachmentId = body.attachmentId;
  }

  // Idempotent retries.
  const dup = await c.env.DB.prepare(
    `SELECT sender_user_id, created_at, expires_at FROM messages WHERE id = ?`,
  )
    .bind(body.messageId)
    .first<{ sender_user_id: string; created_at: number; expires_at: number }>();
  if (dup) {
    if (dup.sender_user_id !== me.id) return c.json({ error: "Duplicate id" }, 409);
    return c.json({ messageId: body.messageId, createdAt: dup.created_at, expiresAt: dup.expires_at });
  }

  const now = Date.now();
  const expiresAt = now + GROUP_MESSAGE_TTL_MS;
  const insert = `INSERT INTO messages (id, conversation_id, sender_user_id, sender_device_id,
      recipient_user_id, recipient_device_id, ciphertext, crypto_header, attachment_id,
      delivery_state, created_at, expires_at, updated_at, deleted_at, group_msg_id, canonical, notify)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, NULL, ?, ?, ?)`;
  const notifyFlag = body.notify === false ? 0 : 1;
  const stmts = [
    // The sender's own row: no recipient, no ciphertext. It carries the aggregate receipt.
    c.env.DB.prepare(insert).bind(
      body.messageId,
      convId,
      me.id,
      myDevice.id,
      "",
      "",
      new Uint8Array(0),
      new Uint8Array(0),
      attachmentId,
      now,
      expiresAt,
      now,
      body.messageId,
      1,
      0,
    ),
    ...copies.map((cp) =>
      c.env.DB.prepare(insert).bind(
        randomId("msg"),
        convId,
        me.id,
        myDevice.id,
        cp.recipientUserId,
        cp.recipientDeviceId,
        b64Decode(cp.ciphertext),
        b64Decode(cp.cryptoHeader),
        null,
        now,
        expiresAt,
        now,
        body.messageId,
        0,
        notifyFlag,
      ),
    ),
    c.env.DB.prepare(`UPDATE conversations SET last_message_at = ? WHERE id = ?`).bind(now, convId),
    ...copies.map((cp) =>
      c.env.DB.prepare(
        `INSERT INTO conversation_members (conversation_id, user_id, joined_at, communication_epoch)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(conversation_id, user_id) DO UPDATE SET communication_epoch = ?4`,
      ).bind(convId, cp.recipientUserId, now, byUser.get(cp.recipientUserId)?.epoch ?? 1),
    ),
  ];
  if (attachmentId) {
    stmts.push(
      c.env.DB.prepare(`UPDATE attachments SET message_id = ?, expires_at = ? WHERE id = ?`).bind(
        body.messageId,
        expiresAt,
        attachmentId,
      ),
    );
  }
  try {
    await c.env.DB.batch(stmts);
  } catch {
    return c.json({ error: "Could not store message" }, 409);
  }
  // The recipients' rows carry the attachment id too (sync reads it per row).
  if (attachmentId) {
    await c.env.DB.prepare(
      `UPDATE messages SET attachment_id = ? WHERE group_msg_id = ? AND canonical = 0`,
    )
      .bind(attachmentId, body.messageId)
      .run();
  }

  for (const cp of copies) {
    await pushToUser(c.env, cp.recipientUserId, { type: "message.new", conversationId: convId });
  }
  return c.json({ messageId: body.messageId, createdAt: now, expiresAt }, 201);
});

/* ------------------------------ sync ---------------------------------- */

messageRoutes.get("/sync", requireUnlocked, async (c) => {
  const me = c.get("user");
  const ts = Math.max(0, Number(c.req.query("ts") ?? 0) || 0);
  const afterId = c.req.query("id") ?? "";
  const limit = 200;
  const now = Date.now();

  const dev = await c.env.DB.prepare(
    `SELECT id FROM devices WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(me.id)
    .first<{ id: string }>();

  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.conversation_id, m.sender_user_id, m.sender_device_id, m.recipient_user_id,
            m.recipient_device_id, m.delivery_state, m.attachment_id, m.group_msg_id,
            m.created_at, m.expires_at, m.updated_at, m.deleted_at,
            m.delivered_at, m.read_at,
            CASE WHEN m.recipient_user_id = ?1 THEN m.ciphertext END AS ciphertext,
            CASE WHEN m.recipient_user_id = ?1 THEN m.crypto_header END AS crypto_header
     FROM messages m
     JOIN conversation_members cm
       ON cm.conversation_id = m.conversation_id AND cm.user_id = ?1 AND cm.communication_epoch = ?2
     WHERE (m.sender_user_id = ?1 OR (m.recipient_user_id = ?3 AND m.recipient_device_id = ?4))
       AND NOT (m.sender_user_id = ?1 AND m.canonical = 0)
       AND m.expires_at > ?5
       AND (m.updated_at > ?6 OR (m.updated_at = ?6 AND m.id > ?7))
       AND NOT (
         m.recipient_user_id = ?1 AND EXISTS (
           SELECT 1 FROM contacts b
           WHERE b.owner_user_id = ?1 AND b.contact_user_id = m.sender_user_id AND b.blocked = 1)
       )
     ORDER BY m.updated_at ASC, m.id ASC
     LIMIT ?8`,
  )
    .bind(me.id, me.communication_epoch, me.id, dev?.id ?? "", now, ts, afterId, limit + 1)
    .all<{
      id: string;
      conversation_id: string;
      sender_user_id: string;
      sender_device_id: string;
      recipient_user_id: string;
      delivery_state: "accepted" | "delivered" | "read";
      attachment_id: string | null;
      group_msg_id: string | null;
      created_at: number;
      expires_at: number;
      updated_at: number;
      deleted_at: number | null;
      delivered_at: number | null;
      read_at: number | null;
      ciphertext: ArrayBuffer | null;
      crypto_header: ArrayBuffer | null;
    }>();

  const all = rows.results ?? [];
  const hasMore = all.length > limit;
  const messages: SyncMessage[] = all.slice(0, limit).map((m) => {
    const incoming = m.recipient_user_id === me.id;
    const deleted = m.deleted_at !== null;
    return {
      id: m.id,
      messageId: m.group_msg_id ?? m.id,
      conversationId: m.conversation_id,
      senderUserId: m.sender_user_id,
      senderDeviceId: m.sender_device_id,
      cryptoHeader: incoming && !deleted && m.crypto_header ? b64Encode(m.crypto_header) : null,
      ciphertext: incoming && !deleted && m.ciphertext ? b64Encode(m.ciphertext) : null,
      attachmentId: deleted ? null : m.attachment_id,
      direction: incoming ? "in" : "out",
      state: m.delivery_state,
      deleted,
      createdAt: m.created_at,
      expiresAt: m.expires_at,
      updatedAt: m.updated_at,
      // Only the sender learns when the recipient received / read a message.
      deliveredAt: incoming ? null : m.delivered_at,
      readAt: incoming ? null : m.read_at,
    };
  });
  return c.json({ serverTime: now, messages, hasMore });
});

/* ------------------------------ receipts ------------------------------ */

messageRoutes.post("/messages/ack", requireUnlocked, async (c) => {
  const me = c.get("user");
  const body = await c.req
    .json<{ ids?: string[]; state?: string }>()
    .catch(() => ({}) as { ids?: string[]; state?: string });
  const ids = (body.ids ?? []).filter((i) => MESSAGE_ID_PATTERN.test(i)).slice(0, 100);
  if (ids.length === 0 || (body.state !== "delivered" && body.state !== "read")) {
    return c.json({ error: "Invalid ack" }, 400);
  }
  const now = Date.now();
  const placeholders = ids.map((_, i) => `?${i + 4}`).join(",");
  const allowed =
    body.state === "read"
      ? `delivery_state IN ('accepted','delivered')`
      : `delivery_state = 'accepted'`;
  const res = await c.env.DB.prepare(
    `UPDATE messages SET delivery_state = ?1, updated_at = ?2,
            delivered_at = COALESCE(delivered_at, ?2),
            read_at = CASE WHEN ?1 = 'read' THEN COALESCE(read_at, ?2) ELSE read_at END
     WHERE recipient_user_id = ?3 AND deleted_at IS NULL AND expires_at > ?2
       AND ${allowed} AND id IN (${placeholders})
     RETURNING sender_user_id, conversation_id, group_msg_id`,
  )
    .bind(body.state, now, me.id, ...ids)
    .all<{ sender_user_id: string; conversation_id: string; group_msg_id: string | null }>();

  // Group messages: the sender's own row shows the lowest state across all copies.
  const groupIds = [...new Set((res.results ?? []).map((r) => r.group_msg_id).filter(Boolean))];
  for (const gid of groupIds as string[]) {
    await c.env.DB.prepare(
      `UPDATE messages SET
         delivery_state = (
           SELECT CASE
             WHEN SUM(delivery_state = 'accepted') > 0 THEN 'accepted'
             WHEN SUM(delivery_state = 'delivered') > 0 THEN 'delivered'
             ELSE 'read' END
           FROM messages WHERE group_msg_id = ?1 AND canonical = 0),
         delivered_at = (SELECT MAX(delivered_at) FROM messages WHERE group_msg_id = ?1 AND canonical = 0),
         read_at = (SELECT CASE WHEN COUNT(read_at) = COUNT(*) THEN MAX(read_at) END
                    FROM messages WHERE group_msg_id = ?1 AND canonical = 0),
         updated_at = ?2
       WHERE id = ?1 AND canonical = 1`,
    )
      .bind(gid, now)
      .run();
  }

  const seen = new Set<string>();
  for (const row of res.results ?? []) {
    const key = `${row.sender_user_id}:${row.conversation_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await pushToUser(c.env, row.sender_user_id, {
      type: "message.state",
      conversationId: row.conversation_id,
    });
  }
  return c.json({ ok: true, updated: res.results?.length ?? 0 });
});

/* ---------------------------- delete for all --------------------------- */

messageRoutes.delete("/messages/:id", requireUnlocked, async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const msg = await c.env.DB.prepare(
    `SELECT conversation_id, recipient_user_id, attachment_id, group_msg_id
     FROM messages WHERE id = ? AND sender_user_id = ? AND deleted_at IS NULL`,
  )
    .bind(id, me.id)
    .first<{
      conversation_id: string;
      recipient_user_id: string;
      attachment_id: string | null;
      group_msg_id: string | null;
    }>();
  if (!msg) return c.json({ error: "Message not found" }, 404);

  const now = Date.now();
  if (msg.attachment_id) {
    const att = await c.env.DB.prepare(`SELECT object_key FROM attachments WHERE id = ?`)
      .bind(msg.attachment_id)
      .first<{ object_key: string }>();
    if (att) {
      try {
        await c.env.ATTACHMENTS.delete(att.object_key);
      } catch {
        /* expiry sweep retries */
      }
    }
  }

  if (msg.group_msg_id) {
    const copies = await c.env.DB.prepare(
      `SELECT DISTINCT recipient_user_id FROM messages
       WHERE group_msg_id = ? AND canonical = 0`,
    )
      .bind(msg.group_msg_id)
      .all<{ recipient_user_id: string }>();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE messages
           SET deleted_at = ?1, updated_at = ?1, ciphertext = zeroblob(0), crypto_header = zeroblob(0), attachment_id = NULL
         WHERE group_msg_id = ?2`,
      ).bind(now, msg.group_msg_id),
      c.env.DB.prepare(`DELETE FROM attachments WHERE id = ?`).bind(msg.attachment_id ?? ""),
    ]);
    for (const r of copies.results ?? []) {
      await pushToUser(c.env, r.recipient_user_id, {
        type: "message.deleted",
        conversationId: msg.conversation_id,
        messageId: msg.group_msg_id,
      });
    }
    return c.json({ ok: true });
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE messages
         SET deleted_at = ?1, updated_at = ?1, ciphertext = zeroblob(0), crypto_header = zeroblob(0), attachment_id = NULL
       WHERE id = ?2`,
    ).bind(now, id),
    c.env.DB.prepare(`DELETE FROM attachments WHERE id = ?`).bind(msg.attachment_id ?? ""),
  ]);
  await pushToUser(c.env, msg.recipient_user_id, {
    type: "message.deleted",
    conversationId: msg.conversation_id,
    messageId: id,
  });
  return c.json({ ok: true });
});

/* ------------------------------ typing -------------------------------- */

messageRoutes.post("/conversations/:id/typing", requireUnlocked, async (c) => {
  const me = c.get("user");
  if (!(await hit(c.env, `typing:${me.id}`, 90, 60_000))) return c.json({ ok: true });
  const convId = c.req.param("id");
  const member = await memberOf(c.env, convId, me.id, me.communication_epoch);
  if (!member) return c.json({ error: "Not a member" }, 403);
  const body = await c.req
    .json<{ active?: boolean }>()
    .catch(() => ({}) as { active?: boolean });

  const blocked = await c.env.DB.prepare(
    `SELECT 1 AS x FROM contacts WHERE owner_user_id = ? AND contact_user_id = ? AND blocked = 1`,
  )
    .bind(member.peerId, me.id)
    .first();
  if (!blocked) {
    await pushToUser(c.env, member.peerId, {
      type: "typing",
      conversationId: convId,
      userId: me.id,
      active: body.active !== false,
    });
  }
  return c.json({ ok: true });
});
