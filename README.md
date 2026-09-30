# Lop

Web-only end-to-end encrypted messenger. Messages expire after 24 hours. Free Cloudflare stack.

## Requirements

- Node.js 20+
- npm 10+
- Cloudflare account (free) for deploy; local Wrangler for development

## Workspace

```text
apps/web          React client
workers/api       Cloudflare Worker API + realtime
packages/crypto   E2EE facade
packages/protocol Wire types
packages/types    Shared types
packages/config   Shared constants
db/migrations     D1 SQL migrations
```

## Local development

```bash
npm install
npm run db:migrate:local
npm run dev:api
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:8787

## Product rules

See `.agents/PRODUCT.md` and `docs/`.
