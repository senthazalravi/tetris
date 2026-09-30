import type { Env } from "../env";

/**
 * Fixed-window counter stored in D1 so limits hold across isolates.
 * Returns true when the caller is still within the limit.
 */
export async function hit(
  env: Env,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
     RETURNING count`,
  )
    .bind(key, now, now - windowMs)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

/** Non-consuming check (used for failed-login lockouts). */
export async function peek(
  env: Env,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT count, window_start FROM rate_limits WHERE key = ?`,
  )
    .bind(key)
    .first<{ count: number; window_start: number }>();
  if (!row) return true;
  if (row.window_start <= Date.now() - windowMs) return true;
  return row.count < limit;
}

export async function clear(env: Env, key: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM rate_limits WHERE key = ?`).bind(key).run();
}
