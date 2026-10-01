import type { Env } from "../env";
import { runCommunicationWipe } from "./wipe";

/**
 * Atomically mark a challenge as timed out. Returns true only for the caller
 * that won the race, so each abandoned challenge wipes exactly once.
 */
async function claimTimeout(env: Env, challengeId: string, now: number) {
  const res = await env.DB.prepare(
    `UPDATE unlock_challenges
       SET attempt_used = 1, outcome = 'TIMEOUT', completed_at = ?
     WHERE id = ? AND outcome IS NULL AND expires_at <= ?`,
  )
    .bind(now, challengeId, now)
    .run();
  return Boolean(res.meta.changes);
}

/** Wipe if this user abandoned a challenge (closed the tab, never answered). */
export async function sweepUserChallenges(env: Env, userId: string): Promise<boolean> {
  const now = Date.now();
  const stale = await env.DB.prepare(
    `SELECT id, wipe_on_fail FROM unlock_challenges
     WHERE user_id = ? AND outcome IS NULL AND expires_at <= ?`,
  )
    .bind(userId, now)
    .all<{ id: string; wipe_on_fail: number }>();
  let wiped = false;
  for (const row of stale.results ?? []) {
    if (await claimTimeout(env, row.id, now) && row.wipe_on_fail) {
      await runCommunicationWipe(env, userId, "TIMEOUT");
      wiped = true;
    }
  }
  return wiped;
}

/** Cron: same rule, for users who never came back. */
export async function sweepAllChallenges(env: Env, limit = 50): Promise<number> {
  const now = Date.now();
  const stale = await env.DB.prepare(
    `SELECT id, user_id, wipe_on_fail FROM unlock_challenges
     WHERE outcome IS NULL AND expires_at <= ? LIMIT ?`,
  )
    .bind(now, limit)
    .all<{ id: string; user_id: string; wipe_on_fail: number }>();
  let wiped = 0;
  for (const row of stale.results ?? []) {
    if ((await claimTimeout(env, row.id, now)) && row.wipe_on_fail) {
      await runCommunicationWipe(env, row.user_id, "TIMEOUT");
      wiped += 1;
    }
  }
  return wiped;
}
