import type { Context } from "hono";
import type { Env, DbUser, DbSession } from "../env";
import { hashToken } from "./crypto";

export type AppVars = {
  user: DbUser;
  session: DbSession;
};

export type AppContext = Context<{ Bindings: Env; Variables: AppVars }>;

const COOKIE_NAME = "lop_session";

export function sessionCookieOptions(env: Env, maxAgeSec: number): string {
  const secure = env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export function setSessionCookie(c: AppContext, token: string, maxAgeSec: number) {
  c.header(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; ${sessionCookieOptions(c.env, maxAgeSec)}`,
  );
}

export function clearSessionCookie(c: AppContext) {
  c.header(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

export function readSessionToken(c: AppContext): string | null {
  const header = c.req.header("Cookie");
  if (!header) return null;
  const parts = header.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (part.startsWith(`${COOKIE_NAME}=`)) {
      return decodeURIComponent(part.slice(COOKIE_NAME.length + 1));
    }
  }
  return null;
}

export async function loadSessionUser(
  env: Env,
  token: string,
): Promise<{ user: DbUser; session: DbSession } | null> {
  const tokenHash = hashToken(token);
  const now = Date.now();
  const session = await env.DB.prepare(
    `SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1`,
  )
    .bind(tokenHash, now)
    .first<DbSession>();
  if (!session) return null;
  const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`)
    .bind(session.user_id)
    .first<DbUser>();
  if (!user) return null;
  return { user, session };
}

export function publicUser(user: DbUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email,
    communicationEpoch: user.communication_epoch,
  };
}
