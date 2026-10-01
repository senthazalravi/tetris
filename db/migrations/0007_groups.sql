-- Groups, and several users sharing one email.

-- 1. users.email is no longer unique (the reset form still needs username + email).
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_version INTEGER NOT NULL DEFAULT 0,
  vault_salt TEXT,
  vault_verifier_hash TEXT,
  trusted_device_hash TEXT,
  communication_epoch INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO users_new
  (id, username, email, display_name, avatar_version, vault_salt, vault_verifier_hash,
   trusted_device_hash, communication_epoch, created_at, updated_at)
SELECT id, username, email, display_name, avatar_version, vault_salt, vault_verifier_hash,
       trusted_device_hash, communication_epoch, created_at, updated_at
FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- 2. A conversation is either a direct chat or a named group. Group rows use
--    user_a = 'group' and user_b = their own id to satisfy the unique pair.
ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'dm';
ALTER TABLE conversations ADD COLUMN name TEXT;

-- 3. Group membership is permanent; a wipe only clears conversation_members.
CREATE TABLE group_members (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members(user_id);

-- 4. A group message is stored once per recipient device (fan-out). All copies
--    share group_msg_id; only the canonical copy is synced back to the sender.
ALTER TABLE messages ADD COLUMN group_msg_id TEXT;
ALTER TABLE messages ADD COLUMN canonical INTEGER NOT NULL DEFAULT 1;
CREATE INDEX idx_messages_group ON messages(group_msg_id);
