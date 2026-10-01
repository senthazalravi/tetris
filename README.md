# Tetris

A web-only, end-to-end encrypted messenger. Everything you send vanishes after 24 hours. Every time you open the app, your passcode stands between you and your chats: **one attempt, 30 seconds**, and then you are on the Tetris home screen. Wrong or late clears contacts and chats (your account and profile stay).

Developed by [Manas Dutta](https://www.manasdutta.com/).

## Features

- **End-to-end encryption** for text, replies, reactions, edits, polls, voice notes, and files — sealed in the browser before anything is sent
- **24-hour expiry** on messages and attachments (server clock), with automatic cleanup
- **Group chats**: predefined groups (seeded from a gitignored `groups.local.json`) are end-to-end encrypted by sealing each message separately for every member. Group messages and files last 7 days instead of 24 hours, and groups are found with the same search
- **Username + 8-digit passcode** are the only credentials: no account password. An email is collected at sign-up for notifications only. The passcode is never uploaded
- **Tetris gate**: after unlocking, you play a round of Tetris; the chats open when the game ends
- **Wipe on failure**: wrong or timed-out unlock removes communication state locally and on the server
- **Exact `@username` lookup** only — no public directory, no fuzzy search
- **Safety numbers** for out-of-band identity checks
- Delivery / read ticks, typing indicators, nicknames, delete for me / for everyone
- Attachments: photos, documents, audio (up to 90 MB), video (up to 16 MB), on-device voice notes
- Light and dark themes; Privacy, Terms, and Security pages in the app
- No landing page. An expired passcode (wrong or late unlock) is reset by confirming the email on file

## Security (summary)

| Piece | What happens |
| --- | --- |
| Passcode (8 digits) | Never sent. Derives a local vault key that seals IndexedDB; the server only stores a verifier hash |
| Messages | Signal-style X3DH + Double Ratchet with AES-256-GCM. Server holds ciphertext and routing metadata only |
| Attachments | Random per-file key in the browser; ciphertext stored for delivery; the key rides inside the E2EE envelope |
| Session | Cookie alone never unlocks chats — a per-tab vault token (memory only) is required after unlock |
| Metadata | Timestamps, sizes, and who talks to whom can still be visible to the relay — content is not |

More detail and how to report issues: see [SECURITY.md](./SECURITY.md).

## Run locally

Requires **Node.js 20+**.

```bash
git clone https://github.com/manasdutta04/tetris.git
cd tetris
npm install
cp workers/api/.dev.vars.example workers/api/.dev.vars
npm run db:migrate:local
cp users.example.json users.local.json   # edit: your predefined users (never commit it)
npm run users:seed
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

- Only the browser that last unlocked an account can wipe it by failing or abandoning the unlock; any other browser just gets a rate-limited failure.
- The Tetris screen is a UI gate, not a cryptographic one: the vault is already unlocked in memory while you play.
- An 8-digit passcode has a small search space; Argon2id stretching and the one-attempt rule are what protect it.
- One active unlocked device per account; unlocking elsewhere takes over the keys.
- Peers may keep copies until the 24 h expiry even after you wipe.
- A forgotten passcode cannot be recovered; after it expires, anyone who knows a user's username and email can set a new one (chats are already wiped).
