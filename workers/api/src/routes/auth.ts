import { Hono } from "hono";
import {
  PASSWORD_MIN_LENGTH,
  SESSION_TTL_MS,
  UNLOCK_WINDOW_MS,
  USERNAME_PATTERN,
} from "@lop/config";
import type { Env } from "../env";
import {
  hashPassword,
  hashToken,
  normalizeEmail,
  normalizeUsername,
  randomId,
  randomToken,
  verifyPassword,
} from "../lib/crypto";
import {
  clearSessionCookie,
  loadSessionUser,
  publicUser,
  readSessionToken,
  setSessionCookie,
  type AppVars,
} from "../lib/session";
import { runCommunicationWipe } from "../services/wipe";

export const authRoutes = new Hono<{ Bindings: Env; Variables: AppVars }>();

authRoutes.post("/register", async (c) => {
  const body = await c.req.json<{
    email?: string;
    password?: string;
    username?: string;
    displayName?: string;
  }>();

  const email = normalizeEmail(body.email ?? "");
  const username = normalizeUsername(body.username ?? "");
  const password = body.password ?? "";
  const displayName = (body.displayName ?? "").trim();

  if (!email || !email.includes("@")) {
    return c.json({ error: "Valid email is required" }, 400);
  }
  if (!USERNAME_PATTERN.test(username)) {
    return c.json(
      { error: "Username must be 3–32 chars: a-z, 0-9, underscore" },
      400,
    );
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return c.json(
      { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` },
      400,
    );
  }
  if (!displayName) {
    return c.json({ error: "Display name is required" }, 400);
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1`,
  )
    .bind(email, username)
    .first();
  if (existing) {
    return c.json({ error: "Email or username already taken" }, 409);
  }

  const now = Date.now();
  const userId = randomId("usr");
  const passwordHash = hashPassword(password);

  await c.env.DB.prepare(
    `INSERT INTO users (id, username, email, password_hash, display_name, avatar_ref, communication_epoch, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
  )
    .bind(userId, username, email, passwordHash, displayName, now, now)
    .run();

  const sessionId = randomId("ses");
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expiresAt = now + SESSION_TTL_MS;

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, device_id, token_hash, created_at, expires_at, revoked_at)
     VALUES (?, ?, NULL, ?, ?, ?, NULL)`,
  )
    .bind(sessionId, userId, tokenHash, now, expiresAt)
    .run();

  setSessionCookie(c, token, Math.floor(SESSION_TTL_MS / 1000));

  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(userId)
    .first();

  return c.json({ user: publicUser(user as never) }, 201);
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ login?: string; password?: string }>();
  const loginRaw = (body.login ?? "").trim();
  const password = body.password ?? "";
  if (!loginRaw || !password) {
    return c.json({ error: "Login and password are required" }, 400);
  }

  const login = loginRaw.includes("@")
    ? normalizeEmail(loginRaw)
    : normalizeUsername(loginRaw);

  const user = await c.env.DB.prepare(
    `SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1`,
  )
    .bind(login, login)
    .first<{
      id: string;
      username: string;
      email: string;
      password_hash: string;
      display_name: string;
      avatar_ref: string | null;
      communication_epoch: number;
      created_at: number;
      updated_at: number;
    }>();

  if (!user || !verifyPassword(password, user.password_hash)) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const now = Date.now();
  const sessionId = randomId("ses");
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expiresAt = now + SESSION_TTL_MS;

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, device_id, token_hash, created_at, expires_at, revoked_at)
     VALUES (?, ?, NULL, ?, ?, ?, NULL)`,
  )
    .bind(sessionId, user.id, tokenHash, now, expiresAt)
    .run();

  const challengeId = randomId("ulc");
  const unlockExpiresAt = now + UNLOCK_WINDOW_MS;
  await c.env.DB.prepare(
    `INSERT INTO unlock_challenges (id, user_id, session_id, started_at, expires_at, attempt_used, outcome, completed_at)
     VALUES (?, ?, ?, ?, ?, 0, NULL, NULL)`,
  )
    .bind(challengeId, user.id, sessionId, now, unlockExpiresAt)
    .run();

  setSessionCookie(c, token, Math.floor(SESSION_TTL_MS / 1000));

  return c.json({
    user: publicUser(user),
    unlockChallengeId: challengeId,
    unlockExpiresAt,
  });
});

authRoutes.post("/logout", async (c) => {
  const token = readSessionToken(c);
  if (token) {
    const tokenHash = hashToken(token);
    await c.env.DB.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
    )
      .bind(Date.now(), tokenHash)
      .run();
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get("/session", async (c) => {
  const token = readSessionToken(c);
  if (!token) return c.json({ user: null });
  const loaded = await loadSessionUser(c.env, token);
  if (!loaded) return c.json({ user: null });
  return c.json({ user: publicUser(loaded.user) });
});

/** Create a wipe-capable unlock challenge (used after password login). */
authRoutes.post("/challenge", async (c) => {
  const token = readSessionToken(c);
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const loaded = await loadSessionUser(c.env, token);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const now = Date.now();
  const challengeId = randomId("ulc");
  const unlockExpiresAt = now + UNLOCK_WINDOW_MS;
  await c.env.DB.prepare(
    `INSERT INTO unlock_challenges (id, user_id, session_id, started_at, expires_at, attempt_used, outcome, completed_at)
     VALUES (?, ?, ?, ?, ?, 0, NULL, NULL)`,
  )
    .bind(challengeId, loaded.user.id, loaded.session.id, now, unlockExpiresAt)
    .run();

  return c.json({ unlockChallengeId: challengeId, unlockExpiresAt });
});

authRoutes.post("/unlock", async (c) => {
  const token = readSessionToken(c);
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const loaded = await loadSessionUser(c.env, token);
  if (!loaded) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{
    unlockChallengeId?: string;
    result?: "SUCCESS" | "FAILURE";
  }>();
  const challengeId = body.unlockChallengeId ?? "";
  const result = body.result;
  if (!challengeId || (result !== "SUCCESS" && result !== "FAILURE")) {
    return c.json({ error: "Invalid unlock payload" }, 400);
  }

  const challenge = await c.env.DB.prepare(
    `SELECT * FROM unlock_challenges WHERE id = ? AND user_id = ? AND session_id = ? LIMIT 1`,
  )
    .bind(challengeId, loaded.user.id, loaded.session.id)
    .first<{
      id: string;
      expires_at: number;
      attempt_used: number;
      outcome: string | null;
    }>();

  if (!challenge) return c.json({ error: "Challenge not found" }, 404);
  if (challenge.attempt_used === 1 || challenge.outcome) {
    return c.json({ error: "Challenge already completed" }, 409);
  }

  const now = Date.now();
  const timedOut = now > challenge.expires_at;

  if (timedOut || result === "FAILURE") {
    const reason = timedOut ? "TIMEOUT" : "WRONG_PASSCODE";
    await c.env.DB.prepare(
      `UPDATE unlock_challenges SET attempt_used = 1, outcome = ?, completed_at = ? WHERE id = ?`,
    )
      .bind(timedOut ? "TIMEOUT" : "WRONG", now, challengeId)
      .run();
    const wipe = await runCommunicationWipe(c.env, loaded.user.id, reason);
    return c.json({
      unlocked: true,
      wiped: true,
      reason,
      communicationEpoch: wipe.toEpoch,
    });
  }

  await c.env.DB.prepare(
    `UPDATE unlock_challenges SET attempt_used = 1, outcome = 'SUCCESS', completed_at = ? WHERE id = ?`,
  )
    .bind(now, challengeId)
    .run();

  return c.json({
    unlocked: true,
    wiped: false,
    communicationEpoch: loaded.user.communication_epoch,
  });
});
