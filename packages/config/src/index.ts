/** Unlock window after every page open / login (ms). Server-owned clock. */
export const UNLOCK_WINDOW_MS = 30_000;

/** Mandatory message + attachment lifetime, measured from server created_at. */
export const MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

/** An uploaded attachment that is never attached to a message is purged after this. */
export const PENDING_ATTACHMENT_TTL_MS = 60 * 60 * 1000;

/** Username: 3–32 chars, lowercase alphanumeric + underscore. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSCODE_MIN_LENGTH = 4;
export const DISPLAY_NAME_MAX = 40;

export const MAX_CIPHERTEXT_BYTES = 64 * 1024;
/** Free-tier friendly: R2 keeps at most ~24h of data per user. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Total live attachment bytes one user may have on the server at once. */
export const MAX_USER_ATTACHMENT_BYTES = 250 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 200 * 1024;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const VAULT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export const ONE_TIME_PREKEY_LOW_WATER = 15;

export const API_PREFIX = "/api/v1";
