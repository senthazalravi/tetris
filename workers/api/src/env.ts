export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  USER_GATEWAY: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** "true" in production (HTTPS). */
  COOKIE_SECURE: string;
  /** Extra allowed Origin values (comma separated), e.g. the Vite dev server. */
  ALLOWED_ORIGINS?: string;
  /** Wrangler secret. Keys the fake-salt oracle defence in /auth/prelogin. */
  SESSION_SECRET?: string;
  /** Wrangler secret. When set, register/login require a Turnstile token. */
  TURNSTILE_SECRET?: string;
}

export interface DbUser {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_version: number;
  auth_salt: string;
  auth_hash: string;
  vault_salt: string | null;
  vault_verifier_hash: string | null;
  communication_epoch: number;
  created_at: number;
  updated_at: number;
}

export interface DbSession {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}
