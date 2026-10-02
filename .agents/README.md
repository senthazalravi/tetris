# Tetris agent workspace

These files are instructions for coding agents working in this repository.

## Read order

1. `PRODUCT.md` — locked product decisions
2. `CRYPTO.md` — E2EE approach
3. `ARCHITECTURE.md` — system map
4. Task-specific: `AUTH.md`, `CONTACTS.md`, `MESSAGING.md`, `WIPE.md`, `STACK.md`
5. `IMPLEMENTATION.md` — build order

## Canonical specs

| Doc | Path |
|---|---|
| BRD | `Tetris_01_BRD.md` |
| HLD | `docs/Tetris_02_HLD.md` |
| LLD | `docs/Tetris_03_LLD.md` |
| Older combined PRD (historical) | `Tetris_PRD_HLD_LLD.md` |

If historical PRD conflicts with HLD/LLD 1.0 or these agent files, prefer **HLD/LLD 1.0 + `.agents/PRODUCT.md`**.

## Default agent behavior

- This is a **real product**, not a demo, prototype showcase, or sales sandbox — use real persistence and real encryption paths.
- Free Cloudflare stack only.
- Encrypt before any content leaves the browser.
- People and groups are found by search (substring of a username or group name); contact lists are per-user and private.
- Correct vault passcode keeps data; wrong/timeout wipes communication state only.
