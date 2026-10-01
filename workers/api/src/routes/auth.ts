import { Hono } from "hono";
import {
  DISPLAY_NAME_MAX,
  UNLOCK_WINDOW_MS,
  USERNAME_PATTERN,
} from "@lop/config";
import type { DbUser } from "../env";
import {
  clearSessionCookie,
  createSession,
  issueVaultToken,
  loadSession,
  publicUser,
  readSessionToken,
  requireSession,
  setSessionCookie,
  type AppEnv,
} from "../lib/session";
import {
  b64Decode,
  clientIp,
  hmacHex,
  isBase64,
  normalizeEmail,
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validB64(value: unknown, bytes: number): value is string {
  if (!isBase64(value, bytes)) return false;
  try {
    return b64Decode(value).length === bytes;
  } catch {
    return false;
  }
}

async function fakeSalt(secret: string, login: string): Promise<string> {
  const hex = (await hmacHex(secret, `salt:${login}`)).slice(0, 32);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function findByLogin(db: D1Database, loginRaw: string) {
  const login = loginRaw.includes("@")
    ? normalizeEmail(loginRaw)
    : normalizeUsername(loginRaw);
  const user = await db
    .prepare(`SELECT * FROM users WHERE email = ?1 OR username = ?1 LIMIT 1`)
    .bind(login)
    .first<DbUser>();
  return { login, user };
}

/* ----------------------------- prelogin ------------------------------ */

authRoutes.post("/prelogin", async (c) => {
  const ip = clientIp(c.req);
  if (!(await hit(c.env, `prelogin:${ip}`, 40, 60_000))) {
    return c.json({ error: "Too many requests" }, 429);
  }
  const body = await c.req.json<{ login?: string }>().catch(() => ({}) as { login?: string });
  const loginRaw = (body.login ?? "").trim();
  if (!loginRaw || loginRaw.length > 254) return c.json({ error: "Login required" }, 400);
  const { login, user } = await findByLogin(c.env.DB, loginRaw);
  // Unknown accounts get a stable fake salt so the endpoint doesn't reveal them.
  const authSalt =
    user?.auth_salt ?? (await fakeSalt(c.env.SESSION_SECRET ?? "lop-dev-secret", login));
  return c.json({ authSalt });
});

/* ----------------------------- register ------------------------------ */

authRoutes.post("/register", async (c) => {
  const ip = clientIp(c.req);
  if (!(await hit(c.env, `register:${ip}`, 8, 60 * 60_000))) {
    return c.json({ error: "Too many sign-ups from this network. Try later." }, 429);
  }
  const body = await c.req
    .json<{
      email?: string;
      username?: string;
      displayName?: string;
      authSalt?: string;
      authProof?: string;
      vaultSalt?: string;
      vaultVerifier?: string;
      turnstileToken?: string;
    }>()
    .catch(() => ({}) as Record<string, never>);

  if (!(await verifyTurnstile(c.env, body.turnstileToken, ip))) {
    return c.json({ error: "Verification failed. Please retry." }, 400);
  }

  const email = normalizeEmail(body.email ?? "");
  const username = normalizeUsername(body.username ?? "");
  const displayName = (body.displayName ?? "").trim();

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return c.json({ error: "Enter a valid email address" }, 400);
  }
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Username: 3–32 characters, a–z, 0–9 and _ only" }, 400);
  }
  if (!displayName || displayName.length > DISPLAY_NAME_MAX) {
    return c.json({ error: `Display name is required (max ${DISPLAY_NAME_MAX})` }, 400);
  }
  if (
    !validB64(body.authSalt, 16) ||
    !validB64(body.authProof, 32) ||
    !validB64(body.vaultSalt, 16) ||
    !validB64(body.vaultVerifier, 32)
  ) {
    return c.json({ error: "Malformed credentials" }, 400);
  }

  const existing = await c.env.DB.prepare(
    `SELECT 1 AS x FROM users WHERE email = ? OR username = ? LIMIT 1`,
  )
    .bind(email, username)
    .first();
  if (existing) return c.json({ error: "Email or username already taken" }, 409);

  const now = Date.now();
  const userId = randomId("usr");
  try {
    await c.env.DB.prepare(
      `INSERT INTO users (id, username, email, display_name, avatar_version, auth_salt, auth_hash,
                          vault_salt, vault_verifier_hash, communication_epoch, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        userId,
        username,
        email,
        displayName,
        body.authSalt,
        await sha256Hex(body.authProof),
        body.vaultSalt,
        await sha256Hex(body.vaultVerifier),
        now,
        now,
      )
      .run();
  } catch {
    return c.json({ error: "Email or username already taken" }, 409);
  }

  const session = await createSession(c.env, userId);
  const vaultToken = await issueVaultToken(c.env, session.id, userId);
  setSessionCookie(c, session.token);
  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(userId)
    .first<DbUser>();
  return c.json({ user: publicUser(user!), vaultToken }, 201);
});

/* ------------------------------- login -------------------------------- */

async function challengePayload(
  env: AppEnv["Bindings"],
  user: DbUser,
  sessionId: string,
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
    `INSERT INTO unlock_challenges (id, user_id, session_id, started_at, expires_at, attempt_used, outcome, completed_at)
     VALUES (?, ?, ?, ?, ?, 0, NULL, NULL)`,
  )
    .bind(id, user.id, sessionId, now, now + UNLOCK_WINDOW_MS)
    .run();
  return { id, remainingMs: UNLOCK_WINDOW_MS, vaultSalt: user.vault_salt! };
}

authRoutes.post("/login", async (c) => {
  const ip = clientIp(c.req);
  if (!(await hit(c.env, `login:${ip}`, 30, 60_000))) {
    return c.json({ error: "Too many attempts. Wait a minute." }, 429);
  }
  const body = await c.req
    .json<{ login?: string; authProof?: string; turnstileToken?: string }>()
    .catch(() => ({}) as Record<string, never>);
  if (!(await verifyTurnstile(c.env, body.turnstileToken, ip))) {
    return c.json({ error: "Verification failed. Please retry." }, 400);
  }
  const loginRaw = (body.login ?? "").trim();
  if (!loginRaw || !validB64(body.authProof, 32)) {
    return c.json({ error: "Login and password are required" }, 400);
  }

  const { login, user } = await findByLogin(c.env.DB, loginRaw);
  const failKey = `loginfail:${user?.id ?? login}`;
  if (!(await peek(c.env, failKey, 8, 15 * 60_000))) {
    return c.json({ error: "Account temporarily locked. Try again in 15 minutes." }, 429);
  }
  const ok =
    user !== null &&
    safeEqual(await sha256Hex(body.authProof), user.auth_hash);
  if (!user || !ok) {
    await hit(c.env, failKey, 8, 15 * 60_000);
    return c.json({ error: "Invalid credentials" }, 401);
  }
  await clear(c.env, failKey);

  // An abandoned earlier challenge means the wipe is already due.
  await sweepUserChallenges(c.env, user.id);
  const fresh = (await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(user.id)
    .first<DbUser>())!;

  const session = await createSession(c.env, fresh.id);
  setSessionCookie(c, session.token);

  if (!fresh.vault_verifier_hash) {
    return c.json({ user: publicUser(fresh), vaultSetupRequired: true });
  }
  return c.json({
    user: publicUser(fresh),
    challenge: await challengePayload(c.env, fresh, session.id),
  });
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
    return c.json({ user: publicUser(user), vaultSetupRequired: true });
  }
  return c.json({
    user: publicUser(user),
    challenge: await challengePayload(c.env, user, loaded.session.id),
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
authRoutes.post("/unlock/begin", requireSession, async (c) => {
  const user = c.get("user");
  const session = c.get("session");
  const body = await c.req
    .json<{ challengeId?: string }>()
    .catch(() => ({}) as { challengeId?: string });
  const challenge = await c.env.DB.prepare(
    `SELECT id, expires_at, outcome FROM unlock_challenges
     WHERE id = ? AND user_id = ? AND session_id = ?`,
  )
    .bind(body.challengeId ?? "", user.id, session.id)
    .first<{ id: string; expires_at: number; outcome: string | null }>();
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
    await runCommunicationWipe(c.env, user.id, "TIMEOUT");
    return c.json({ ok: false, wiped: true, reason: "TIMEOUT", vaultSetupRequired: true });
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
    `SELECT id, expires_at, attempt_used, outcome FROM unlock_challenges
     WHERE id = ? AND user_id = ? AND session_id = ?`,
  )
    .bind(challengeId, user.id, session.id)
    .first<{ id: string; expires_at: number; attempt_used: number; outcome: string | null }>();
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
    await runCommunicationWipe(c.env, user.id, "TIMEOUT");
    return c.json({ unlocked: false, wiped: true, reason: "TIMEOUT", vaultSetupRequired: true });
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
    await runCommunicationWipe(c.env, user.id, "WRONG_PASSCODE");
    return c.json({
      unlocked: false,
      wiped: true,
      reason: "WRONG_PASSCODE",
      vaultSetupRequired: true,
    });
  }

  if (!(await settle("SUCCESS"))) {
    return c.json({ error: "This challenge was already answered" }, 409);
  }
  const vaultToken = await issueVaultToken(c.env, session.id, user.id);
  return c.json({
    unlocked: true,
    wiped: false,
    vaultToken,
    user: publicUser(user),
  });
});

/* ----------------------------- vault setup ------------------------------ */

/** After a wipe (or never set): choose the vault passcode for the new epoch. */
authRoutes.post("/vault", requireSession, async (c) => {
  const user = c.get("user");
  const session = c.get("session");
  if (user.vault_verifier_hash) {
    return c.json({ error: "Vault already configured" }, 409);
  }
  const body = await c.req
    .json<{ vaultSalt?: string; vaultVerifier?: string }>()
    .catch(() => ({}) as Record<string, never>);
  if (!validB64(body.vaultSalt, 16) || !validB64(body.vaultVerifier, 32)) {
    return c.json({ error: "Malformed vault credentials" }, 400);
  }
  const res = await c.env.DB.prepare(
    `UPDATE users SET vault_salt = ?, vault_verifier_hash = ?, updated_at = ?
     WHERE id = ? AND vault_verifier_hash IS NULL`,
  )
    .bind(body.vaultSalt, await sha256Hex(body.vaultVerifier), Date.now(), user.id)
    .run();
  if (!res.meta.changes) return c.json({ error: "Vault already configured" }, 409);

  const vaultToken = await issueVaultToken(c.env, session.id, user.id);
  const fresh = (await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(user.id)
    .first<DbUser>())!;
  return c.json({ vaultToken, user: publicUser(fresh) }, 201);
});

/* ------------------- forgot account password (no email) ------------------- */

/**
 * Two recovery paths, both without sending mail:
 *  1. Vault still active → email + @username + vault passcode
 *  2. Vault wiped / never set → email + @username (chats already gone)
 * Wrong vault here does NOT wipe. Unknown emails get a fake vault salt and
 * `requiresVault: true` so we don't advertise which addresses exist.
 */
authRoutes.post("/password-reset/preflight", async (c) => {
  const ip = clientIp(c.req);
  if (!(await hit(c.env, `pwresetpre:${ip}`, 30, 60_000))) {
    return c.json({ error: "Too many requests" }, 429);
  }
  const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
  const email = normalizeEmail(body.email ?? "");
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return c.json({ error: "Enter a valid email address" }, 400);
  }
  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ? LIMIT 1`)
    .bind(email)
    .first<DbUser>();
  const secret = c.env.SESSION_SECRET ?? "lop-dev-secret";
  if (!user) {
    return c.json({
      vaultSalt: await fakeSalt(secret, `vault:${email}`),
      requiresVault: true,
    });
  }
  if (user.vault_salt && user.vault_verifier_hash) {
    return c.json({ vaultSalt: user.vault_salt, requiresVault: true });
  }
  return c.json({
    vaultSalt: await fakeSalt(secret, `vault:${email}`),
    requiresVault: false,
  });
});

authRoutes.post("/password-reset", async (c) => {
  const ip = clientIp(c.req);
  if (!(await hit(c.env, `pwreset:${ip}`, 15, 60_000))) {
    return c.json({ error: "Too many attempts. Wait a minute." }, 429);
  }
  const body = await c.req
    .json<{
      email?: string;
      username?: string;
      vaultVerifier?: string | null;
      authSalt?: string;
      authProof?: string;
      turnstileToken?: string;
    }>()
    .catch(() => ({}) as Record<string, never>);
  if (!(await verifyTurnstile(c.env, body.turnstileToken, ip))) {
    return c.json({ error: "Verification failed. Please retry." }, 400);
  }

  const email = normalizeEmail(body.email ?? "");
  const username = normalizeUsername(body.username ?? "");
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return c.json({ error: "Enter a valid email address" }, 400);
  }
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Enter your @username exactly" }, 400);
  }
  if (!validB64(body.authSalt, 16) || !validB64(body.authProof, 32)) {
    return c.json({ error: "Malformed credentials" }, 400);
  }

  const failKey = `pwresetfail:${email}`;
  if (!(await peek(c.env, failKey, 8, 15 * 60_000))) {
    return c.json({ error: "Too many failed attempts. Try again in 15 minutes." }, 429);
  }

  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ? LIMIT 1`)
    .bind(email)
    .first<DbUser>();

  const deny = async () => {
    await hit(c.env, failKey, 8, 15 * 60_000);
    return c.json(
      {
        error:
          "Could not verify that account. Check email, @username, and vault passcode (if your vault is still active).",
      },
      401,
    );
  };

  if (!user || user.username !== username) return deny();

  const vaultActive = Boolean(user.vault_salt && user.vault_verifier_hash);
  if (vaultActive) {
    if (!validB64(body.vaultVerifier, 32)) {
      return c.json(
        {
          error:
            "This account still has an active vault. Enter your vault passcode (not your account password) to continue.",
        },
        400,
      );
    }
    const vaultOk = safeEqual(
      await sha256Hex(body.vaultVerifier),
      user.vault_verifier_hash!,
    );
    if (!vaultOk) return deny();
  }

  await clear(c.env, failKey);

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET auth_salt = ?, auth_hash = ?, updated_at = ? WHERE id = ?`,
    ).bind(body.authSalt, await sha256Hex(body.authProof), now, user.id),
    c.env.DB.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(now, user.id),
    c.env.DB.prepare(`DELETE FROM unlocks WHERE user_id = ?`).bind(user.id),
  ]);

  return c.json({
    ok: true,
    message: vaultActive
      ? "Account password updated. Sign in with the new password. Your vault passcode is unchanged."
      : "Account password updated. Sign in, then set up a new vault passcode.",
  });
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
