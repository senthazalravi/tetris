# Implementation order

Agents should build in this sequence unless directed otherwise.

1. **Scaffold** monorepo, web app, worker, D1 migrations, R2 bucket, CI lint/test.  
2. **Auth** register/start/session with username+passcode.  
3. **Unlock challenge** + server timer + wipe epoch endpoint + client wipe.  
4. **Exact username lookup** + private contacts CRUD.  
5. **Crypto package** identity/prekeys/session facade + device APIs.  
6. **1:1 send/receive** ciphertext path + decrypt UI.  
7. **24h TTL** cron + lazy expiry + client prune.  
8. **Attachments** encrypted upload/download.  
9. **Realtime** WS delivery, ticks, typing.  
10. **UI polish** WhatsApp Web–like shell, empty states, countdown.  
11. **Hardening** CSP, rate limits, Turnstile, e2e acceptance from LLD §14.

## Definition of done

A slice is done when it works end-to-end on real persistence (D1/R2/IndexedDB), with real E2EE where messaging is involved — not mocked demo data — and has basic tests for the happy path and critical failure path.
