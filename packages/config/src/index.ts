/** Unlock window after login (ms). */
export const UNLOCK_WINDOW_MS = 30_000;

/** Mandatory message lifetime (ms). */
export const MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

/** Username: 3–32 chars, lowercase alphanumeric + underscore. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

export const PASSWORD_MIN_LENGTH = 12;

export const MAX_CIPHERTEXT_BYTES = 64 * 1024;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const API_PREFIX = "/api/v1";
