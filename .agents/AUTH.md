# Auth and vault passcode

## Register

Required fields:

- email (unique, normalized)
- password (min 12 chars) → Argon2id/scrypt **hash on server**
- username / user ID (unique, `[a-z0-9_]{3,32}`)
- display name
- vault passcode (client-side only for key wrap; never store plaintext)

After register: generate device keys in browser, upload **public** bundle, land in empty chat UI.

## Login

1. `POST /auth/login` with email **or** username + password.  
2. Server creates session cookie + `unlock_challenges` (30s, `attempt_used=0`).  
3. Client shows passcode UI; chat vault stays locked.

## Unlock

- Exactly **one** attempt.
- Server clock owns expiry (closing the tab without success → timeout wipe).
- **SUCCESS** within window → unlock local vault; **no** communication wipe.
- **FAILURE** or **TIMEOUT** → communication wipe; account session may remain; UI empty.

## APIs

See LLD §4–§5: `/auth/register`, `/auth/login`, `/auth/unlock`, `/account/communication-wipe`.

## Agent checklist when touching auth

- [ ] No Google/OAuth code paths in MVP
- [ ] No SMS providers
- [ ] Passcode not logged, not stored plaintext
- [ ] Secure cookies: HttpOnly, Secure, SameSite
- [ ] Rate limit login and unlock
- [ ] Turnstile on register/login when wired
