# Security Policy

## Reporting a vulnerability

If you believe you have found a security issue in Tetris, please report it privately.

- Prefer email or a private channel via [manasdutta.com](https://www.manasdutta.com/)
- Or open a **private** security advisory on the GitHub repository if available

Please include:

- A short description of the issue and impact
- Steps to reproduce (or a proof of concept)
- Affected component if known (`apps/web`, `workers/api`, `packages/crypto`, …)

Please **do not** post exploit details in public issues, discussions, or pull requests until we have had a reasonable chance to investigate and fix.

We will acknowledge valid reports and aim to respond as soon as practical.

## What Tetris is designed to protect

Tetris is built so that **message and file content** is end-to-end encrypted:

- Plaintext is encrypted in the sender’s browser before upload or realtime send
- Recipients decrypt only in their browser
- There is no server-side “demo” path that stores or relays message plaintext

Crypto is centered on:

- **X3DH** for async session setup
- **Double Ratchet** with **AES-256-GCM** for ongoing messages
- **Per-file content keys** for attachments (key travels inside the E2EE envelope)

The 8-digit passcode is the only user secret (there is no account password; the email on file is used only to reset an expired passcode and to send unread-message notifications):

| Secret | Role |
| --- | --- |
| Passcode | Never uploaded; the server stores a hash of a derived verifier. Unlocks sealed local data and device keys |
| Message / attachment keys | Derived or wrapped for E2EE; not recoverable from the server |

The unlock gate (30 seconds, one attempt) and wipe-on-failure are intentional product security controls, not bugs.

## What Tetris does not claim

- **Notification emails reveal metadata.** An unread-message email names the sender or group and how many messages are waiting. It never contains message text, and it is sent only after messages have stayed unread for a few minutes.
- **Not metadata-private.** A relay can still see routing metadata (for example who messaged whom, when, and approximate sizes).
- **Not immune to a compromised browser.** Malicious extensions, XSS in the delivered app, or a malicious device can undermine any web E2EE client.
- **Not a guarantee against peer retention.** Recipients may keep decrypted copies until expiry or local cleanup.
- **The passcode is not recoverable.** After a wrong or late unlock the passcode expires; resetting it requires the username plus the email on file, so anyone who knows both can claim an expired account. Chats are already wiped by then, the reset is rate-limited, and contacts see a changed safety number.
- **Small passcode space.** 8 digits is 10^8 possibilities. Protection comes from Argon2id stretching, the one-attempt rule, and rate limits, not from entropy.
- **Wipes are tied to the account's own browser.** Failing or abandoning an unlock only wipes when the request carries the trusted-device cookie set at the last successful unlock; other browsers get a rate-limited failure so a stranger who knows a username cannot destroy chats.
- **The Tetris screen is not a security control.** The vault is already unlocked in memory while the game runs.

## Secrets and deployment hygiene

- Never commit `.dev.vars`, `.env`, API keys, or `SESSION_SECRET`
- Treat production secrets (including the email API key) as secrets of the API only, never as code or config in the repository
- Do not paste live production URLs, account credentials, or vault passcodes into public issues or commits

## Supported versions

Security fixes are applied on the default branch of this repository. Please reproduce against the latest `main` when reporting.
