# Product decisions (locked)

Agents treat these as fixed unless the human explicitly changes them.

## Nature of the build

- Lop is a **real product** with real accounts, real messages, and real encrypted storage.
- Do **not** build demo mode, fake users, mock chat data for sales, or “try the product without an account” paths.
- Free hosting/tiers are fine; the app itself must be production-grade behavior, not a throwaway prototype.

## Identity and auth

- Web only.
- **Create account:** email + password + unique `@username` + display name + vault passcode.
- **Login:** email **or** username + password, then vault passcode gate.
- No Google sign-in.
- No phone number / SMS OTP in MVP.

## Contacts

- Find people by **exact user ID / username** (`@alice`).
- No match → not found. No fuzzy search, no “everyone on Lop” list.
- **Contact list shows only people this user saved or chats with.**
- Flow: New chat → enter `@userid` → match → Add contact / Message.

## Messaging

- 1:1 text, emoji, replies, links, images, video, PDF, files.
- UI should feel like WhatsApp Web.
- Delivery/read ticks and typing in MVP.

## Security

- Full **E2EE** for message and attachment content.
- Every message **expires 24 hours** after server `created_at`.
- After login: **30 seconds**, **one** vault passcode attempt.
  - **Correct in time:** unlock; keep contacts and messages.
  - **Wrong or timeout:** wipe communication state; account remains; empty UI.
- Vault passcode ≠ account password.

## Cost

- Run on **free** tiers (Cloudflare Workers/D1/R2/DO, Turnstile).
- No paid third-party APIs in MVP.

## Later

- Groups, voice notes, multi-device, calls — not MVP.
