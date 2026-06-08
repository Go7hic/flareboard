# Development

## Prerequisites

- Node.js 20+
- pnpm 9+

```bash
pnpm install
pnpm db:migrate
pnpm seed:demo     # admin (admin/flareboard) + 2 demo sites + 30 days of analytics
```

Admin only (no sample traffic):

```bash
pnpm seed          # default local admin — override with --username / --password
```

## Run locally

```bash
pnpm dev:api         # http://localhost:8788
pnpm dev:ingest      # http://localhost:8787
pnpm dev:dashboard   # http://localhost:5173
pnpm dev:aggregator  # queue consumer
```

Dashboard `.env`:

```bash
VITE_API_URL=http://localhost:8788
VITE_INGEST_URL=http://localhost:8787
```

Local API and ingest use `APP_SECRET` from `apps/api/.dev.vars` and `apps/ingest/.dev.vars` (copy from `.dev.vars.example`; never commit).

## Demo data (local dashboard testing)

`pnpm seed:demo` fills **local D1** with realistic analytics so you can exercise the dashboard without live ingest:

| Created | Details |
|---------|---------|
| Admin | `admin` / `flareboard` |
| Websites | **Demo Store** (`demo-store.example.com`), **Demo Docs** (`docs.example.com`) |
| Analytics | ~30 days of sessions, pageviews, referrers, countries, browsers, custom events |
| Extras | Heatmap clicks, cohorts, segments, goals, sample revenue, performance events |
| Rollups | Runs `backfill:rollups` automatically |

Options:

```bash
pnpm seed:demo                  # replace demo data (default)
pnpm seed:demo -- --days 14     # shorter history window
pnpm seed:demo -- --skip-admin  # keep existing admin password
pnpm seed:demo -- --no-fresh    # skip if demo sites already exist
```

**Idempotency:** `--fresh` (default) deletes only the two fixed demo website IDs and their related rows, then recreates them. Your other websites and users are untouched.

**Session replay:** demo seed writes replay **metadata** in D1 (list view works). Playback still needs rrweb chunks in local R2 (`wrangler r2 object put` or live ingest) — see smoke test below.

Optional rollup backfill after manual imports:

```bash
pnpm backfill:rollups
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm typecheck` | Typecheck all packages |
| `pnpm db:migrate` | Apply migrations to local D1 |
| `pnpm db:migrate:remote` | Apply migrations to remote D1 |
| `pnpm seed:demo` | Local admin + demo websites + 30 days analytics |
| `pnpm seed:remote` | Create first production admin (password required) |
| `pnpm backfill:rollups` | Backfill rollup tables (`-- --remote` for production) |
| `pnpm validate:wrangler` | Check wrangler configs before deploy |
| `pnpm deploy:*` | Deploy individual workers |

## Project layout

```
apps/
  api/          REST API (Hono)
  dashboard/    React dashboard (Vite)
  ingest/       Tracking + replay ingest
packages/
  db/           Drizzle schema + SQL migrations
  shared/       JWT, passwords, Zod schemas, queue types
workers/
  aggregator/   Queue consumer → D1 + rollups
```

Route handlers: `apps/api/src/routes/`. Ingest: `apps/ingest/src/routes/`.

## UI conventions

Dashboard design tokens and patterns: [AGENTS.md](../AGENTS.md) and [apps/dashboard/DESIGN-NOTE.md](../apps/dashboard/DESIGN-NOTE.md).

## Smoke tests

1. Start api, ingest, aggregator, dashboard.
2. Load a page with the tracking script — check realtime when KV has recent sessions.
3. Create a segment; confirm filtered stats on the website page.
4. Open `/reports` — funnel, performance (after `type: "performance"` events).
5. Replay: load `script.js` then `recorder.js` + `rrweb`; POST chunks; play at `/websites/:id/replays`.
6. Bot traffic: `curl -A Googlebot` to `/api/send` should return `{ "beep": "boop" }` without enqueueing.
7. SSO: mint token with `createSsoToken`, `POST /api/auth/sso` — see [sso.md](sso.md).
8. Health: `GET /api/heartbeat` on api and ingest.

Example replay chunk:

```bash
curl -X POST http://localhost:8787/api/record \
  -H 'Content-Type: application/json' \
  -d '{"type":"record","payload":{"website":"<uuid>","sessionId":"s1","visitId":"v1","chunkIndex":0,"events":[{"type":4}],"startedAt":'$(date +%s000)',"endedAt":'$(date +%s000)'}}'
```

## Tests

Automated tests use [Vitest](https://vitest.dev/) with [`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/) for the API worker (Miniflare + local D1/KV bindings from `apps/api/wrangler.jsonc`). Shared package helpers use plain Vitest (no Workers runtime).

```bash
pnpm test              # all packages that define a test script
pnpm test:api          # API worker only (runs wrangler types via pretest)
pnpm --filter @flareboard/shared test
```

Watch mode:

```bash
pnpm --filter @flareboard/api test:watch
```

**Covered today:** `GET /api/heartbeat`, auth `401` on protected routes, `report-range` / `segment-filters` SQL builders, and shared JWT/password/billing/crypto helpers.

**Future work:** ingest bot filtering (`/api/send`), D1-backed route tests with seeded fixtures, billing webhooks, queue consumers.

## Build verification

```bash
pnpm typecheck
pnpm test
pnpm --filter @flareboard/dashboard build
```
