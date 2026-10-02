export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  USER_GATEWAY: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** "true" in production (HTTPS). */
  COOKIE_SECURE: string;
  /** Public site origin (optional). */
  APP_ORIGIN?: string;
  /** Extra allowed Origin values (comma separated), e.g. the Vite dev server. */
  ALLOWED_ORIGINS?: string;
  /** Wrangler secret. Keys the fake-salt oracle defence in /auth/prelogin. */
  SESSION_SECRET?: string;
  /** Wrangler secret. Resend API key for the unread-message email digests. */
  RESEND_API_KEY?: string;
  /** Sender shown on digests, e.g. "Tetris <notify@mail.example.com>". */
  MAIL_FROM?: string;
  /** "true" logs the digest instead of sending it (local testing). */
  MAIL_DRY_RUN?: string;
  /** Optional TURN relay for voice calls behind strict NATs (comma-separated urls). */
  TURN_URLS?: string;
  TURN_USERNAME?: string;
  /** Wrangler secret. */
  TURN_CREDENTIAL?: string;
  /** Wrangler secret. When set, register/login require a Turnstile token. */
  TURNSTILE_SECRET?: string;
}

export interface DbUser {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  avatar_version: number;
  vault_salt: string | null;
  vault_verifier_hash: string | null;
  trusted_device_hash: string | null;
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
