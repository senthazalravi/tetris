-- Predefined users only: accounts are seeded by an admin script, there is no
-- sign-up. The email on file is what proves ownership when a passcode expires.

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_version INTEGER NOT NULL DEFAULT 0,
  vault_salt TEXT,
  vault_verifier_hash TEXT,
  trusted_device_hash TEXT,
  communication_epoch INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Any account that existed before has no email on file; park it on a
-- placeholder address that cannot be typed into the reset form.
INSERT INTO users_new
  (id, username, email, display_name, avatar_version, vault_salt, vault_verifier_hash,
   trusted_device_hash, communication_epoch, created_at, updated_at)
SELECT id, username, 'unset+' || id || '@invalid', display_name, avatar_version, vault_salt,
       vault_verifier_hash, trusted_device_hash, communication_epoch, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
