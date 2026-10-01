# Tetris — High-Level Design (HLD)

> **Revision note (Tetris revamp).** Auth sections below describe the original email + password design. The current product has no landing page, no email and no account password: users sign in with a username and a fixed 8-digit passcode (one attempt, 30 s, wipe on failure from the account's own browser), then play a round of Tetris before the chats open. See `.agents/AUTH.md`, `SECURITY.md` and `db/migrations/0004_passcode_only.sql`.

| | |
|---|---|
| **Product** | Tetris — web-only E2EE messenger |
| **Version** | 1.0 · 30 Sep 2026 |
| **Status** | Implementation baseline |
| **Supersedes (auth)** | Google OAuth and phone OTP from earlier drafts |
| **Companion** | `docs/Tetris_03_LLD.md`, `.agents/*`, `Tetris_01_BRD.md` |

---

## 1. Purpose

This HLD defines the system shape for Tetris after the product lock:

- **Email + password** account creation and login (no Google, no phone).
- **Username / user ID** discovery by **exact match only**.
- **WhatsApp-like contact model**: you only see people you added or chat with — never the whole user directory.
- **Mandatory end-to-end encryption** for all message and file content.
- **Mandatory 24-hour message expiry**.
- **30-second, one-attempt vault passcode** after login; wrong/timeout wipes communication state; correct unlock keeps data.
- **Free-tier stack only** (Cloudflare free plan for the pilot).

---

## 2. Locked product decisions

| Decision | Choice |
|---|---|
| Platform | Web only (desktop-first, responsive) |
| Auth | Email + password; unique `@username` (user ID) |
| Google / phone login | Out of MVP |
| Contact discovery | Exact `@username` lookup; no fuzzy global search |
| Contact list | Only saved contacts + people with conversations |
| Directory | Not public; no “everyone on Tetris” list |
| E2EE | Signal-style 1:1 (X3DH + Double Ratchet family) via vetted libs |
| Message TTL | Fixed 24h from server `created_at` |
| Wipe on correct passcode | **No** — keep chats/contacts |
| Wipe on wrong / timeout | **Yes** — clear communication state; account survives |
| Passcode attempts | Exactly **one** per unlock session |
| Cost | Free tiers only; no paid SMS, no paid APIs |

---

## 3. System context

```text
┌──────────────┐         HTTPS / WSS          ┌────────────────────────────┐
│  Browser     │◄────────────────────────────►│  Cloudflare Edge           │
│  React app   │                              │  Workers + Durable Objects │
│  Web Crypto  │                              │  D1 + R2                   │
│  IndexedDB   │                              └────────────────────────────┘
└──────────────┘
        │
        │ plaintext exists ONLY here
        │ (after local decrypt / before local encrypt)
        ▼
   User's device memory
```

**Trust boundary:** the server is an untrusted relay for content. It may store ciphertext, routing IDs, timestamps, and sizes. It must never receive message or file plaintext.

---

## 4. Logical architecture

```text
                    ┌─────────────────────────────────────┐
                    │            Web Client               │
                    │  Auth UI │ Lock/Passcode │ Chat UI  │
                    │  Crypto Worker │ IndexedDB Vault    │
                    └───────────────┬─────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────┐
                    │         API Gateway (Worker)        │
                    │  Auth · Sessions · Rate limits      │
                    │  Epoch / wipe gates                 │
                    └─┬──────┬──────┬──────┬──────┬───────┘
                      │      │      │      │      │
             ┌────────┘      │      │      │      └────────┐
             ▼               ▼      ▼      ▼               ▼
        Auth/Users      Identity  Contacts  Messaging   Attachments
        (D1)            Keys      (D1)      Relay+TTL   (R2+D1)
                                        │
                                        ▼
                                 Durable Object
                                 (per-user / per-conv WS)
```

### Component responsibilities

| Component | Responsibility |
|---|---|
| **Web client** | UI (WhatsApp Web–like), encrypt/decrypt, local vault, passcode gate, wipe local state |
| **Auth service** | Register, login, session cookies, password verify, logout |
| **Identity service** | Device registration, public identity/prekey bundles |
| **Contact service** | Exact username lookup, private contact list CRUD, block |
| **Messaging service** | Accept/relay ciphertext, delivery/read acks, TTL enforcement |
| **Attachment service** | Authorize upload/download of ciphertext blobs to R2 |
| **Wipe service** | Authenticated communication-state wipe + epoch bump |
| **Realtime (DO)** | WebSocket fan-out for online delivery, typing, presence |

---

## 5. User journeys (HLD)

### 5.1 First-time account

```text
Landing → Create account
  email + password + @username + display name + vault passcode
       → identity keys generated in browser
       → public keys uploaded
       → session established
       → empty chat UI (no contacts yet)
```

### 5.2 Returning login

```text
Login (email or username + password)
       → authenticated session
       → vault passcode screen (30s, 1 attempt)
            ├─ correct → unlock local vault → restore chats/contacts
            └─ wrong / timeout → communication wipe → empty UI (account stays)
```

### 5.3 Find someone and message (WhatsApp analogue)

WhatsApp: save phone → contact appears → open chat.  
Tetris: know `@userid` → exact lookup → save/message → appears in *your* list only.

```text
New chat → enter exact @username
       → server returns match OR not found (never a browse list)
       → view public card (username, display name, avatar, key fingerprint)
       → Add contact and/or Send message
       → E2EE session init → encrypted chat
```

The other user’s contact list is unaffected until they add you or you message them (their chat list then shows the conversation).

### 5.4 Message lifetime

```text
Send → encrypt in browser → server stores ciphertext + expires_at = now+24h
     → deliver when recipient online / queue offline
     → at expiry: APIs refuse return; rows/objects deleted; clients drop local copy
```

---

## 6. Contact model (WhatsApp-like)

| Behavior | Tetris rule |
|---|---|
| Global member directory | **Forbidden** |
| Search | Exact `@username` only |
| Partial / “people you may know” | **Out of MVP** |
| My contacts | Private per-user list of saved user IDs |
| Chat list | Conversations I participate in (after wipe: empty) |
| Visibility of my contacts to others | Never exposed as a list |
| Block | Stops new messages, typing, presence toward blocker |

Contacts are **not** all app users. They are the subset *this account* chose to save or chat with.

---

## 7. Cryptographic design (HLD)

### 7.1 Principle

Do not invent a protocol. Use a mature Signal-style stack with browser support (TypeScript/WASM), license-compatible for this repo.

Recommended protocol shape for 1:1:

1. Long-term **identity key** pair per device  
2. **Signed prekey** + **one-time prekeys** published to server  
3. **X3DH** (or PQXDH if the chosen library supports it) for async session start  
4. **Double Ratchet** for ongoing message keys  
5. **AEAD** for message payloads  
6. Separate random **content keys** for file encryption; content key wrapped for the recipient in the E2EE envelope  

### 7.2 Key hierarchy

```text
Account password ────────────► server-side password hash (auth only)
Vault passcode ──KDF─────────► vault key ──unwraps──► local private keys / IndexedDB
Device identity key ─────────► signed prekeys / session roots
Per-conversation ratchet ────► per-message keys
Attachment content key ──────► encrypted blob on R2
```

Auth password and vault passcode are **different secrets**.

### 7.3 What the server stores

| Allowed | Forbidden |
|---|---|
| Public identity / prekeys | Private keys |
| Ciphertext + crypto headers | Plaintext body |
| Ciphertext size, timestamps | Content keys in plaintext |
| User id, username, email hash/record for auth | Passcode plaintext |

### 7.4 Web-specific constraints

- Sensitive plaintext and vault key material stay **in memory** after unlock.  
- Encrypted material may sit in **IndexedDB**.  
- **No** private keys, session tokens, or plaintext in `localStorage`.  
- Heavy crypto/file work runs in a **Web Worker**.  
- CSP + dependency pinning defend against malicious JS delivery (web E2EE’s hard limit).

---

## 8. Security behaviors

### 8.1 Communication wipe

Triggered by: wrong vault passcode **or** unlock timeout (server-authoritative timer).  
Not triggered by: correct passcode in time.

Effects:

- Bump `communication_epoch`  
- Delete this user’s contacts, conversations membership, messages, attachments, prekey/session material tied to the old epoch  
- Client deletes IndexedDB, caches, in-memory secrets  
- Account row (email, username, password hash, profile) remains  
- UI opens empty  

Peer devices keep their own copies until those messages hit 24h expiry (no silent remote wipe of peers).

### 8.2 24-hour expiry

- Server sets `expires_at`  
- Read/sync endpoints never return expired rows  
- Background cleanup deletes D1 rows and R2 objects  
- Clients prune locally on timer and on sync  

### 8.3 Honest claims

Say “end-to-end encrypted”. Do not claim “fully secure” before review gates in the LLD.

---

## 9. Technology stack (free, current)

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite | Modern web app standard |
| Styling | Tailwind CSS | Fast WhatsApp-like layout |
| Realtime | Cloudflare Durable Objects + WebSocket | Free-tier friendly, sticky connections |
| API | Cloudflare Workers | Edge compute, no always-on VM |
| DB | Cloudflare D1 | SQL metadata + ciphertext rows |
| Files | Cloudflare R2 | Object storage; free egress to Workers |
| Auth crypto | Argon2id or scrypt (WASM/noble) + secure cookies | Password auth without paid IdP |
| Message crypto | Audited Signal-style lib (WASM/TS) | No home-grown E2EE |
| Bot protection | Cloudflare Turnstile (free) | Abuse control without SMS |
| Hosting | Workers / Pages free subdomain | Zero pilot cost |

**Explicitly deferred (cost or complexity):** phone OTP, native apps, paid TURN for calls, enterprise SSO.

---

## 10. Deployment view

```text
apps/web  ──build──► Cloudflare Pages / Workers assets
workers/api ───────► Worker routes /api/v1/*
workers/realtime ──► Durable Object namespaces
db/migrations ─────► D1
R2 bucket ─────────► encrypted attachments
```

Environments: `local` (Wrangler), `preview`, `production` (same free account until scale requires paid).

---

## 11. Non-functional requirements

| Area | Target |
|---|---|
| First paint shell | &lt; 2.5s typical broadband |
| Local send feedback | &lt; 100ms before network |
| Message retention | ≤ 24h hard |
| Cost | $0 pilot within documented free limits |
| Browsers | Current Chrome, Edge, Firefox, Safari |
| Devices (MVP) | One active web device per account |

---

## 12. Phase plan

| Phase | Scope |
|---|---|
| **MVP** | Auth, exact lookup, contacts, 1:1 E2EE text+files, ticks, typing, 24h TTL, passcode wipe gate, WhatsApp Web–like UI |
| **Phase 2** | Groups, voice notes, multi-device, richer previews |
| **Phase 3** | WebRTC calls, audit, stronger metadata privacy |

---

## 13. Risks (architecture-relevant)

| Risk | Mitigation |
|---|---|
| Custom crypto bugs | Vetted libraries only; review gates |
| Free-tier limits | Quotas, attachment caps, monitoring |
| Accidental wipe (timeout) | Clear UX copy; server timer; warnings at signup |
| AGPL contamination | Reimplement patterns; license review before vendoring |
| Metadata leakage | Disclose; minimize fields; no plaintext logs |

---

## 14. Traceability

| Concern | LLD section |
|---|---|
| Schemas | LLD §3 |
| Auth + sessions | LLD §4 |
| Passcode + wipe | LLD §5 |
| Contacts API | LLD §6 |
| E2EE session | LLD §7 |
| Messages + TTL | LLD §8 |
| Attachments | LLD §9 |
| WebSocket | LLD §10 |
| Client modules | LLD §11 |
| Test acceptance | LLD §14 |
