import type { Env } from "../env";

/** Delete expired messages and their attachment objects. */
export async function runExpiryCleanup(env: Env, limit = 100): Promise<number> {
  const now = Date.now();
  const expired = await env.DB.prepare(
    `SELECT id FROM messages WHERE expires_at <= ? LIMIT ?`,
  )
    .bind(now, limit)
    .all<{ id: string }>();

  let deleted = 0;
  for (const row of expired.results ?? []) {
    const attachments = await env.DB.prepare(
      `SELECT id, object_key FROM attachments WHERE message_id = ?`,
    )
      .bind(row.id)
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

    await env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(row.id).run();
    deleted += 1;
  }
  return deleted;
}
