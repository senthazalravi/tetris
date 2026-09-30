-- 0001_init.sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_ref TEXT,
  communication_epoch INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_users_username ON users(username);
CREATE UNIQUE INDEX idx_users_email ON users(email);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  identity_public_key BLOB NOT NULL,
  signing_public_key BLOB,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  communication_epoch INTEGER NOT NULL
);

CREATE INDEX idx_devices_user ON devices(user_id);

CREATE TABLE prekeys (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  key_id INTEGER NOT NULL,
  public_key BLOB NOT NULL,
  signature BLOB,
  kind TEXT NOT NULL,
  consumed_at INTEGER,
  UNIQUE(device_id, key_id, kind)
);

CREATE TABLE contacts (
  owner_user_id TEXT NOT NULL,
  contact_user_id TEXT NOT NULL,
  display_alias TEXT,
  created_at INTEGER NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_user_id, contact_user_id)
);

CREATE INDEX idx_contacts_owner ON contacts(owner_user_id);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'direct',
  created_at INTEGER NOT NULL
);

CREATE TABLE conversation_members (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  communication_epoch INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_conv_members_user ON conversation_members(user_id);

CREATE TABLE direct_pairs (
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  conversation_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (user_a, user_b)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  sender_device_id TEXT NOT NULL,
  communication_epoch INTEGER NOT NULL,
  ciphertext BLOB NOT NULL,
  crypto_header BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  delivery_state TEXT NOT NULL
);

CREATE INDEX idx_messages_conv_created ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_expires ON messages(expires_at);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  ciphertext_size INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE wipe_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL,
  from_epoch INTEGER NOT NULL,
  to_epoch INTEGER NOT NULL
);

CREATE TABLE unlock_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempt_used INTEGER NOT NULL DEFAULT 0,
  outcome TEXT,
  completed_at INTEGER
);

CREATE INDEX idx_unlock_session ON unlock_challenges(session_id);
