# Lop

A web-only, end-to-end encrypted messenger. Everything you send expires after 24 hours, and every time you open the app it asks for a vault passcode: one attempt, 30 seconds. Wrong or late means your chats and contacts are wiped (your account and profile stay).

Runs entirely on Cloudflare's free plan: one Worker (API + static app), D1, R2 and a SQLite Durable Object.

## How it works

| Concern | Design |
| --- | --- |
| Account | Email + unique `@username` + password. The password is stretched with Argon2id **in the browser**; the server only stores a hash of a derived proof, never the password. |
| Vault passcode | Separate secret, never sent. Argon2id → a vault key that seals all local data in IndexedDB, plus a verifier whose hash the server stores. |
| Unlock gate | Every page open (including refresh) creates or resumes a server-clocked 30 s challenge. One attempt. The session cookie alone unlocks nothing: data endpoints also need a per-tab vault token held only in memory. |
| Wipe | Wrong passcode, timeout, or an abandoned challenge (tab closed, enforced by cron) deletes contacts, chats, keys and pending messages server-side, and the local database on the device. Account and profile survive; the user sets a new vault. |
| Messages | X3DH + Double Ratchet (AES-256-GCM). The server only holds ciphertext. `expires_at = created_at + 24h`; reads filter on it and cron deletes rows and R2 objects. |
| Attachments | Random per-file key, encrypted in the browser, ciphertext in R2, key travels inside the E2EE message. Any file type: photos, PDFs and documents up to 90 MB (Workers free plan body limit), videos up to 16 MB. Voice messages are recorded on-device. Polls and votes travel as ratcheted messages too. |
| Finding people | Exact `@username` only. No directory, no fuzzy search. Contacts are private per user. |
| Extras | Replies, delivery/read ticks, typing, delete for me / for everyone, block, safety numbers, light/dark themes. |

## Workspace

```text
apps/web          React 19 + Vite + Tailwind v4 client
workers/api       Hono Worker, Durable Object, cron
packages/crypto   Argon2id KDFs, X3DH, Double Ratchet, file crypto
packages/protocol Message envelope types
packages/types    Shared DTOs
packages/config   Shared constants (30 s window, 24 h TTL, limits)
db/migrations     D1 schema
scripts/e2e.ts    Acceptance test against a live local Worker
```

## Local development

Requires Node.js 20+.

```bash
npm install
npm run db:migrate:local
npm run dev:api          # Worker on http://127.0.0.1:8787
npm run dev              # web on http://localhost:5173 (proxies /api)
```

Open http://localhost:5173. Use two different browsers (or profiles) to chat with yourself.

Copy `workers/api/.dev.vars.example` to `workers/api/.dev.vars` first if it isn't there.

### Tests

```bash
npm run typecheck
npm test                          # crypto unit tests
npx wrangler dev --test-scheduled # in workers/api, then:
npm run test:e2e                  # 23 checks, ~2 min (it waits out real 30 s windows)
```

If `test:e2e` reports a 429 on sign-up, clear the local counters:
`npx wrangler d1 execute lop-db --local --command "DELETE FROM rate_limits"` (run in `workers/api`).

## Deploy to Cloudflare (free plan)

1. Create a free Cloudflare account and log in:
   ```bash
   npx wrangler login
   ```
2. Create the database and put the printed `database_id` into `workers/api/wrangler.toml`:
   ```bash
   npx wrangler d1 create lop-db
   ```
3. Create the attachment bucket. R2 asks for a payment method to enable, but the free allowance (10 GB, no egress fees) is plenty and is not charged within it:
   ```bash
   npx wrangler r2 bucket create lop-attachments
   ```
4. Apply the schema to the remote database:
   ```bash
   npm run db:migrate:remote
   ```
5. Set the session secret (any long random string):
   ```bash
   cd workers/api
   npx wrangler secret put SESSION_SECRET
   ```
6. Build and deploy (the Worker serves the app and the API from one origin):
   ```bash
   npm run deploy
   ```

Optional bot protection with Turnstile: create a widget in the Cloudflare dashboard, run `npx wrangler secret put TURNSTILE_SECRET` in `workers/api`, and set `VITE_TURNSTILE_SITE_KEY` when building.

### Free-plan limits to know

- Workers: 100,000 requests/day. The Worker's CPU limit is 10 ms, which is why all password and passcode stretching happens in the browser.
- D1: 100,000 row writes/day, 5 GB.
- Durable Objects: SQLite-backed classes only (already configured).
- Cron runs every minute and enforces the unlock timeout and the 24 h expiry.

## Known trade-offs

- **Lockout by password.** Anyone with only your password can trigger a wipe by signing in and not answering the passcode. This follows directly from the "fail or time out means wipe" rule.
- **One active device per account.** Unlocking in a new browser takes over the keys and locks out the old one.
- **Password strength is enforced client-side** (12+ characters), because the server never sees the password.
- No password/passcode change or account deletion yet.
- Peers keep their own copies of messages until the 24 h expiry when you wipe.

Product rules live in `.agents/PRODUCT.md`; the original design notes are in `docs/`. Where this README differs (client-side KDF, vault token, post-wipe re-setup, single-origin hosting), this README is current.
