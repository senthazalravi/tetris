# E2EE

## Goal

Message and file plaintext is encrypted in the sender’s browser before upload or WebSocket send. Recipients decrypt only in their browser. This is the real production path — no plaintext “demo” bypass.

## Protocol

- Signal-style 1:1: prekey bundle + X3DH (or library equivalent) + Double Ratchet + AEAD.
- Prefer a mature library over inventing a custom protocol.
- Keep crypto behind `packages/crypto` so the app and workers share one interface.

## Key separation

| Secret | Role |
|---|---|
| Passcode (8 digits) | Local KDF → vault key → unwrap device private keys / IndexedDB |
| Identity/prekeys | E2EE session establishment |
| Message keys | Ratchet-derived per message |
| Attachment content key | Random per file; wrapped inside E2EE envelope |

The passcode only derives the local vault key and the verifier; it is never used directly as a message key.

## Media

1. Generate random content key in client.  
2. Encrypt file bytes (AEAD).  
3. Upload ciphertext to R2.  
4. Send wrapped content key + object reference inside the E2EE message.  

## Storage

| Store | Content |
|---|---|
| D1 / R2 | Ciphertext and public metadata only |
| Server | Public keys / prekeys — not private keys |
| IndexedDB | Encrypted blobs; unwrap after vault unlock |
| Memory | Plaintext and vault key material while unlocked |
| Logs | No plaintext messages or secrets |

## References

SENTRY Messenger, Matrix crypto WASM, and libsignal are study references. Prefer license-compatible libraries when integrating.
