# Architecture (agent summary)

Full detail: `docs/Tetris_02_HLD.md`, `docs/Tetris_03_LLD.md`.

## Shape

```text
React+TS client  --HTTPS/WSS-->  Cloudflare Worker API
                                   ├─ D1 (users, contacts, ciphertext, epochs)
                                   ├─ R2 (encrypted attachments)
                                   └─ Durable Objects (WebSockets)
```

## Packages (target monorepo)

```text
tetris/
  apps/web/
  packages/crypto/     # only place protocol details live
  packages/protocol/
  packages/storage/
  packages/types/
  workers/api/
  workers/expiry/
  db/migrations/
  docs/
  .agents/
```

## Trust model

- Server = untrusted for content confidentiality.
- Server may see: account fields, routing, ciphertext, sizes, timestamps.
- Client = only place plaintext and private keys exist.

## Core services

| Service | Owns |
|---|---|
| Auth | register/start/session (username + passcode verifier) |
| Unlock | 30s challenge, one attempt |
| Contacts | exact lookup, private lists |
| Identity | devices, prekey bundles |
| Messaging | ciphertext relay, TTL |
| Attachments | R2 ciphertext I/O |
| Wipe | epoch bump + delete communication state |
| Realtime | WS fan-out |

## Epoch

`users.communication_epoch` increments on wipe. All chat writes must carry the current epoch; stale epoch → reject. Prevents wiped data from resurrecting via queues or other tabs.
