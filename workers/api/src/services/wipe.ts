import type { Env } from "../env";
import { randomId } from "../lib/crypto";
import type { WipeReason } from "@lop/types";

export async function runCommunicationWipe(
  env: Env,
  userId: string,
  reason: WipeReason,
): Promise<{ fromEpoch: number; toEpoch: number; wipeOperationId: string }> {
  const user = await env.DB.prepare(
    `SELECT communication_epoch FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<{ communication_epoch: number }>();
  if (!user) throw new Error("User not found");

  const fromEpoch = user.communication_epoch;
  const toEpoch = fromEpoch + 1;
  const now = Date.now();
  const wipeOperationId = randomId("wipe");

  // Bump epoch first so concurrent writes with old epoch fail.
  await env.DB.prepare(
    `UPDATE users SET communication_epoch = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(toEpoch, now, userId)
    .run();

  await env.DB.prepare(
    `INSERT INTO wipe_operations (id, user_id, reason, requested_at, completed_at, status, from_epoch, to_epoch)
     VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)`,
  )
    .bind(wipeOperationId, userId, reason, now, now, fromEpoch, toEpoch)
    .run();

  await env.DB.prepare(`DELETE FROM contacts WHERE owner_user_id = ?`)
    .bind(userId)
    .run();

  const memberships = await env.DB.prepare(
    `SELECT conversation_id FROM conversation_members WHERE user_id = ?`,
  )
    .bind(userId)
    .all<{ conversation_id: string }>();

  for (const row of memberships.results ?? []) {
    const convId = row.conversation_id;
    const messages = await env.DB.prepare(
      `SELECT id FROM messages WHERE conversation_id = ? AND sender_user_id = ?`,
    )
      .bind(convId, userId)
      .all<{ id: string }>();
    for (const msg of messages.results ?? []) {
      const attachments = await env.DB.prepare(
        `SELECT id, object_key FROM attachments WHERE message_id = ?`,
      )
        .bind(msg.id)
        .all<{ id: string; object_key: string }>();
      for (const att of attachments.results ?? []) {
        try {
          await env.ATTACHMENTS.delete(att.object_key);
        } catch {
          /* best effort */
        }
        await env.DB.prepare(`DELETE FROM attachments WHERE id = ?`)
          .bind(att.id)
          .run();
      }
      await env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(msg.id).run();
    }
    await env.DB.prepare(
      `DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?`,
    )
      .bind(convId, userId)
      .run();
  }

  await env.DB.prepare(
    `DELETE FROM direct_pairs WHERE user_a = ? OR user_b = ?`,
  )
    .bind(userId, userId)
    .run();

  await env.DB.prepare(
    `UPDATE devices SET revoked_at = ?, communication_epoch = ? WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(now, toEpoch, userId)
    .run();

  return { fromEpoch, toEpoch, wipeOperationId };
}
