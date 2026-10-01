-- Tetris schema. Everything communication-related is ciphertext or routing metadata.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_version INTEGER NOT NULL DEFAULT 0,
  -- account password: the browser sends an Argon2id-derived proof, we store its SHA-256
  auth_salt TEXT NOT NULL,
  auth_hash TEXT NOT NULL,
  -- vault passcode: salt is public, we store only SHA-256 of the derived verifier.
  -- NULL means "vault must be (re)set up", which is the state right after a wipe.
  vault_salt TEXT,
  vault_verifier_hash TEXT,
  communication_epoch INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- A vault token exists only in one browser tab's memory after a successful unlock.
CREATE TABLE unlocks (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_unlocks_user ON unlocks(user_id);
CREATE INDEX idx_unlocks_session ON unlocks(session_id);

CREATE TABLE unlock_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempt_used INTEGER NOT NULL DEFAULT 0,
  outcome TEXT, -- SUCCESS | WRONG | TIMEOUT
  completed_at INTEGER
);
CREATE INDEX idx_challenges_session ON unlock_challenges(session_id);
CREATE INDEX idx_challenges_pending ON unlock_challenges(expires_at) WHERE outcome IS NULL;
CREATE INDEX idx_challenges_user_pending ON unlock_challenges(user_id) WHERE outcome IS NULL;

-- One active device per account; a new device replaces the old one.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  signing_key TEXT NOT NULL,
  spk_id INTEGER NOT NULL,
  spk_public TEXT NOT NULL,
  spk_signature TEXT NOT NULL,
  communication_epoch INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_devices_user_active ON devices(user_id) WHERE revoked_at IS NULL;

CREATE TABLE prekeys (
  device_id TEXT NOT NULL,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  PRIMARY KEY (device_id, key_id)
);

CREATE TABLE contacts (
  owner_user_id TEXT NOT NULL,
  contact_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_user_id, contact_user_id)
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  UNIQUE (user_a, user_b)
);

CREATE TABLE conversation_members (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  communication_epoch INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_members_user ON conversation_members(user_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  sender_device_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  recipient_device_id TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  crypto_header BLOB NOT NULL,
  attachment_id TEXT,
  delivery_state TEXT NOT NULL DEFAULT 'accepted',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_messages_recipient_sync ON messages(recipient_user_id, updated_at, id);
CREATE INDEX idx_messages_sender_sync ON messages(sender_user_id, updated_at, id);
CREATE INDEX idx_messages_expires ON messages(expires_at);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  object_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_attachments_owner ON attachments(owner_user_id);
CREATE INDEX idx_attachments_expires ON attachments(expires_at);

CREATE TABLE wipe_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  from_epoch INTEGER NOT NULL,
  to_epoch INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
