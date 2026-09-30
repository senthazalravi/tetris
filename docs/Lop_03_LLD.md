# Lop — Low-Level Design (LLD)

| | |
|---|---|
| **Product** | Lop |
| **Version** | 1.0 · 30 Sep 2026 |
| **Status** | Engineering handoff |
| **Companion** | `docs/Lop_02_HLD.md`, `.agents/*` |

---

## 1. Scope of this LLD

This document specifies implementable detail for MVP:

- Email/password registration and login  
- Exact `@username` contact discovery  
- Private contact + chat lists  
- Signal-style 1:1 E2EE  
- Encrypted attachments  
- 24h expiry  
- Vault passcode gate + wipe-on-failure  

Out of scope here: groups, calls, Google/phone auth, multi-device sync.

---

## 2. Identifiers and conventions

| Entity | Format |
|---|---|
| `user_id` | `usr_` + ULID |
| `username` | 3–32 chars, `[a-z0-9_]`, stored lowercase, displayed as `@name` |
| `email` | normalized lowercase; unique |
| `device_id` | `dev_` + ULID |
| `conversation_id` | `cnv_` + ULID |
| `message_id` | `msg_` + ULID (client-generated, server-validated unique) |
| `wipe_operation_id` | UUID |
| Timestamps | Unix ms, **server clock** authoritative |

Username lookup is **case-insensitive exact match** only. No `LIKE`, no prefix search in MVP.

---

## 3. Database schema (D1)

### 3.1 `users`

```sql
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
```

### 3.2 `sessions`

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
```

### 3.3 `devices`

```sql
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
```

### 3.4 `prekeys`

```sql
CREATE TABLE prekeys (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  key_id INTEGER NOT NULL,
  public_key BLOB NOT NULL,
  signature BLOB,
  kind TEXT NOT NULL, -- 'signed' | 'one_time'
  consumed_at INTEGER,
  UNIQUE(device_id, key_id, kind)
);
```

### 3.5 `contacts`

Private per-owner list. **Never** return another user’s full contact list.

```sql
CREATE TABLE contacts (
  owner_user_id TEXT NOT NULL,
  contact_user_id TEXT NOT NULL,
  display_alias TEXT,
  created_at INTEGER NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_user_id, contact_user_id)
);

CREATE INDEX idx_contacts_owner ON contacts(owner_user_id);
```

### 3.6 `conversations` / `conversation_members`

```sql
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
```

For 1:1, enforce at most two members. Optional uniqueness on sorted pair `(user_a, user_b)` via application logic or a `direct_pairs` helper table.

### 3.7 `messages`

```sql
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
  delivery_state TEXT NOT NULL -- accepted|delivered|read
);

CREATE INDEX idx_messages_conv_created ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_expires ON messages(expires_at);
```

### 3.8 `attachments`

```sql
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  ciphertext_size INTEGER NOT NULL,
  -- opaque client mime hint may be encrypted inside envelope;
  -- server stores only coarse "bin" if needed
  expires_at INTEGER NOT NULL
);
```

### 3.9 `wipe_operations`

```sql
CREATE TABLE wipe_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL, -- WRONG_PASSCODE | TIMEOUT | MANUAL
  requested_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL,
  from_epoch INTEGER NOT NULL,
  to_epoch INTEGER NOT NULL
);
```

### 3.10 Unlock challenges (server timer)

```sql
CREATE TABLE unlock_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, -- started_at + 30000
  attempt_used INTEGER NOT NULL DEFAULT 0,
  outcome TEXT, -- SUCCESS | WRONG | TIMEOUT | ABANDONED
  completed_at INTEGER
);
```

---

## 4. Authentication (email + password)

### 4.1 Register

`POST /api/v1/auth/register`

```json
{
  "email": "alice@example.com",
  "password": "...",
  "username": "alice",
  "displayName": "Alice",
  "vaultPasscodeVerifier": "<opaque client verifier or setup blob>"
}
```

Server steps:

1. Validate email, password policy (≥12 chars, complexity rules), username charset/uniqueness.  
2. Hash password with **Argon2id** (or scrypt if Argon2 WASM cost is unacceptable on Workers). Params documented in code.  
3. Insert `users`.  
4. Create session; set **HttpOnly; Secure; SameSite=Lax** cookie.  
5. Do **not** store vault passcode plaintext. Client derives vault key locally; optional server stores only a salted verifier for “wrong/right” without learning the passcode (see §5).

Client after register:

1. Generate device identity + prekeys.  
2. Wrap private material with vault key.  
3. Upload public bundle.  
4. Show empty chat shell (skip unlock challenge on first setup if passcode just set — product choice: treat first setup as already unlocked).

### 4.2 Login

`POST /api/v1/auth/login`

```json
{ "login": "alice@example.com", "password": "..." }
```

`login` accepts **email or username**.

On success: create session + create `unlock_challenges` row (30s). Response:

```json
{
  "user": { "id": "usr_...", "username": "alice", "displayName": "Alice" },
  "unlockChallengeId": "…",
  "unlockExpiresAt": 1790755230000
}
```

Client must show passcode UI immediately. Chat data remains locked until §5 succeeds.

### 4.3 Password policy (MVP)

- Min 12 characters  
- Reject breached-password basic checks if a free local list is available; otherwise length + entropy heuristics  
- Rate limit: progressive backoff per IP + per account  

---

## 5. Vault passcode + wipe

### 5.1 Client unlock

1. User enters passcode once.  
2. Client derives vault key via memory-hard KDF (e.g. Argon2id in WASM).  
3. Attempt unwrap of local key blob.  
4. Call `POST /api/v1/auth/unlock` with challenge id + success/failure signal.

### 5.2 Server unlock API

`POST /api/v1/auth/unlock`

```json
{
  "unlockChallengeId": "…",
  "result": "SUCCESS" | "FAILURE"
}
```

Server rules:

| Condition | Action |
|---|---|
| `now > expires_at` | Force wipe reason `TIMEOUT`; outcome TIMEOUT |
| `attempt_used == 1` already | Reject; already terminal |
| `result == FAILURE` | Mark attempt used; wipe reason `WRONG_PASSCODE` |
| `result == SUCCESS` and within window | Mark SUCCESS; **no wipe**; allow crypto sync |
| Tab closed / no call by expiry | Sweeper marks TIMEOUT and wipes |

**One attempt:** set `attempt_used = 1` on first submit regardless of success/failure.

### 5.3 Wipe algorithm

`POST /api/v1/account/communication-wipe` (also invoked internally)

Idempotent via `Idempotency-Key` / wipe operation id.

Transactional outline:

1. Read `communication_epoch` → `from`.  
2. Set `communication_epoch = from + 1` → `to`.  
3. Delete/revoke for this `user_id` where epoch ≤ `from`:  
   - contacts owned by user  
   - conversation_members for user  
   - messages sent by user in those memberships (and orphan cleanup)  
   - attachments for those messages  
   - devices’ ratchet-related server records if any; mark devices needing re-key  
   - offline queues  
4. Insert `wipe_operations` completed.  
5. Emit WS `wipe.completed` to user’s connections.  

Client wipe checklist:

- Close WS, cancel uploads  
- Delete IndexedDB databases for chat/crypto vault stores  
- Clear Cache Storage / temp object URLs  
- Zero in-memory keys  
- Reload empty shell still authenticated  

### 5.4 Correct passcode

- Unwrap succeeds → load contacts/messages for current epoch only.  
- Server does **not** wipe.  
- Old epoch ciphertext must already be unreadable / deleted after prior wipes.

---

## 6. Contacts and discovery

### 6.1 Exact lookup

`GET /api/v1/users/lookup?username=alice`

- Normalize to lowercase.  
- `SELECT` by exact username.  
- If missing → `404`.  
- If found → public card only:

```json
{
  "userId": "usr_…",
  "username": "alice",
  "displayName": "Alice",
  "avatarUrl": null,
  "identityKeyFingerprint": "abcd1234…"
}
```

**Forbidden:** list endpoints that return arbitrary users, suggestions, or partial matches.

### 6.2 Contact list (mine only)

`GET /api/v1/contacts`

Returns rows where `owner_user_id = me` and `blocked = 0` (or include blocked in a separate filter).

`POST /api/v1/contacts`

```json
{ "contactUserId": "usr_…", "displayAlias": "Ali" }
```

Requires that `contactUserId` exists. Does not notify the other user unless a chat/message follows (MVP: silent save, WhatsApp-like).

`DELETE /api/v1/contacts/:contactUserId` — remove from my list only.

`POST /api/v1/contacts/:contactUserId/block` — set blocked; messaging service rejects inbound/outbound as configured.

### 6.3 Chat list vs contacts

- **Contacts**: people I saved.  
- **Conversations**: threads I am a member of for current epoch.  
- Sidebar (WhatsApp Web style): conversation list primary; “New chat” opens contacts + username search entry.  

Empty states after wipe / new account:

- Contacts: “No contacts yet”  
- Chats: “No conversations”  

---

## 7. E2EE session (1:1)

### 7.1 Publish keys

`POST /api/v1/devices` — register device + identity public key for current epoch.  
`POST /api/v1/devices/:id/prekeys` — upload signed + one-time prekeys.  
`GET /api/v1/users/:id/key-bundle` — return identity + signed prekey + one one-time prekey (consume OTP).

### 7.2 Session establishment

```text
Alice                          Server                         Bob
  |-- GET key-bundle(Bob) ------>|                              |
  |<-- public bundle ------------|                              |
  |  X3DH locally                |                              |
  |-- msg (PreKey / first) ----->|-- queue / WS --------------->|
  |                              |                              | decrypt / init ratchet
```

Server never sees root keys or plaintext.

### 7.3 Message envelope (logical)

Client plaintext object (never sent as-is):

```json
{
  "kind": "text",
  "body": "Hello",
  "replyTo": null
}
```

Wire payload to server:

```json
{
  "type": "message.send",
  "conversationId": "cnv_…",
  "messageId": "msg_…",
  "communicationEpoch": 3,
  "cryptoHeader": "<base64>",
  "ciphertext": "<base64>",
  "clientSentAt": 0
}
```

Server assigns `created_at`, `expires_at = created_at + 86_400_000`, validates epoch matches user’s current epoch, size limits, and membership.

### 7.4 Library choice (implementation constraint)

Preferred order:

1. Mature browser-capable Signal-protocol binding with acceptable license.  
2. Else Matrix `matrix-sdk-crypto-wasm`-style approach adapted behind our protocol types.  
3. **Never** paste unfamiliar crypto from AGPL sources into a proprietary build without license decision.

Wrap all crypto behind `packages/crypto` so the rest of the app depends on interfaces, not a vendor.

---

## 8. Messaging + 24h expiry

### 8.1 Send path

1. Client encrypts.  
2. `POST /conversations/:id/messages` or WS `message.send`.  
3. Server checks: auth, membership, epoch, not blocked, ciphertext size, `expires_at` in future.  
4. Persist; fan-out via Durable Object; ack sender.  

### 8.2 Sync path

`GET /conversations/:id/messages?after=…`

Filter: `expires_at > server_now` AND member epoch matches. Expired rows never returned even if cleanup lagging.

### 8.3 Expiry worker

Cron Trigger (Workers):

1. Select `messages` where `expires_at <= now` LIMIT N.  
2. Delete related attachments from R2.  
3. Delete attachment rows + message rows.  
4. Notify online members `message.expired`.  

Lazy rule on every read: same `expires_at` predicate.

### 8.4 Delivery states

`accepted` → `delivered` → `read` → (`expired` client-side).

UI ticks analogous to WhatsApp but original assets (no WA trademarks).

---

## 9. Attachments

1. Client generates random content key; encrypts file (AEAD) in Worker.  
2. `POST /attachments/upload-token` → short-lived R2 upload auth for `object_key`.  
3. Upload ciphertext only.  
4. `POST /attachments/complete` links metadata to message.  
5. Content key travels inside E2EE message envelope to recipient.  
6. Download via authorized GET token; decrypt locally.  

Limits (MVP free tier): e.g. 10 MB/file, daily byte quota per user (configurable).

---

## 10. WebSocket protocol

Endpoint: `wss://<host>/api/ws`

Client → server:

- `auth`  
- `message.send`  
- `message.ack`  
- `typing.start` / `typing.stop`  
- `presence.ping`  

Server → client:

- `message.new` | `message.delivered` | `message.read` | `message.expired`  
- `wipe.completed`  
- `session.revoked`  
- `typing.*` | `presence.update`  

All payloads ciphertext or metadata only.

Durable Object strategy (MVP):

- `UserGatewayDO` keyed by `user_id` for connection registry + push  
- Optional `ConversationDO` for hot rooms if needed later  

---

## 11. Client module map

```text
apps/web/src/
  auth/          login, register, session, unlock-challenge
  passcode/      KDF, vault unwrap, countdown UI
  crypto/        identity, prekeys, session, ratchet facade, attachments
  contacts/      exact lookup, list, add, block
  chat/          conversation list, thread, composer, ticks, expiry UI
  realtime/      WS client, reconnect, epoch guard
  storage/       IndexedDB encrypted stores, memory secrets
  wipe/          client checklist + server sync
  ui/            WhatsApp Web–like shell (original chrome)
```

State domains: `authState`, `unlockState`, `contactState`, `conversationState`, `messageState`, `cryptoState`, `wipeState`.

After successful unlock: hydrate from IndexedDB + sync.  
After wipe: all communication domains empty; `authState` remains signed in.

---

## 12. API summary

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | email+password+username |
| POST | `/auth/login` | email or username + password |
| POST | `/auth/logout` | |
| GET | `/auth/session` | |
| POST | `/auth/unlock` | challenge result |
| GET | `/users/lookup` | exact username |
| GET | `/users/me` | |
| PATCH | `/users/me` | profile |
| GET | `/contacts` | mine only |
| POST | `/contacts` | save by user id |
| DELETE | `/contacts/:id` | |
| POST | `/contacts/:id/block` | |
| POST | `/devices` | |
| GET | `/users/:id/key-bundle` | |
| POST | `/devices/:id/prekeys` | |
| POST | `/conversations` | create 1:1 |
| GET | `/conversations` | mine |
| POST | `/conversations/:id/messages` | ciphertext |
| GET | `/conversations/:id/messages` | non-expired |
| POST | `/messages/:id/ack` | |
| POST | `/attachments/upload-token` | |
| POST | `/attachments/complete` | |
| GET | `/attachments/:id/download-token` | |
| POST | `/account/communication-wipe` | |

Every mutating authenticated call validates session + `communication_epoch` when touching chat data.

---

## 13. Security controls (concrete)

- HTTPS only; HSTS  
- CSP: default-src self; no arbitrary third-party scripts  
- CSRF: SameSite cookies + additional token on state-changing POSTs if cookie auth  
- Turnstile on register/login  
- Rate limits: login, lookup (e.g. 30/min), contact add, message send, wipe  
- Max ciphertext size enforced  
- No plaintext in logs  
- Wipe and unlock endpoints idempotent and replay-safe  

---

## 14. Acceptance tests (must pass)

1. **Register/login:** create account with email/password/username; logout; login again.  
2. **Exact lookup:** `@bob` found; `@bo` not found; no endpoint lists all users.  
3. **Contacts private:** Alice’s contacts API never returns users she did not add; Bob cannot read Alice’s list.  
4. **E2EE:** Alice sends “Hello”; D1 message row is not plaintext; Bob decrypts.  
5. **File E2EE:** encrypted image on R2; Bob decrypts; R2 object is not viewable as image without key.  
6. **24h:** advance time / set short TTL in test; message and attachment unretrievable.  
7. **Unlock success:** correct passcode in 30s → chats restored.  
8. **Unlock fail:** wrong passcode → empty contacts/chats; same username can still login.  
9. **Unlock timeout:** no submit within 30s → wipe.  
10. **One attempt:** second submit rejected.  
11. **UI:** side-by-side layout review vs WhatsApp Web (structure only).  

---

## 15. Implementation order

1. Monorepo + Workers + D1 + R2 scaffolding  
2. Register/login/sessions  
3. Unlock challenge + wipe epoch  
4. Exact lookup + contacts  
5. Device/prekeys + E2EE send/receive  
6. TTL worker + lazy expiry  
7. Attachments  
8. WS delivery, ticks, typing  
9. WhatsApp-like UI polish  
10. Security hardening + e2e tests  

---

## 16. Open engineering choices (defaults)

| Topic | Default |
|---|---|
| Password KDF | Argon2id WASM; fallback scrypt |
| Vault KDF | Argon2id, separate salt |
| First register unlock | Skip challenge; treat as unlocked |
| Direct conversation uniqueness | Canonical pair key `min(id),max(id)` |
| Multi-tab unlock | BroadcastChannel shares unlock success; wipe broadcasts too |
| Peer copy on wipe | Retain until 24h (HLD) |
