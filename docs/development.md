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
| `pnpm backfill:action-tags` | Backfill action tags on historical events (`--website`, `--start`, `--end`, optional `--dry-run`) |
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

**Covered today:** API worker routes and lib helpers for auth, insights, feature flags, experiments, surveys, errors, logs, warehouse (HTTP JSON/CSV import), people identify/store/alias/PATCH, permissions, workflows, actions (query + ingest tagging + backfill), annotations, scheduled jobs, and shared JWT/password helpers.

**Known limits:** Full ETL pipelines, streaming warehouse connectors, and CRM-style person merge graphs remain out of scope for the current beta.

## Build verification

```bash
pnpm typecheck
pnpm test
pnpm --filter @flareboard/dashboard build
```

## Planned work

Scoped features **not yet implemented**. Align here before opening implementation PRs.

| Item | Status | Decision date |
|------|--------|---------------|
| [Site-wide timezone (Umami-style)](#site-wide-timezone-umami-style) | Shipped | 2026-07-09 |

### Site-wide timezone (Umami-style)

#### Decision

Adopt **one timezone per website** for analytics display and calendar date ranges — the same model [Umami](https://umami.is) uses. All team members viewing a site see **identical numbers, buckets, and axis labels**, regardless of browser locale.

**Do not** bucket or label charts per dashboard viewer timezone. That creates conflicting totals across teammates and adds rollup/query cost for little product gain.

#### Reference behavior (Umami)

- Events are stored as UTC timestamps.
- Each website has a configured IANA timezone (e.g. `Asia/Shanghai`).
- Stats API queries pass `timezone` (or read it from the website record).
- Presets like **Today**, **Last 7 days**, and chart axes use that **single site timezone**, not the viewer's `Intl` default.

#### Current state

| Layer | Behavior |
|-------|----------|
| **Ingest / storage** | `website_event.created_at` and session timestamps are UTC ms. |
| **Rollups** | Hour and day buckets remain **UTC-aligned**. Site-local calendar presets may miss the daily-rollup fast path and fall back to raw queries (correct totals). |
| **Calendar presets (7d / 30d / 90d)** | `siteCalendarDaysRange()` in `@flareboard/shared/timezone` — site-local midnights → UTC ms. |
| **Rolling 24h** | Absolute `now - 24h` → `now` (`rolling24hRange`). |
| **Chart labels** | Site timezone via `formatChartTimeLabel(..., website.timezone)`. |
| **Site timezone setting** | `website.timezone` (IANA), editable under Website settings. Mirrored to `website_email_report.timezone` for digests. |

Account-level dashboard overview stays UTC (no single site timezone).

#### Target state

| Layer | Target |
|-------|--------|
| **Schema** | `website.timezone` — IANA string, default `UTC`. |
| **Settings UI** | Timezone picker on **Website settings** (general section, not buried under email-only). Show selected tz in overview date picker subtitle when helpful. |
| **Calendar presets** | `Today`, `7d`, `30d`, `90d`, and custom day ranges resolve **start/end of day in `website.timezone`**, then convert to UTC instants for API `startAt` / `endAt`. |
| **Rolling 24h** | Keep absolute 24h window; format axis labels in **site timezone**. |
| **Chart labels** | `formatChartTimeLabel(x, hourly, timezone)` uses site tz, not `undefined` (browser). |
| **API** | Stats routes accept optional `timezone` query param; default to the website's stored timezone. `parseStatsRange` callers use tz-aware boundaries when presets are server-side (or dashboard sends already-converted ms — pick one path and document it). |
| **Email reports** | On save, default `website_email_report.timezone` from `website.timezone` if unset; long term, consider a single source of truth. |
| **Team consistency** | Two users in different countries viewing the same site see the same chart and the same "today" totals. |

**Out of scope (v1):**

- Per-viewer / per-browser timezone overrides.
- Rebuilding rollup tables per timezone (keep UTC buckets; convert at query/display boundary).
- Account-level timezone that overrides all websites.

#### Implementation plan

**Phase 1 — Data model and settings**

1. Migration: `ALTER TABLE website ADD COLUMN timezone text NOT NULL DEFAULT 'UTC'`.
2. Drizzle schema + `PATCH /api/websites/:id` validation (`z.string().max(64)` IANA).
3. Website settings UI: timezone `<select>` or combobox (reuse email-report tz list if one exists).
4. Seed/demo: set demo sites to a non-UTC tz for manual QA.

**Phase 2 — Shared timezone helpers**

Add to `packages/shared` (new `timezone.ts` or extend `date-range.ts`):

```ts
// Illustrative — implement with Intl / temporal polyfill as needed
siteStartOfDay(ms: number, timezone: string): number
siteEndOfDay(ms: number, timezone: string): number
siteCalendarDaysRange(dayCount: number, timezone: string, now?: number)
formatHourBucketLabel(utcBucket: string, timezone: string): string
```

Unit tests: `Asia/Shanghai`, `America/New_York`, `UTC`, DST spring/fall edge days.

**Phase 3 — Dashboard date ranges**

- `apps/dashboard/src/lib/dateRange.ts`: replace `utcCalendarDaysRange` with site-tz variant; thread `website.timezone` from website context / `useWebsiteRange`.
- `DateRangePicker`, share links, cohort dialogs, link analytics — all preset callers.
- Pass `timezone` on stats API requests **or** rely on server default from website record (prefer server default to avoid client drift).

**Phase 4 — API alignment**

- Load `website.timezone` in stats middleware or per-route.
- Audit routes using `parseStatsRange`: `stats`, `events`, `sessions`, `logs`, `errors`, `session-data`, compare, funnels, retention, etc.
- Hourly series: **keep UTC rollup buckets**; only change **label formatting** and **range boundaries** unless product requires tz-aligned hour bins (document as Phase 4b if needed).
- Daily rollups: `rollupDailyRangeEligible` may need a tz-aware counterpart when presets are site-local midnights.

**Phase 5 — Email report unification**

- New websites: `website.timezone` is canonical.
- Existing rows: one-time backfill `website.timezone` from `website_email_report.timezone` where website tz is still `UTC` and email tz is set.
- Settings copy: clarify that stats and reports share the site timezone.

**Phase 6 — Verification**

- [ ] Site tz `Asia/Shanghai`: at 14:00 local, "today" preset excludes yesterday 16:00–24:00 UTC incorrectly (regression guard).
- [ ] Two browsers with different `Intl` defaults show **identical** hourly chart labels for the same site.
- [ ] Compare / overview / share public pages stay aligned.
- [ ] `pnpm typecheck` + API tests for `parse-range` and new tz helpers.

#### Files (starting checklist)

| Area | Paths |
|------|-------|
| Schema | `packages/db/src/schema.ts`, new migration under `packages/db/migrations/` |
| Shared | `packages/shared/src/date-range.ts`, new tz helpers + tests |
| Dashboard | `src/lib/dateRange.ts`, `src/lib/chartTimeseries.ts`, `src/lib/compare-utils.ts`, `src/pages/WebsiteSettings.tsx`, `src/lib/useWebsiteRange.ts` |
| API | `apps/api/src/lib/parse-range.ts`, `apps/api/src/routes/stats.ts`, `apps/api/src/lib/rollups.ts`, `apps/api/src/lib/queries.ts` |
| Email | `apps/api/src/lib/email-reports.ts`, `apps/api/src/routes/email-reports.ts` |
| Docs | `docs/api.md` (document `timezone` query param); remove this section when shipped |

#### Risks and notes

- **Hour buckets vs day buckets:** UTC hour rollups under a site-tz "today" window can split the first/last hour awkwardly. Umami accepts this; label clearly (include date on hourly axis). Re-bucketing at query time is heavier — defer unless user feedback demands it.
- **DST:** Use IANA zones only; test `America/New_York` on transition Sundays.
- **Public share links:** Shared URLs must encode `startAt`/`endAt` as UTC ms (unchanged); recipients still see labels in the **site** timezone, not their own.
- **Breaking change:** Calendar preset boundaries will shift for non-UTC sites once shipped; mention in changelog.

#### Success criteria

When complete, remove the interim notes from **Current state** above and delete this section. Update `README.md` **Current stage** only if the feature is user-visible in production.
