/** Unlock window after every page open / login (ms). Server-owned clock. */
export const UNLOCK_WINDOW_MS = 30_000;

/** Mandatory message + attachment lifetime, measured from server created_at. */
export const MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

/** How long after sending a message its author may still edit it. */
export const EDIT_WINDOW_MS = 10 * 60 * 1000;

/** An uploaded attachment that is never attached to a message is purged after this. */
export const PENDING_ATTACHMENT_TTL_MS = 60 * 60 * 1000;

/** Username: 3–32 chars, lowercase alphanumeric + underscore. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

/** The passcode is the only secret: exactly 8 digits. */
export const PASSCODE_LENGTH = 8;
export const PASSCODE_PATTERN = /^\d{8}$/;
export const DISPLAY_NAME_MAX = 40;

export const MAX_CIPHERTEXT_BYTES = 64 * 1024;
/**
 * Documents, photos, audio and everything else. The only real ceiling is the
 * Workers free plan's 100 MB request body, so stay just under it.
 */
export const MAX_ATTACHMENT_BYTES = 90 * 1024 * 1024;
/** Videos are the one thing we cap hard, to protect free-tier R2 + bandwidth. */
export const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
/** Longest voice message we record (ms). */
export const MAX_VOICE_MS = 5 * 60 * 1000;
/** Total live attachment bytes one user may have on the server at once. */
export const MAX_USER_ATTACHMENT_BYTES = 300 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 200 * 1024;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const VAULT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export const ONE_TIME_PREKEY_LOW_WATER = 15;

export const API_PREFIX = "/api/v1";
