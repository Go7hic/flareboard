# API reference

Base URL: `https://api.your-domain.com` (local dev: `http://localhost:8788`).

Authenticated routes use `Authorization: Bearer <JWT>` from login, OAuth, or SSO.

## Auth & user

There is **no public registration**. The first account is created with `pnpm seed:remote` (production) or `pnpm seed` (local). Additional users are created by an admin.

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/login` | — |
| POST | `/api/auth/forgot-password` | — body `{ "username" }` |
| POST | `/api/auth/reset-password` | — body `{ "token", "password" }` |
| GET | `/api/auth/oauth/:provider` | — Google/GitHub when configured |
| GET | `/api/auth/oauth/:provider/callback` | — OAuth callback |
| POST | `/api/auth/sso` | — body `{ "token": "<hmac>" }` (requires `SSO_SECRET`) |
| POST | `/api/auth/logout` | Bearer |
| GET | `/api/auth/verify` | Bearer |
| GET | `/api/me` | Bearer |
| PATCH | `/api/me/password` | Bearer |
| GET | `/api/config` | — |
| GET | `/api/dashboard` | Bearer — overview; KV-cached ~60s |

See [SSO](sso.md) for token exchange details.

## Websites & stats

| Method | Path | Auth |
|--------|------|------|
| GET/POST | `/api/websites` | Bearer |
| GET/PATCH/DELETE | `/api/websites/:websiteId` | Bearer |
| GET | `/api/websites/:websiteId/permissions` | Bearer |
| GET | `/api/websites/:websiteId/audit` | Bearer |
| GET | `/api/websites/:websiteId/stats` | Bearer — optional `segmentId` |
| GET | `/api/websites/:websiteId/stats/overview` | Bearer — fused KPIs + series; optional `segmentId`, `type` |
| GET | `/api/websites/:websiteId/stats/compare` | Bearer — optional `segmentId` |
| GET | `/api/websites/:websiteId/pageviews` | Bearer — optional `segmentId` |
| GET | `/api/websites/:websiteId/metrics?type=` | Bearer — optional `segmentId` |
| GET | `/api/websites/:websiteId/export?type=events\|pageviews` | Bearer — CSV |
| GET | `/api/websites/:websiteId/events` | Bearer |
| GET | `/api/websites/:websiteId/events/series` | Bearer |
| GET | `/api/websites/:websiteId/events/stats` | Bearer |

Common query params: `range` (`24h`, `7d`, `30d`, `90d`, `custom`), `from`/`to`, `compare`, `filters`.

## Sessions

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/websites/:websiteId/sessions` | Bearer — paginated |
| GET | `/api/websites/:websiteId/sessions/stats` | Bearer |
| GET | `/api/websites/:websiteId/sessions/weekly` | Bearer |
| GET | `/api/websites/:websiteId/sessions/:sessionId` | Bearer |
| GET | `/api/websites/:websiteId/sessions/:sessionId/activity` | Bearer |
| GET | `/api/websites/:websiteId/sessions/:sessionId/properties` | Bearer |
| GET | `/api/websites/:websiteId/sessions/:sessionId/replays` | Bearer |

## Realtime

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/realtime/:websiteId` | Bearer — active visitors (5 min window; KV only) |
| GET | `/api/links/:linkId/stats` | Bearer — link clicks, UV, daily series |

Ingest also exposes `GET /api/websites/:websiteId/active` (KV active users).

## Segments

| Method | Path | Auth |
|--------|------|------|
| GET/POST | `/api/websites/:websiteId/segments` | Bearer |
| GET/PATCH/DELETE | `/api/websites/:websiteId/segments/:segmentId` | Bearer |

Pass `segmentId` on stats/metrics/pageviews to apply segment filters (`country`, `browser`, `path`, `referrer`, etc.).

## Session replay

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/websites/:websiteId/replays` | Bearer |
| GET | `/api/websites/:websiteId/replays/:visitId` | Bearer — parallel R2 chunk load |
| GET/POST | `/api/websites/:websiteId/replays/saved` | Bearer |
| PATCH/DELETE | `/api/websites/:websiteId/replays/saved/:savedReplayId` | Bearer |
| POST | `/api/record` | — (ingest) rrweb chunks → D1 + R2 |

Load **`script.js` before `recorder.js`** on tracked pages so session IDs align between analytics and replay.

## Reports

| Method | Path | Auth |
|--------|------|------|
| GET/POST | `/api/reports` | Bearer — saved reports |
| GET/PATCH/DELETE | `/api/reports/:reportId` | Bearer |
| GET | `/api/reports/templates` | Bearer |
| GET | `/api/reports/utm?websiteId=` | Bearer |
| GET | `/api/reports/goal?websiteId=` | Bearer |
| GET | `/api/reports/revenue?websiteId=` | Bearer |
| GET | `/api/reports/funnel?websiteId=&steps=a,b,c` | Bearer |
| GET | `/api/reports/retention?websiteId=` | Bearer |
| GET | `/api/reports/stickiness?websiteId=` | Bearer |
| GET | `/api/reports/journey?websiteId=` | Bearer |
| GET | `/api/reports/attribution?websiteId=&model=first\|last` | Bearer |
| GET | `/api/reports/breakdown?websiteId=&dimension=` | Bearer |
| GET | `/api/reports/performance?websiteId=` | Bearer — LCP, INP, CLS, FCP, TTFB |
| GET | `/api/reports/cohort?websiteId=&cohortId=` | Bearer |

## Insights

Saved insights are the PostHog-style analysis layer used by the dashboard and board widgets.

| Method | Path | Auth |
|--------|------|------|
| GET/POST | `/api/insights` | Bearer |
| POST | `/api/insights/preview` | Bearer — run an unsaved trend, funnel, retention, path, stickiness, or table insight |
| GET/PATCH/DELETE | `/api/insights/:insightId` | Bearer |
| GET | `/api/insights/:insightId/run` | Bearer |

## Product analytics objects

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/websites/:websiteId/events/catalog` | Bearer |
| GET | `/api/websites/:websiteId/events/catalog/:eventName` | Bearer |
| GET | `/api/websites/:websiteId/event-data/properties` | Bearer |
| GET | `/api/websites/:websiteId/event-data/values` | Bearer |
| GET | `/api/websites/:websiteId/event-data/stats` | Bearer |
| GET | `/api/websites/:websiteId/event-data/fields` | Bearer |
| GET | `/api/websites/:websiteId/session-data/properties` | Bearer |
| GET | `/api/websites/:websiteId/session-data/values` | Bearer |
| GET | `/api/websites/:websiteId/session-data/stats` | Bearer |
| GET/POST | `/api/websites/:websiteId/actions` | Bearer |
| GET/PATCH/DELETE | `/api/websites/:websiteId/actions/:actionId` | Bearer |
| GET/POST | `/api/websites/:websiteId/annotations` | Bearer |
| PATCH/DELETE | `/api/websites/:websiteId/annotations/:annotationId` | Bearer |
| GET | `/api/websites/:websiteId/people` | Bearer |
| GET/PATCH | `/api/websites/:websiteId/people/:personId` | Bearer — PATCH merges `properties` into stored profile |
| GET | `/api/websites/:websiteId/groups/types` | Bearer |
| GET | `/api/websites/:websiteId/groups` | Bearer |
| GET | `/api/websites/:websiteId/groups/:groupType/:groupKey` | Bearer |

## Experimentation

| Method | Path | Auth |
|--------|------|------|
| GET/POST | `/api/websites/:websiteId/feature-flags` | Bearer |
| POST | `/api/websites/:websiteId/feature-flags/evaluate` | Bearer |
| GET/PATCH/DELETE | `/api/websites/:websiteId/feature-flags/:flagId` | Bearer |
| GET/POST | `/api/websites/:websiteId/experiments` | Bearer |
| GET/PATCH/DELETE | `/api/websites/:websiteId/experiments/:experimentId` | Bearer |
| GET | `/api/websites/:websiteId/experiments/:experimentId/results` | Bearer |
| POST | `/api/websites/:websiteId/experiments/:experimentId/apply` | Bearer |

## Feedback and automation

| Method | Path | Auth |
|--------|------|------|
| GET/POST | `/api/websites/:websiteId/surveys` | Bearer |
| GET | `/api/websites/:websiteId/surveys/feedback` | Bearer |
| PATCH/DELETE | `/api/websites/:websiteId/surveys/:surveyId` | Bearer |
| GET | `/api/websites/:websiteId/surveys/:surveyId/responses` | Bearer |
| GET/POST | `/api/websites/:websiteId/workflows` | Bearer |
| PATCH/DELETE | `/api/websites/:websiteId/workflows/:workflowId` | Bearer |
| GET | `/api/websites/:websiteId/workflows/:workflowId/executions` | Bearer |

Public survey responses are collected by the ingest worker at `POST /api/surveys/response`.

## Quality and observability

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/websites/:websiteId/errors` | Bearer |
| GET | `/api/websites/:websiteId/errors/:eventId` | Bearer |
| PATCH | `/api/websites/:websiteId/errors/issues` | Bearer |
| POST | `/api/websites/:websiteId/errors/issues/comments` | Bearer |
| GET/POST | `/api/websites/:websiteId/errors/source-maps` | Bearer |
| GET/POST | `/api/websites/:websiteId/errors/alerts` | Bearer |
| PATCH/DELETE | `/api/websites/:websiteId/errors/alerts/:alertRuleId` | Bearer |
| GET | `/api/websites/:websiteId/logs` | Bearer |
| GET | `/api/websites/:websiteId/logs/tail` | Bearer |
| GET | `/api/websites/:websiteId/logs/services` | Bearer |
| GET | `/api/websites/:websiteId/logs/traces` | Bearer |
| GET | `/api/websites/:websiteId/logs/traces/:traceId` | Bearer |
| GET/POST | `/api/websites/:websiteId/logs/filters` | Bearer |
| PATCH/DELETE | `/api/websites/:websiteId/logs/filters/:filterId` | Bearer |
| GET/POST | `/api/websites/:websiteId/logs/alerts` | Bearer |
| PATCH/DELETE | `/api/websites/:websiteId/logs/alerts/:alertRuleId` | Bearer |
| GET | `/api/websites/:websiteId/ai-observability` | Bearer |

Alert rule CRUD exists today. Automatic alert evaluation and email/webhook delivery are tracked production-hardening work.

## Warehouse

Warehouse endpoints run scoped D1 SQL against the current website and related analytics tables.

Query execution is capped at **1000 rows returned**, **100,000 rows scanned** (D1 `meta.rows_read`), and **10 seconds** wall-clock timeout. Successful responses include a `cost` object with `rowsRead` and `durationMs`.

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/websites/:websiteId/warehouse/schema` | Bearer |
| POST | `/api/websites/:websiteId/warehouse/query` | Bearer |
| GET | `/api/websites/:websiteId/warehouse/history` | Bearer |
| GET/POST | `/api/websites/:websiteId/warehouse/saved-queries` | Bearer |
| PATCH/DELETE | `/api/websites/:websiteId/warehouse/saved-queries/:savedQueryId` | Bearer |
| GET/POST | `/api/websites/:websiteId/warehouse/schedules` | Bearer |
| POST | `/api/websites/:websiteId/warehouse/schedules/run-due` | Bearer |
| PATCH/DELETE | `/api/websites/:websiteId/warehouse/schedules/:scheduledQueryId` | Bearer |
| GET/POST | `/api/websites/:websiteId/warehouse/data-sources` | Bearer |
| PATCH/DELETE | `/api/websites/:websiteId/warehouse/data-sources/:dataSourceId` | Bearer |

Scheduled query automation and external data source sync are tracked production-hardening work.

## Boards

| Method | Path | Auth |
|--------|------|------|
| GET/POST | `/api/boards` | Bearer |
| GET/PATCH/DELETE | `/api/boards/:boardId` | Bearer |
| POST | `/api/boards/:boardId/share` | Bearer |

## Admin

| Method | Path | Auth |
|--------|------|------|
| GET/POST | `/api/admin/users` | admin |
| GET/POST | `/api/admin/teams` | admin |
| GET/POST | `/api/admin/websites` | admin |
| GET | `/api/admin/audit` | admin |
| GET | `/api/admin/export?type=users\|websites\|events` | admin — CSV |

## Teams, share links, pixels, revenue

Team CRUD, share links, short links, pixels, and revenue endpoints follow the same `/api/...` prefix and Bearer auth. Inspect `apps/api/src/routes/` for the full route list and request bodies.

## Ingest (public)

Served from the ingest worker (e.g. `https://t.your-domain.com`).

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/send`, `/api/batch` | Event collection; batch returns `processed`, `errors`, `cache` |
| POST | `/api/record` | Session replay chunks |
| GET | `/api/heartbeat` | Health |
| GET | `/api/websites/:websiteId/active` | KV active users |
| GET | `/api/tracker-config` | Feature flag and survey config for the tracker |
| POST | `/api/surveys/response` | Survey response collection |
| GET | `/script.js` | Tracker |
| GET | `/recorder.js` | Replay recorder (requires `rrweb` on page) |
| GET | `/l/:slug`, `/p/:slug.gif` | Links & pixels |

Rate limit: **100 requests/min per IP per website** (KV); returns 429 when exceeded.

See [Ingest reference](./ingest.md) for payload fields, identify/group semantics, and tracker-config details.

## Capability boundaries

Flareboard targets a PostHog-like surface on Cloudflare D1, R2, KV, and Workers. The following limits are intentional for the current beta:

| Area | Supported today | Not yet supported |
|------|-----------------|-------------------|
| Actions | Ingest-time tagging via `$flareboard_action_ids` / `$flareboard_action_names`; query-time SQL summaries; one-shot backfill via `POST /api/internal/backfill-action-tags` or `pnpm backfill:action-tags` | Streaming action re-evaluation on rule edits |
| People / groups | Dedicated `person` store, identify/group ingest upserts, `$alias` linking, PATCH person properties (dashboard + API), read APIs enriched with stored profiles | Full CRM-style merge graph and dedupe UI |
| Warehouse | D1 SQL, saved queries, schedules, query history, HTTP JSON and HTTP CSV import into `warehouse_import` | Full ETL pipelines and streaming connectors |
| Warehouse data sources | Scheduled HTTP JSON/CSV import with idempotent upsert by `primaryKey` | Schema inference and multi-table sync |
| Errors | Issue workflow, alerts, source map upload, stack resolution on detail | Automatic issue assignment rules |
| Experiments | Flag-linked A/B with apply-winner | Multivariate design tooling |
| Workflows | Webhook and email actions from ingest triggers | Delayed or branching workflow graphs |

## Dashboard routes (SPA)

| Path | Page |
|------|------|
| `/` | Websites |
| `/websites/:id` | Website overview, events, actions, sessions, realtime, performance, compare |
| `/websites/:id/replays` | Replay list + player |
| `/websites/:id/feature-flags`, `/websites/:id/experiments` | Experimentation |
| `/websites/:id/surveys`, `/websites/:id/workflows` | Feedback and automation |
| `/websites/:id/errors`, `/websites/:id/logs`, `/websites/:id/ai-observability` | Quality and observability |
| `/websites/:id/people`, `/websites/:id/groups` | Audience views |
| `/websites/:id/warehouse` | D1 warehouse query workbench |
| `/reports` | UTM, funnel, retention, … |
| `/insights` | Saved trend, funnel, retention, path, stickiness, and table insights |
| `/boards` | Custom dashboards |
| `/teams`, `/links`, `/admin` | Teams, links, admin |
