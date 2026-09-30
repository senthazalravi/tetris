import type { Env } from "../env";

/**
 * 24h expiry enforcement. Reads already filter on expires_at, so this only
 * reclaims storage: D1 rows and R2 objects. Safe to run repeatedly.
 */
export async function runExpiryCleanup(env: Env, limit = 200): Promise<{
  messages: number;
  attachments: number;
}> {
  const now = Date.now();

  const expiredAtt = await env.DB.prepare(
    `SELECT id, object_key FROM attachments WHERE expires_at <= ? LIMIT ?`,
  )
    .bind(now, limit)
    .all<{ id: string; object_key: string }>();
  const atts = expiredAtt.results ?? [];
  if (atts.length) {
    await env.ATTACHMENTS.delete(atts.map((a) => a.object_key));
    await env.DB.batch(
      atts.map((a) => env.DB.prepare(`DELETE FROM attachments WHERE id = ?`).bind(a.id)),
    );
  }

  const res = await env.DB.prepare(
    `DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE expires_at <= ? LIMIT ?)`,
  )
    .bind(now, limit)
    .run();

  // Housekeeping for tables that would otherwise grow forever.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < ?`).bind(now - 2 * 60 * 60_000),
    env.DB.prepare(`DELETE FROM unlocks WHERE expires_at < ?`).bind(now),
    env.DB.prepare(
      `DELETE FROM sessions WHERE expires_at < ?1 OR (revoked_at IS NOT NULL AND revoked_at < ?2)`,
    ).bind(now, now - 7 * 24 * 60 * 60_000),
    env.DB.prepare(
      `DELETE FROM unlock_challenges WHERE outcome IS NOT NULL AND completed_at < ?`,
    ).bind(now - 24 * 60 * 60_000),
    env.DB.prepare(
      `DELETE FROM devices WHERE revoked_at IS NOT NULL AND revoked_at < ?`,
    ).bind(now - 48 * 60 * 60_000),
  ]);

  return { messages: res.meta.changes ?? 0, attachments: atts.length };
}
