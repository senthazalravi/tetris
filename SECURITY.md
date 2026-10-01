# Security Policy

## Reporting a vulnerability

If you believe you have found a security issue in Lop, please report it privately.

- Prefer email or a private channel via [manasdutta.com](https://www.manasdutta.com/)
- Or open a **private** security advisory on the GitHub repository if available

Please include:

- A short description of the issue and impact
- Steps to reproduce (or a proof of concept)
- Affected component if known (`apps/web`, `workers/api`, `packages/crypto`, …)

Please **do not** post exploit details in public issues, discussions, or pull requests until we have had a reasonable chance to investigate and fix.

We will acknowledge valid reports and aim to respond as soon as practical.

## What Lop is designed to protect

Lop is built so that **message and file content** is end-to-end encrypted:

- Plaintext is encrypted in the sender’s browser before upload or realtime send
- Recipients decrypt only in their browser
- There is no server-side “demo” path that stores or relays message plaintext

Crypto is centered on:

- **X3DH** for async session setup
- **Double Ratchet** with **AES-256-GCM** for ongoing messages
- **Per-file content keys** for attachments (key travels inside the E2EE envelope)

Account password and vault passcode are **separate**:

| Secret | Role |
| --- | --- |
| Account password | Authentication only (client-stretched proof; server stores a hash) |
| Vault passcode | Never uploaded; unlocks sealed local data and device keys |
| Message / attachment keys | Derived or wrapped for E2EE; not recoverable from the account password |

The unlock gate (30 seconds, one attempt) and wipe-on-failure are intentional product security controls, not bugs.

## What Lop does not claim

- **Not metadata-private.** A relay can still see routing metadata (for example who messaged whom, when, and approximate sizes).
- **Not immune to a compromised browser.** Malicious extensions, XSS in the delivered app, or a malicious device can undermine any web E2EE client.
- **Not a guarantee against peer retention.** Recipients may keep decrypted copies until expiry or local cleanup.
- **Vault passcode is not recoverable.** Forgot-password recovers the *account password* only, and only after proving ownership (vault passcode when active, or email + username after a wipe).

## Secrets and deployment hygiene

- Never commit `.dev.vars`, `.env`, API keys, or `SESSION_SECRET`
- Treat production secrets as Wrangler/dashboard secrets only
- Do not paste live production URLs, account credentials, or vault passcodes into public issues or commits

## Supported versions

Security fixes are applied on the default branch of this repository. Please reproduce against the latest `main` when reporting.
