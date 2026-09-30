import type { Context, MiddlewareHandler } from "hono";
import { SESSION_TTL_MS, VAULT_TOKEN_TTL_MS } from "@lop/config";
import type { DbSession, DbUser, Env } from "../env";
import { randomId, randomToken, sha256Hex } from "./util";

export type AppEnv = {
  Bindings: Env;
  Variables: { user: DbUser; session: DbSession };
};
export type AppContext = Context<AppEnv>;

const COOKIE = "lop_session";
export const VAULT_HEADER = "x-lop-vault";

/* ------------------------------ cookies ------------------------------ */

function cookieAttrs(env: Env, maxAgeSec: number) {
  const secure = env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}

export function setSessionCookie(c: AppContext, token: string) {
  c.header(
    "Set-Cookie",
    `${COOKIE}=${token}; ${cookieAttrs(c.env, Math.floor(SESSION_TTL_MS / 1000))}`,
  );
}

export function clearSessionCookie(c: AppContext) {
  c.header("Set-Cookie", `${COOKIE}=; ${cookieAttrs(c.env, 0)}`);
}

export function readSessionToken(req: { header: (n: string) => string | undefined }) {
  const header = req.header("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

/* ------------------------------ sessions ----------------------------- */

export async function createSession(env: Env, userId: string) {
  const token = randomToken();
  const id = randomId("ses");
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  )
    .bind(id, userId, await sha256Hex(token), now, now + SESSION_TTL_MS)
    .run();
  return { id, token };
}

export async function loadSession(
  env: Env,
  token: string,
): Promise<{ user: DbUser; session: DbSession } | null> {
  const row = await env.DB.prepare(
    `SELECT s.id AS s_id, s.user_id AS s_user_id, s.token_hash AS s_token_hash,
            s.created_at AS s_created_at, s.expires_at AS s_expires_at, s.revoked_at AS s_revoked_at,
            u.*
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<Record<string, unknown>>();
  if (!row) return null;
  const { s_id, s_user_id, s_token_hash, s_created_at, s_expires_at, s_revoked_at, ...user } =
    row;
  return {
    user: user as unknown as DbUser,
    session: {
      id: s_id,
      user_id: s_user_id,
      token_hash: s_token_hash,
      created_at: s_created_at,
      expires_at: s_expires_at,
      revoked_at: s_revoked_at,
    } as DbSession,
  };
}

export async function issueVaultToken(env: Env, sessionId: string, userId: string) {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO unlocks (token_hash, session_id, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(await sha256Hex(token), sessionId, userId, now, now + VAULT_TOKEN_TTL_MS)
    .run();
  return token;
}

export async function hasValidVaultToken(
  env: Env,
  token: string | undefined | null,
  sessionId: string,
): Promise<boolean> {
  if (!token) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM unlocks WHERE token_hash = ? AND session_id = ? AND expires_at > ?`,
  )
    .bind(await sha256Hex(token), sessionId, Date.now())
    .first();
  return Boolean(row);
}

/* ---------------------------- middleware ----------------------------- */

/** Cookie session only (used for the lock screen itself). */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = readSessionToken(c.req);
  if (!token) return c.json({ error: "Not signed in", code: "NO_SESSION" }, 401);
  const loaded = await loadSession(c.env, token);
  if (!loaded) return c.json({ error: "Not signed in", code: "NO_SESSION" }, 401);
  c.set("user", loaded.user);
  c.set("session", loaded.session);
  await next();
};

/** Cookie session AND a live vault token from this tab's memory. */
export const requireUnlocked: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = readSessionToken(c.req);
  if (!token) return c.json({ error: "Not signed in", code: "NO_SESSION" }, 401);
  const loaded = await loadSession(c.env, token);
  if (!loaded) return c.json({ error: "Not signed in", code: "NO_SESSION" }, 401);
  const ok = await hasValidVaultToken(
    c.env,
    c.req.header(VAULT_HEADER),
    loaded.session.id,
  );
  if (!ok) return c.json({ error: "Vault is locked", code: "VAULT_LOCKED" }, 403);
  c.set("user", loaded.user);
  c.set("session", loaded.session);
  await next();
};

/** Reject cross-site state changes. */
export const originGuard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  const origin = c.req.header("origin");
  const own = new URL(c.req.url).origin;
  const allowed = (c.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origin || (origin !== own && !allowed.includes(origin))) {
    return c.json({ error: "Cross-origin request blocked" }, 403);
  }
  return next();
};

export function publicUser(user: DbUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email,
    avatarUrl: avatarUrl(user.id, user.avatar_version),
    communicationEpoch: user.communication_epoch,
  };
}

export function avatarUrl(userId: string, version: number): string | null {
  return version > 0 ? `/api/v1/users/${userId}/avatar?v=${version}` : null;
}
