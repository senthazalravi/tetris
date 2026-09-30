# Implementation notes from open-source messengers

Patterns used while building Lop (study only; Lop keeps its own Cloudflare + Signal-style stack).

## Sources reviewed

| Project | Link | Useful ideas |
|---|---|---|
| Vanish / Disappear-Chat | https://github.com/Nithin1614/Disappear-Chat | AES-GCM client encrypt, realtime inserts, typing dots, burn-after-read UX, idle access lock, multi-tab protection |
| Mernchat | https://github.com/RishiBakshii/mern-chat-app | Socket typing events, context menu (reply/edit/unsend/copy/pin), reply focus |
| SENTRY Messenger | https://github.com/SENTRY-Security/Messenger | Cloudflare Workers/DO/D1/R2, X3DH+Double Ratchet, ephemeral session, leave-screen wipe |
| Matrix JS / crypto WASM | matrix-org repos | Browser crypto storage, WASM crypto packaging |
| WhatsApp / Signal docs | FAQ / support | 24h disappearing messages, honest limits (screenshots) |

GhostChat (`TempleEU/ghost.app`) was not reachable at clone time.

## Applied in Lop

- Soft vault re-lock after idle / hidden tab
- Multi-tab lock broadcast
- Typing start/stop over gateway push
- Delivery/read ticks + message info
- Context menu: reply, copy, edit, forward, delete
- Chat list refresh when peer receives a message
- 24h server TTL (mandatory), countdown only in message info
- Messaging-only shell (no calls): chat rail, list, bubbles, composer
- Polished dark chat layout with Inter + Lucide icons

## Not copied wholesale

AGPL projects (SENTRY, libsignal) stay reference-only. Lop uses its own MIT/Apache-friendly crypto facade and product rules (accounts + email login + wipe-on-failed unlock).
