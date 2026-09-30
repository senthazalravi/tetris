export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  APP_ORIGIN: string;
  COOKIE_SECURE: string;
  SESSION_SECRET?: string;
}

export interface DbUser {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  avatar_ref: string | null;
  communication_epoch: number;
  created_at: number;
  updated_at: number;
}

export interface DbSession {
  id: string;
  user_id: string;
  device_id: string | null;
  token_hash: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}
