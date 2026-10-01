# Auth and vault passcode

## Register

Accounts are **predefined**: there is no public registration. An admin runs `npm run users:seed` with a gitignored `users.local.json`. The text below describes the fields each seeded user has.

Fields:

- username / user ID (unique, `[a-z0-9_]{3,32}`)
- email: collected for notifications only; never used to sign in or recover.
- email (used only to confirm identity when resetting an expired passcode)
- passcode: exactly 8 digits. Client-side only (Argon2id -> vault key + verifier); the server stores a hash of the verifier.

There is no account password, no display-name field at signup (display name defaults to the username) and no forgot-password flow.

After register: generate device keys in browser, upload **public** bundle, land in empty chat UI.

## Login

1. `POST /auth/start` with email **or** username + password.  
2. Server creates session cookie + `unlock_challenges` (30s, `attempt_used=0`).  
3. Client shows passcode UI; chat vault stays locked.

## Unlock

- Exactly **one** attempt.
- Server clock owns expiry (closing the tab without success → timeout wipe).
- **SUCCESS** within window → unlock local vault; **no** communication wipe.
- **FAILURE** or **TIMEOUT** → communication wipe; account session may remain; UI empty.

## APIs

See LLD §4–§5: `/auth/register`, `/auth/start`, `/auth/unlock`, `/account/communication-wipe`.

## Agent checklist when touching auth

- [ ] No Google/OAuth code paths in MVP
- [ ] No SMS providers
- [ ] Passcode not logged, not stored plaintext
- [ ] Secure cookies: HttpOnly, Secure, SameSite
- [ ] Rate limit login and unlock
- [ ] Turnstile on register/login when wired

## Expired passcode
A wrong or late unlock wipes chats and leaves the vault unset. `POST /auth/reset` with username + email on file + a new 8-digit passcode is the only way back, valid only while expired.

## Home screen and search
After unlock the user lands on Tetris. The search bar (`GET /users/search?q=`) unlocks when a round ends; picking a result opens the E2EE chat. There is no conversation list or unread UI.
