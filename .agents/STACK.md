# Free stack

Real product infrastructure on free tiers — not a mocked demo backend.

## Stack

| Piece | Tech |
|---|---|
| UI | React, TypeScript, Vite, Tailwind |
| API | Cloudflare Workers |
| Realtime | Durable Objects + WebSocket |
| DB | D1 |
| Files | R2 |
| Abuse | Cloudflare Turnstile (free) |
| Crypto | Web Crypto + vetted WASM/TS libs |

## MVP constraints

- Email/password auth only (no Google, no paid SMS).
- Stay within Cloudflare free quotas: attachment size caps, rate limits, 24h expiry that keeps storage small.
- Local/dev uses Wrangler against real Workers/D1/R2 emulation — same code paths as production.
