# Flareboard

Cloudflare-native product analytics for teams that want a PostHog-like operating surface without running ClickHouse or Kubernetes. Flareboard combines website analytics, session replay, feature flags, experiments, surveys, error tracking, logs, workflows, and a D1-backed warehouse on Workers, D1, R2, KV, Queues, and Durable Objects.

## Product surface

- Product analytics: pageviews, events, sessions, realtime, segments, cohorts, funnels, retention, journeys, attribution, revenue, web vitals, and saved insights.
- Session UX: rrweb replay stored in R2, saved replays, heatmaps, session context, and public share links.
- Experimentation: feature flags with targeting and evaluation, flag-linked experiments, exposure events, and winner application.
- Feedback and automation: surveys, feedback inbox, annotations, actions, event-triggered workflows, and custom boards.
- Quality and observability: error issues, source map metadata, error and log alert rules, log traces, services, AI observations, and session-level context.
- Data and administration: D1 warehouse queries, saved queries, history, schedules, data source metadata, teams, website permissions, audit logs, admin console, and optional Google/GitHub login.

## Current stage

The repository is in a PostHog-like beta stage. Core product domains ship with routes, schema, dashboard pages, cron-driven alert and warehouse loops, workflow delivery, source map resolution, permission-aware UI, person storage with identify and alias ingest, dashboard PATCH for people properties, ingest-time action tagging with optional historical backfill, warehouse HTTP JSON and CSV import, ingest documentation, Phase 3 dashboard UX polish, and broad route tests. Remaining scope is full ETL pipelines, streaming warehouse connectors, and CRM-style person merge tooling.

## Stack

| Component | Dev port | Role |
|-----------|----------|------|
| `apps/ingest` | 8787 | Tracking (`/api/send`, `/script.js`, replay ingest) |
| `apps/api` | 8788 | Authenticated REST API |
| `workers/aggregator` | — | Queue consumer → D1 |
| `apps/dashboard` | 5173 | React dashboard |

**Cloudflare bindings:** D1 (analytics + warehouse), R2 (session replay), KV (realtime counters + API cache), Queues with aggregator (spike buffering and rollups), Durable Objects (edge rate limiting on API and ingest).

Monorepo packages: `@flareboard/db`, `@flareboard/shared`, `@flareboard/rate-limiter` (Durable Object).

## Quick start

Requires Node.js 20+ and pnpm 9+.

```bash
pnpm install
pnpm db:migrate
pnpm seed
pnpm dev:api       # :8788
pnpm dev:ingest    # :8787
pnpm dev:dashboard # :5173
pnpm dev:aggregator
```

Create `apps/dashboard/.env`:

```bash
VITE_API_URL=http://localhost:8788
VITE_INGEST_URL=http://localhost:8787
```

Copy `.dev.vars.example` → `.dev.vars` in `apps/api` and `apps/ingest`.

Open http://localhost:5173 and sign in with the credentials from `pnpm seed` (`scripts/seed.ts --help` for overrides).

## Deploy

Production setup (Cloudflare resources, secrets, custom domains): **[Deployment guide](docs/deployment.md)**.

Forkers: replace D1, KV, R2, Queues, and Durable Object bindings in each app's `wrangler.jsonc` with your own resources before deploying.

## Docs

| | |
|---|---|
| [Development](docs/development.md) | Local dev, scripts, smoke tests |
| [API reference](docs/api.md) | REST and ingest endpoints |
| [Database](packages/db/README.md) | Schema and migrations |
| [Security](SECURITY.md) | Vulnerability reporting |

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — free for personal, educational, and other noncommercial use. Commercial use requires separate permission from the copyright holders.
