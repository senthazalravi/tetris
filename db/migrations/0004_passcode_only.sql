-- Passcode-only accounts: no email, no account password, no password resets.
-- Existing accounts lose their vault verifier (the old passcode format is no
-- longer valid) and must set a new 8-digit passcode on next sign-in.

DROP TABLE IF EXISTS password_resets;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_version INTEGER NOT NULL DEFAULT 0,
  vault_salt TEXT,
  vault_verifier_hash TEXT,
  -- SHA-256 of the cookie token held by the browser that last unlocked this
  -- account. Only that browser can trigger a wipe by failing an unlock.
  trusted_device_hash TEXT,
  communication_epoch INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO users_new
  (id, username, display_name, avatar_version, vault_salt, vault_verifier_hash,
   trusted_device_hash, communication_epoch, created_at, updated_at)
SELECT id, username, display_name, avatar_version, NULL, NULL,
       NULL, communication_epoch + 1, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- 1 when failing/abandoning this challenge wipes chats (trusted browser only).
ALTER TABLE unlock_challenges ADD COLUMN wipe_on_fail INTEGER NOT NULL DEFAULT 1;
