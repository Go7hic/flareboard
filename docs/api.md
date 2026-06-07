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
| GET | `/api/reports/utm?websiteId=` | Bearer |
| GET | `/api/reports/goal?websiteId=` | Bearer |
| GET | `/api/reports/revenue?websiteId=` | Bearer |
| GET | `/api/reports/funnel?websiteId=&steps=a,b,c` | Bearer |
| GET | `/api/reports/retention?websiteId=` | Bearer |
| GET | `/api/reports/journey?websiteId=` | Bearer |
| GET | `/api/reports/attribution?websiteId=&model=first\|last` | Bearer |
| GET | `/api/reports/breakdown?websiteId=&dimension=` | Bearer |
| GET | `/api/reports/performance?websiteId=` | Bearer — LCP, INP, CLS, FCP, TTFB |

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
| GET | `/script.js` | Tracker |
| GET | `/recorder.js` | Replay recorder (requires `rrweb` on page) |
| GET | `/l/:slug`, `/p/:slug.gif` | Links & pixels |

Rate limit: **100 requests/min per IP per website** (KV); returns 429 when exceeded.

## Dashboard routes (SPA)

| Path | Page |
|------|------|
| `/` | Websites |
| `/websites/:id` | Stats, segments, realtime |
| `/websites/:id/replays` | Replay list + player |
| `/reports` | UTM, funnel, retention, … |
| `/boards` | Custom dashboards |
| `/teams`, `/links`, `/admin` | Teams, links, admin |
