import type { WipeReason } from "@lop/types";
import type { Env } from "../env";
import { pushToUser } from "../lib/push";
import { randomId } from "../lib/util";

/**
 * Communication wipe: contacts, conversation membership and the inbox go away,
 * the account (profile, password, username) stays. The vault is left unset so
 * the next screen forces a fresh passcode + fresh device keys for the new epoch.
 *
 * Idempotent: the epoch compare-and-swap makes concurrent calls a no-op.
 * Peers keep their own copies until the 24h TTL removes them.
 */
export async function runCommunicationWipe(
  env: Env,
  userId: string,
  reason: WipeReason,
): Promise<{ toEpoch: number } | null> {
  const user = await env.DB.prepare(
    `SELECT communication_epoch FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<{ communication_epoch: number }>();
  if (!user) return null;

  const fromEpoch = user.communication_epoch;
  const toEpoch = fromEpoch + 1;
  const now = Date.now();

  const cas = await env.DB.prepare(
    `UPDATE users
       SET communication_epoch = ?1, vault_salt = NULL, vault_verifier_hash = NULL, updated_at = ?2
     WHERE id = ?3 AND communication_epoch = ?4`,
  )
    .bind(toEpoch, now, userId, fromEpoch)
    .run();
  if (!cas.meta.changes) return null;

  // Uploaded-but-unsent attachments never reach a peer: destroy them outright.
  const orphaned = await env.DB.prepare(
    `SELECT id, object_key FROM attachments WHERE owner_user_id = ? AND message_id IS NULL`,
  )
    .bind(userId)
    .all<{ id: string; object_key: string }>();
  for (const att of orphaned.results ?? []) {
    try {
      await env.ATTACHMENTS.delete(att.object_key);
    } catch {
      // The expiry sweep retries anything left behind.
    }
  }

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM attachments WHERE owner_user_id = ? AND message_id IS NULL`,
    ).bind(userId),
    env.DB.prepare(
      `DELETE FROM prekeys WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?)`,
    ).bind(userId),
    env.DB.prepare(
      `UPDATE devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(now, userId),
    env.DB.prepare(`DELETE FROM contacts WHERE owner_user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM conversation_members WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM messages WHERE recipient_user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM unlocks WHERE user_id = ?`).bind(userId),
    // Other still-pending challenges must not wipe the *new* epoch later.
    env.DB.prepare(
      `UPDATE unlock_challenges SET attempt_used = 1, outcome = 'SUPERSEDED', completed_at = ?
       WHERE user_id = ? AND outcome IS NULL`,
    ).bind(now, userId),
    env.DB.prepare(
      `INSERT INTO wipe_operations (id, user_id, reason, from_epoch, to_epoch, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(randomId("wipe"), userId, reason, fromEpoch, toEpoch, now),
  ]);

  await pushToUser(env, userId, { type: "wipe.completed" });
  return { toEpoch };
}

/**
 * Permanently delete an account and all server-side data we hold for it.
 * Call only after the client has confirmed ownership (password proof).
 */
export async function deleteAccount(env: Env, userId: string): Promise<void> {
  await runCommunicationWipe(env, userId, "MANUAL");

  const owned = await env.DB.prepare(
    `SELECT object_key FROM attachments WHERE owner_user_id = ?`,
  )
    .bind(userId)
    .all<{ object_key: string }>();
  for (const att of owned.results ?? []) {
    try {
      await env.ATTACHMENTS.delete(att.object_key);
    } catch {
      /* expiry sweep cleans leftovers */
    }
  }
  try {
    await env.ATTACHMENTS.delete(`avatars/${userId}`);
  } catch {
    /* optional */
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM attachments WHERE owner_user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM messages WHERE sender_user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM unlock_challenges WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM unlocks WHERE user_id = ?`).bind(userId),
    env.DB.prepare(
      `DELETE FROM prekeys WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?)`,
    ).bind(userId),
    env.DB.prepare(`DELETE FROM devices WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM contacts WHERE contact_user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM password_resets WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM wipe_operations WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId),
  ]);
}
