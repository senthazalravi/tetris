# Product decisions (locked)

Agents treat these as fixed unless the human explicitly changes them.

## Nature of the build

- Tetris is a **real product** with real accounts, real messages, and real encrypted storage.
- Do **not** build demo mode, fake users, mock chat data for sales, or “try the product without an account” paths.
- Free hosting/tiers are fine; the app itself must be production-grade behavior, not a throwaway prototype.

## Identity and auth

- Web only.
- **Accounts are predefined** by an administrator: unique `@username`, email, 8-digit passcode. There is no sign-up screen.
- **Login:** username + passcode (one attempt, 30s), then the Tetris home screen. Finishing a round unlocks search.
- **Forgot / expired passcode:** confirm the email on file, then choose a new passcode. No reset email or link.
- The email on file is also used for unread-message notification emails.
- No Google sign-in. No phone number / SMS OTP.

## Discovery

- Search by part of a username or a group name once a round has ended (`Ctrl+K` / `Cmd+K`).
- No sidebar, chat list or unread counters.
- Groups are predefined and visible only to their members.

## Messaging

- Direct and group chats: text, emoji, replies, links, reactions, edits, polls, images, video, audio, voice notes, files.
- Group messages support `@username` mentions.
- Chat opens in a panel beside the Tetris game (35% game, 65% chat).
- Delivery/read ticks and typing (direct chats) are included.
- The installable web app can run in its own window; a chime and optional desktop notifications announce new messages.

## Security

- Full **E2EE** for message and attachment content.
- Direct messages **expire after 24 hours**; group messages and files after **7 days** (server `created_at`).
- After login: **30 seconds**, **one** passcode attempt.
  - **Correct in time:** unlock; keep contacts and messages.
  - **Wrong or timeout:** wipe communication state; account remains; the passcode expires.
- There is no account password; the passcode is the only secret.

## Cost

- Run on **free** tiers (Cloudflare Workers/D1/R2/DO, Turnstile).
- Email notifications use the free tier of the email provider and stay under its daily and monthly limits.
