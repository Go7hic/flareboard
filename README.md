# Flareboard

**Version:** 1.2.0

Privacy-first web analytics on Cloudflare Workers — pageviews, events, sessions, reports, heatmaps, session replay, teams, and share links. Self-hosted on D1, KV, R2, and Queues.

## Features

- Website stats with segments, period comparisons, and CSV export
- Realtime visitors (last 5 minutes)
- Reports: funnel, retention, cohorts, attribution, web vitals, UTM, revenue, and goals
- Click and scroll heatmaps with page preview overlay
- Session replay (rrweb → R2)
- CSV import for historical pageviews and events
- Scheduled email digests (PV, UV, bounce, top pages/referrers)
- Tracker: SPA route changes, declarative `data-*` events (Umami-compatible)
- Custom boards and public share links; short links and pixels
- Teams and admin console; optional Google/GitHub login

## Stack

| Component | Dev port | Role |
|-----------|----------|------|
| `apps/ingest` | 8787 | Tracking (`/api/send`, `/script.js`, replay ingest) |
| `apps/api` | 8788 | Authenticated REST API |
| `workers/aggregator` | — | Queue consumer → D1 |
| `apps/dashboard` | 5173 | React dashboard and marketing landing |

Monorepo packages: `@flareboard/db`, `@flareboard/shared`.

## Quick start

Requires Node.js 20+ and pnpm 9+.

```bash
pnpm install
pnpm db:migrate
pnpm seed:demo     # admin + demo sites + 30 days of analytics
pnpm dev:api       # :8788
pnpm dev:ingest    # :8787
pnpm dev:dashboard # :5173
pnpm dev:aggregator
```

Admin only (no sample traffic): `pnpm seed` (`scripts/seed.ts --help` for overrides).

Create `apps/dashboard/.env`:

```bash
VITE_API_URL=http://localhost:8788
VITE_INGEST_URL=http://localhost:8787
```

Copy `.dev.vars.example` → `.dev.vars` in `apps/api` and `apps/ingest`.

Open http://localhost:5173 and sign in with `admin` / `flareboard` (from `seed:demo`).

## Deploy

Production setup (Cloudflare resources, secrets, custom domains): **[Deployment guide](docs/deployment.md)**.

Forkers: replace D1/KV IDs in each app's `wrangler.jsonc` with your own resources before deploying.

## Docs

| | |
|---|---|
| [Development](docs/development.md) | Local dev, scripts, smoke tests |
| [API reference](docs/api.md) | REST and ingest endpoints |
| [Database](packages/db/README.md) | Schema and migrations |
| [Security](SECURITY.md) | Vulnerability reporting |

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — free for personal, educational, and other noncommercial use. Commercial use requires separate permission from the copyright holders.
