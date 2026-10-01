import { Hono } from "hono";
import { UNLOCK_WINDOW_MS, USERNAME_PATTERN } from "@tetris/config";
import type { DbUser } from "../env";
import {
  clearSessionCookie,
  createSession,
  isTrustedDevice,
  issueVaultToken,
  loadSession,
  publicUser,
  readSessionToken,
  requireSession,
  requireUnlocked,
  setSessionCookie,
  trustThisDevice,
  type AppEnv,
} from "../lib/session";
import {
  b64Decode,
  clientIp,
  hmacHex,
  isBase64,
  normalizeUsername,
  randomId,
  safeEqual,
  sha256Hex,
} from "../lib/util";
import { clear, hit, peek } from "../lib/ratelimit";
import { verifyTurnstile } from "../lib/turnstile";
import { sweepUserChallenges } from "../services/challenges";
import { runCommunicationWipe } from "../services/wipe";

export const authRoutes = new Hono<AppEnv>();

function validB64(value: unknown, bytes: number): value is string {
  if (!isBase64(value, bytes)) return false;
  try {
    return b64Decode(value).length === bytes;
  } catch {
    return false;
  }
}

const DEV_SECRET = "tetris-dev-secret";

async function fakeSalt(secret: string, login: string): Promise<string> {
  const hex = (await hmacHex(secret, `salt:${login}`)).slice(0, 32);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Unknown usernames, and accounts a stranger must not touch, get a fake
 * challenge that fails like a wrong passcode and never wipes anything. That
 * keeps usernames unenumerable and stops outsiders from wiping an account.
 */
const FAKE_PREFIX = "fake_";

async function fakeChallenge(env: AppEnv["Bindings"], username: string) {
  return {
    id: FAKE_PREFIX + randomId("ulc"),
    remainingMs: UNLOCK_WINDOW_MS,
    vaultSalt: await fakeSalt(env.SESSION_SECRET ?? DEV_SECRET, `vault:${username}`),
  };
}

function isFake(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(FAKE_PREFIX);
}

async function findByUsername(db: D1Database, usernameRaw: string) {
  const username = normalizeUsername(usernameRaw);
  const user = await db
    .prepare(`SELECT * FROM users WHERE username = ? LIMIT 1`)
    .bind(username)
    .first<DbUser>();
  return { username, user };
}

/* ------------------------------- start -------------------------------- */

async function challengePayload(
  env: AppEnv["Bindings"],
  user: DbUser,
  sessionId: string,
  wipeOnFail: boolean,
) {
  const now = Date.now();
  const live = await env.DB.prepare(
    `SELECT id, expires_at FROM unlock_challenges
     WHERE session_id = ? AND outcome IS NULL AND expires_at > ?
     ORDER BY started_at DESC LIMIT 1`,
  )
    .bind(sessionId, now)
    .first<{ id: string; expires_at: number }>();
  if (live) {
    return {
      id: live.id,
      remainingMs: live.expires_at - now,
      vaultSalt: user.vault_salt!,
    };
  }
  const id = randomId("ulc");
  await env.DB.prepare(
    `INSERT INTO unlock_challenges (id, user_id, session_id, started_at, expires_at, attempt_used, outcome, completed_at, wipe_on_fail)
     VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?)`,
  )
    .bind(id, user.id, sessionId, now, now + UNLOCK_WINDOW_MS, wipeOnFail ? 1 : 0)
    .run();
  return { id, remainingMs: UNLOCK_WINDOW_MS, vaultSalt: user.vault_salt! };
}

/**
 * Step one of every sign-in: username only. Opens a session and the 30s
 * challenge. Nothing is revealed about the account until the passcode proof
 * is accepted by /unlock.
 */
authRoutes.post("/start", async (c) => {
  const ip = clientIp(c.req);
  if (!(await hit(c.env, `start:${ip}`, 30, 60_000))) {
    return c.json({ error: "Too many attempts. Wait a minute." }, 429);
  }
  const body = await c.req
    .json<{ username?: string; turnstileToken?: string }>()
    .catch(() => ({}) as Record<string, never>);
  if (!(await verifyTurnstile(c.env, body.turnstileToken, ip))) {
    return c.json({ error: "Verification failed. Please retry." }, 400);
  }
  const { username, user } = await findByUsername(c.env.DB, body.username ?? "");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Enter your username" }, 400);
  }
  if (!user) return c.json({ challenge: await fakeChallenge(c.env, username) });

  const trusted = await isTrustedDevice(c.req, user);
  if (!(await peek(c.env, `unlockfail:${user.id}`, 8, 15 * 60_000))) {
    return c.json({ error: "Too many wrong attempts. Try again in 15 minutes." }, 429);
  }

  // An abandoned earlier challenge on a trusted browser means the wipe is due.
  await sweepUserChallenges(c.env, user.id);
  const fresh = (await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(user.id)
    .first<DbUser>())!;

  if (!fresh.vault_verifier_hash) {
    // Expired passcode: the only way back is the email-confirmed reset.
    return c.json({ expired: true });
  }

  const session = await createSession(c.env, fresh.id);
  setSessionCookie(c, session.token);
  return c.json({ challenge: await challengePayload(c.env, fresh, session.id, trusted) });
});

/* ------------------------------- resume -------------------------------- */

/**
 * Called on every page open. A cookie alone never unlocks anything: the
 * browser must pass a fresh 30s vault challenge (or continue the pending one).
 */
authRoutes.post("/resume", async (c) => {
  const token = readSessionToken(c.req);
  const loaded = token ? await loadSession(c.env, token) : null;
  if (!loaded) return c.json({ user: null });

  await sweepUserChallenges(c.env, loaded.user.id);
  const user = (await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(loaded.user.id)
    .first<DbUser>())!;

  if (!user.vault_verifier_hash) {
    return c.json({ user: publicUser(user), expired: true });
  }
  return c.json({
    user: publicUser(user),
    challenge: await challengePayload(
      c.env,
      user,
      loaded.session.id,
      await isTrustedDevice(c.req, user),
    ),
  });
});

/* ------------------------------- unlock -------------------------------- */

const DERIVE_GRACE_MS = 15_000;

/**
 * The browser calls this the instant the user presses Enter. It claims the one
 * attempt on the server clock, so slow key derivation on a weak device cannot
 * turn a correct passcode into a timeout. The verifier must follow within a
 * short, bounded grace period.
 */
authRoutes.post("/unlock/begin", async (c, next) => {
  const body = await c.req.raw
    .clone()
    .json<{ challengeId?: string }>()
    .catch(() => ({}) as { challengeId?: string });
  if (!isFake(body.challengeId)) return next();
  return c.json({ ok: true, graceMs: DERIVE_GRACE_MS });
});

authRoutes.post("/unlock/begin", requireSession, async (c) => {
  const user = c.get("user");
  const session = c.get("session");
  const body = await c.req
    .json<{ challengeId?: string }>()
    .catch(() => ({}) as { challengeId?: string });
  const challenge = await c.env.DB.prepare(
    `SELECT id, expires_at, outcome, wipe_on_fail FROM unlock_challenges
     WHERE id = ? AND user_id = ? AND session_id = ?`,
  )
    .bind(body.challengeId ?? "", user.id, session.id)
    .first<{ id: string; expires_at: number; outcome: string | null; wipe_on_fail: number }>();
  if (!challenge) return c.json({ error: "Challenge not found" }, 404);
  if (challenge.outcome) return c.json({ error: "This challenge was already answered" }, 409);

  const now = Date.now();
  if (now >= challenge.expires_at) {
    const res = await c.env.DB.prepare(
      `UPDATE unlock_challenges SET attempt_used = 1, outcome = 'TIMEOUT', completed_at = ?
       WHERE id = ? AND outcome IS NULL`,
    )
      .bind(now, challenge.id)
      .run();
    if (!res.meta.changes) return c.json({ error: "This challenge was already answered" }, 409);
    if (!challenge.wipe_on_fail) {
      return c.json({ ok: false, wiped: false, reason: "TIMEOUT" });
    }
    await runCommunicationWipe(c.env, user.id, "TIMEOUT");
    return c.json({ ok: false, wiped: true, reason: "TIMEOUT", userId: user.id, vaultSetupRequired: true });
  }

  const claim = await c.env.DB.prepare(
    `UPDATE unlock_challenges
       SET attempt_used = 1, expires_at = MAX(expires_at, ?1)
     WHERE id = ?2 AND attempt_used = 0 AND outcome IS NULL`,
  )
    .bind(now + DERIVE_GRACE_MS, challenge.id)
    .run();
  if (!claim.meta.changes) return c.json({ error: "This challenge was already answered" }, 409);
  return c.json({ ok: true, graceMs: DERIVE_GRACE_MS });
});

authRoutes.post("/unlock", async (c, next) => {
  const body = await c.req.raw
    .clone()
    .json<{ challengeId?: string; verifier?: string | null }>()
    .catch(() => ({}) as { challengeId?: string; verifier?: string | null });
  if (!isFake(body.challengeId)) return next();
  if (!(await hit(c.env, `fakeunlock:${clientIp(c.req)}`, 20, 60_000))) {
    return c.json({ error: "Too many attempts" }, 429);
  }
  return c.json({
    unlocked: false,
    wiped: false,
    reason: typeof body.verifier === "string" ? "WRONG_PASSCODE" : "TIMEOUT",
  });
});

authRoutes.post("/unlock", requireSession, async (c) => {
  const user = c.get("user");
  const session = c.get("session");
  if (!(await hit(c.env, `unlock:${session.id}`, 20, 60_000))) {
    return c.json({ error: "Too many attempts" }, 429);
  }
  const body = await c.req
    .json<{ challengeId?: string; verifier?: string | null }>()
    .catch(() => ({}) as Record<string, never>);
  const challengeId = body.challengeId ?? "";

  const challenge = await c.env.DB.prepare(
    `SELECT id, expires_at, attempt_used, outcome, wipe_on_fail FROM unlock_challenges
     WHERE id = ? AND user_id = ? AND session_id = ?`,
  )
    .bind(challengeId, user.id, session.id)
    .first<{
      id: string;
      expires_at: number;
      attempt_used: number;
      outcome: string | null;
      wipe_on_fail: number;
    }>();
  if (!challenge) return c.json({ error: "Challenge not found" }, 404);
  if (challenge.outcome) {
    return c.json({ error: "This challenge was already answered" }, 409);
  }

  const now = Date.now();
  const expired = now >= challenge.expires_at;
  const submitted = typeof body.verifier === "string";

  if (!submitted && !expired) {
    return c.json({ error: "Challenge is still open" }, 400);
  }
  if (submitted && !validB64(body.verifier, 32)) {
    return c.json({ error: "Malformed verifier" }, 400);
  }

  // Exactly one party may settle the outcome.
  const settle = async (outcome: string) => {
    const res = await c.env.DB.prepare(
      `UPDATE unlock_challenges SET attempt_used = 1, outcome = ?, completed_at = ?
       WHERE id = ? AND outcome IS NULL`,
    )
      .bind(outcome, now, challenge.id)
      .run();
    return Boolean(res.meta.changes);
  };

  if (expired || !submitted) {
    if (!(await settle("TIMEOUT"))) {
      return c.json({ error: "This challenge was already answered" }, 409);
    }
    if (!challenge.wipe_on_fail) {
      return c.json({ unlocked: false, wiped: false, reason: "TIMEOUT" });
    }
    await runCommunicationWipe(c.env, user.id, "TIMEOUT");
    return c.json({ unlocked: false, wiped: true, reason: "TIMEOUT", userId: user.id, vaultSetupRequired: true });
  }

  // First submission claims the single attempt (unless /unlock/begin already did).
  if (challenge.attempt_used === 0) {
    const claim = await c.env.DB.prepare(
      `UPDATE unlock_challenges SET attempt_used = 1 WHERE id = ? AND attempt_used = 0 AND outcome IS NULL`,
    )
      .bind(challenge.id)
      .run();
    if (!claim.meta.changes) {
      return c.json({ error: "This challenge was already answered" }, 409);
    }
  }

  const match =
    user.vault_verifier_hash !== null &&
    safeEqual(await sha256Hex(body.verifier as string), user.vault_verifier_hash);

  if (!match) {
    if (!(await settle("WRONG"))) {
      return c.json({ error: "This challenge was already answered" }, 409);
    }
    if (!challenge.wipe_on_fail) {
      // A browser that is not this account's own: count it, never wipe.
      await hit(c.env, `unlockfail:${user.id}`, 8, 15 * 60_000);
      return c.json({ unlocked: false, wiped: false, reason: "WRONG_PASSCODE" });
    }
    await runCommunicationWipe(c.env, user.id, "WRONG_PASSCODE");
    return c.json({
      unlocked: false,
      wiped: true,
      reason: "WRONG_PASSCODE",
      userId: user.id,
      vaultSetupRequired: true,
    });
  }

  if (!(await settle("SUCCESS"))) {
    return c.json({ error: "This challenge was already answered" }, 409);
  }
  const vaultToken = await issueVaultToken(c.env, session.id, user.id);
  await clear(c.env, `unlockfail:${user.id}`);
  await trustThisDevice(c, user.id);
  return c.json({
    unlocked: true,
    wiped: false,
    vaultToken,
    user: publicUser(user),
  });
});

/* ------------------------------- reset -------------------------------- */

/**
 * Passcode expired (wrong or late unlock wiped the vault). The user proves
 * ownership with the email on file, then chooses a new 8-digit passcode. Only
 * valid while the vault is actually unset, so a live passcode can never be
 * replaced this way.
 */
authRoutes.post("/reset", async (c) => {
  const ip = clientIp(c.req);
  if (!(await hit(c.env, `reset:${ip}`, 10, 60 * 60_000))) {
    return c.json({ error: "Too many attempts. Try again later." }, 429);
  }
  const body = await c.req
    .json<{
      username?: string;
      email?: string;
      vaultSalt?: string;
      vaultVerifier?: string;
      turnstileToken?: string;
    }>()
    .catch(() => ({}) as Record<string, never>);
  if (!(await verifyTurnstile(c.env, body.turnstileToken, ip))) {
    return c.json({ error: "Verification failed. Please retry." }, 400);
  }
  if (!validB64(body.vaultSalt, 16) || !validB64(body.vaultVerifier, 32)) {
    return c.json({ error: "Malformed credentials" }, 400);
  }
  const { user } = await findByUsername(c.env.DB, body.username ?? "");
  const failKey = `resetfail:${user?.id ?? ip}`;
  if (!(await peek(c.env, failKey, 5, 15 * 60_000))) {
    return c.json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const ok =
    user !== null &&
    email.length > 0 &&
    !!user.email &&
    user.vault_verifier_hash === null &&
    safeEqual(email, user.email.toLowerCase());
  if (!user || !ok) {
    await hit(c.env, failKey, 5, 15 * 60_000);
    return c.json({ error: "That username and email do not match an expired passcode." }, 403);
  }

  const res = await c.env.DB.prepare(
    `UPDATE users SET vault_salt = ?, vault_verifier_hash = ?, updated_at = ?
     WHERE id = ? AND vault_verifier_hash IS NULL`,
  )
    .bind(body.vaultSalt, await sha256Hex(body.vaultVerifier), Date.now(), user.id)
    .run();
  if (!res.meta.changes) return c.json({ error: "Passcode is not expired." }, 409);
  await clear(c.env, failKey);

  const session = await createSession(c.env, user.id);
  const vaultToken = await issueVaultToken(c.env, session.id, user.id);
  setSessionCookie(c, session.token);
  await trustThisDevice(c, user.id);
  const fresh = (await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(user.id)
    .first<DbUser>())!;
  return c.json({ user: publicUser(fresh), vaultToken }, 201);
});

/* --------------------------- change passcode (unlocked) --------------------------- */

authRoutes.get("/vault-salt", requireUnlocked, (c) => {
  const user = c.get("user");
  if (!user.vault_salt) return c.json({ error: "Vault is not set up" }, 400);
  return c.json({ vaultSalt: user.vault_salt });
});

authRoutes.post("/change-vault", requireUnlocked, async (c) => {
  const user = c.get("user");
  if (!user.vault_salt || !user.vault_verifier_hash) {
    return c.json({ error: "Vault is not set up" }, 400);
  }
  const ip = clientIp(c.req);
  if (!(await hit(c.env, `chvault:${user.id}`, 8, 60 * 60_000))) {
    return c.json({ error: "Too many vault changes. Try later." }, 429);
  }
  const body = await c.req
    .json<{
      oldVerifier?: string;
      vaultSalt?: string;
      vaultVerifier?: string;
    }>()
    .catch(() => ({}) as Record<string, never>);
  if (
    !validB64(body.oldVerifier, 32) ||
    !validB64(body.vaultSalt, 16) ||
    !validB64(body.vaultVerifier, 32)
  ) {
    return c.json({ error: "Malformed credentials" }, 400);
  }
  if (!safeEqual(await sha256Hex(body.oldVerifier), user.vault_verifier_hash)) {
    return c.json({ error: "Current vault passcode is incorrect" }, 401);
  }
  await c.env.DB.prepare(
    `UPDATE users SET vault_salt = ?, vault_verifier_hash = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(body.vaultSalt, await sha256Hex(body.vaultVerifier), Date.now(), user.id)
    .run();
  return c.json({ ok: true });
});

/* ------------------------------- logout -------------------------------- */

authRoutes.post("/logout", async (c) => {
  const token = readSessionToken(c.req);
  if (token) {
    const loaded = await loadSession(c.env, token);
    if (loaded) {
      await c.env.DB.batch([
        c.env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).bind(
          Date.now(),
          loaded.session.id,
        ),
        c.env.DB.prepare(`DELETE FROM unlocks WHERE session_id = ?`).bind(
          loaded.session.id,
        ),
      ]);
    }
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});
