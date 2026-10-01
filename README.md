# Lop

A web-only, end-to-end encrypted messenger. Everything you send vanishes after 24 hours. Every time you open the app, a vault passcode stands between you and your chats: **one attempt, 30 seconds**. Wrong or late clears contacts and chats (your account and profile stay).

Developed by [Manas Dutta](https://www.manasdutta.com/).

## Features

- **End-to-end encryption** for text, replies, reactions, edits, polls, voice notes, and files — sealed in the browser before anything is sent
- **24-hour expiry** on messages and attachments (server clock), with automatic cleanup
- **Vault passcode gate** on every open (including refresh): separate from the account password, never uploaded
- **Wipe on failure**: wrong or timed-out unlock removes communication state locally and on the server
- **Exact `@username` lookup** only — no public directory, no fuzzy search
- **Safety numbers** for out-of-band identity checks
- Delivery / read ticks, typing indicators, nicknames, block, delete for me / for everyone
- Attachments: photos, documents, audio (up to 90 MB), video (up to 16 MB), on-device voice notes
- Light and dark themes; Privacy, Terms, and Security pages in the app
- In-app **forgot account password** (email + username, plus vault passcode when the vault is still active) — no reset emails

## Security (summary)

| Piece | What happens |
| --- | --- |
| Account password | Argon2id in the browser; the server stores a hash of a derived proof, never the password |
| Vault passcode | Never sent. Derives a local vault key that seals IndexedDB; the server only stores a verifier hash |
| Messages | Signal-style X3DH + Double Ratchet with AES-256-GCM. Server holds ciphertext and routing metadata only |
| Attachments | Random per-file key in the browser; ciphertext stored for delivery; the key rides inside the E2EE envelope |
| Session | Cookie alone never unlocks chats — a per-tab vault token (memory only) is required after unlock |
| Metadata | Timestamps, sizes, and who talks to whom can still be visible to the relay — content is not |

More detail and how to report issues: see [SECURITY.md](./SECURITY.md).

## Run locally

Requires **Node.js 20+**.

```bash
git clone https://github.com/manasdutta04/lop.git
cd lop
npm install
cp workers/api/.dev.vars.example workers/api/.dev.vars
npm run db:migrate:local
npm run dev:api          # API on http://127.0.0.1:8787
npm run dev              # web on http://localhost:5173 (proxies /api)
```

Open http://localhost:5173. Use two browsers (or profiles) to chat with yourself.

### Checks

```bash
npm run typecheck
npm test
```

## Workspace

```text
apps/web          React client
workers/api       API, realtime gateway, scheduled cleanup
packages/crypto   Argon2id, X3DH, Double Ratchet, file crypto
packages/protocol Message envelope types
packages/types    Shared DTOs
packages/config   Shared constants
db/migrations     Database schema
```

## Known trade-offs

- Anyone with only the account password can sign in and fail the vault challenge, which triggers a wipe — by design.
- One active unlocked device per account; unlocking elsewhere takes over the keys.
- Peers may keep copies until the 24 h expiry even after you wipe.
- Vault passcode cannot be recovered; account password recovery never reveals message plaintext.
