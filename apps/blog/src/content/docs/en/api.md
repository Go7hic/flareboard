---
title: REST API
description: Read your Flareboard analytics and manage feature flags from your own code with a personal API key. Base URL, authentication, endpoints, pagination, errors and limits.
---

The Flareboard REST API is the same API the console uses. With a personal API key you can list your websites, read stats, events, sessions and people, run SQL, export CSV and change feature flags from scripts, dashboards and other tools. To send events into Flareboard, use the ingest endpoint instead (see [Ingest API](/docs/reference/ingest-api)). To query from an AI tool, use the [MCP server](/docs/mcp).

## Base URL

| Where | Base URL |
| --- | --- |
| Flareboard Cloud | `https://api.flareboard.dev` |
| Self-hosted | Your own API address, for example `https://api.example.com` |

All paths on this page start with `/api` and are relative to the base URL. Requests and responses are JSON, except CSV exports. Examples use the Cloud address.

## Authentication

Authenticate with a personal API key in a bearer header:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://api.flareboard.dev/api/websites
```

### Create a key

1. Sign in to the console at [flareboard.dev](https://flareboard.dev).
2. Open the account menu (your name at the bottom of the sidebar), then **API keys**.
3. Click **Create API key**, enter a **Name** and choose **Scopes**.
4. Copy the key, which starts with `fb_sk_`, and click **Done**. It is shown once.

Click **Revoke** next to a key to stop it right away. You can have at most 50 keys. Keys of an account you delete stop working.

### Scopes

The scope a request needs depends on its HTTP method:

| Scope | Allowed requests |
| --- | --- |
| **Read** | `GET` and `HEAD` |
| **Write** | Every other method: `POST`, `PATCH`, `PUT` and `DELETE` |

**Write** does not include **Read**. A key that should do both needs both scopes. Note that some read-only operations are `POST` requests, for example running SQL and evaluating a feature flag, so they need **Write**.

A key acts as you, with your own access. It sees the websites you can see. If your account has view-only access, every non-`GET` request is refused with `Read-only access`, whatever the key's scopes.

A key cannot manage credentials or the account. Requests to `/api/me/api-keys`, `/api/me/password`, `/api/me/delete`, `/api/me/2fa`, `/api/me/sessions` and `/api/me/identities` answer 403. Do those in the console.

### Project keys are for ingest only

A project key (`fb_pk_...`) identifies one website to the ingest service. It is public and may sit in your page source. The REST API does not accept it. Use a personal key (`fb_sk_...`) here, and keep it secret.

### Check a key

`GET /api/me` returns the account the key acts as:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://api.flareboard.dev/api/me
```

The response includes `id`, `username`, `role` and `displayName`.

## Time ranges

Stats endpoints take the period as UTC timestamps in milliseconds since the epoch:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `startAt` | number | 24 hours before `endAt` (30 days for sessions, people and export) | Start of the period. |
| `endAt` | number | now | End of the period. |
| `unit` | `year`, `month`, `day` or `hour` | `day` | Bucket size for time series. |

For example, the last 7 days on a Unix shell:

```bash
START=$(( ($(date +%s) - 7*86400) * 1000 ))
END=$(( $(date +%s) * 1000 ))
```

If a website has a statistics reset date, events before it are left out of every stats response. Stats endpoints also accept `segmentId` to apply a saved segment.

## Endpoints

Replace `WEBSITE_ID` with the website's ID. The table shows the scope each endpoint needs.

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| `GET` | `/api/me` | read | The account the key acts as. |
| `GET` | `/api/websites` | read | Websites you can access. |
| `GET` | `/api/websites/WEBSITE_ID` | read | One website. |
| `GET` | `/api/websites/WEBSITE_ID/tracking-status` | read | Whether data arrived recently. |
| `GET` | `/api/websites/WEBSITE_ID/stats` | read | Pageviews, visitors, visits, bounces and time, with change. |
| `GET` | `/api/websites/WEBSITE_ID/stats/overview` | read | Stats, pageview series, a breakdown and a time series in one call. |
| `GET` | `/api/websites/WEBSITE_ID/pageviews` | read | Pageviews over time. |
| `GET` | `/api/websites/WEBSITE_ID/metrics` | read | Top pages, referrers, countries and other breakdowns. |
| `GET` | `/api/websites/WEBSITE_ID/events` | read | Custom events with counts. |
| `GET` | `/api/websites/WEBSITE_ID/events/series` | read | One custom event over time. |
| `GET` | `/api/websites/WEBSITE_ID/events/stats` | read | Total custom events and sessions with events. |
| `GET` | `/api/websites/WEBSITE_ID/sessions` | read | Sessions, paginated. |
| `GET` | `/api/websites/WEBSITE_ID/people` | read | People active in the period. |
| `GET` | `/api/websites/WEBSITE_ID/export` | read | Events or pageviews as CSV. Cloud or Business plan. |
| `GET` | `/api/websites/WEBSITE_ID/feature-flags` | read | Feature flags. Cloud or Business plan. |
| `PATCH` | `/api/websites/WEBSITE_ID/feature-flags/FLAG_ID` | write | Change a feature flag. Cloud or Business plan. |
| `POST` | `/api/websites/WEBSITE_ID/feature-flags/evaluate` | write | Evaluate one flag for a visitor. Cloud or Business plan. |
| `POST` | `/api/websites/WEBSITE_ID/warehouse/query` | write | Run one read-only SQL query. Cloud or Business plan. |

Other console features have endpoints too, such as errors, replays, insights, boards and logs. They follow the same authentication, errors and time-range rules. Plan requirements and website access apply to them as they do in the console.

### List websites

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://api.flareboard.dev/api/websites
```

Response: an array of websites.

```json
[
  {
    "id": "YOUR_WEBSITE_ID",
    "name": "My site",
    "domain": "example.com",
    "userId": "USER_ID",
    "replayEnabled": false,
    "timezone": "UTC",
    "autocapture": true,
    "persistVisitors": false,
    "respectDnt": false,
    "retentionDays": null,
    "createdAt": "2026-01-15T09:30:00.000Z"
  }
]
```

Fields that are not set, such as `teamId`, `resetAt` and the replay, heatmap and goal settings, are left out or `null`. `retentionDays` is `null` when the plan maximum applies (on a self-hosted install, when raw data is kept indefinitely). `GET /api/websites/WEBSITE_ID` returns one website in the same shape. It answers 404 for a website that does not exist or that you cannot access.

### Check tracking status

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api.flareboard.dev/api/websites/WEBSITE_ID/tracking-status
```

```json
{ "hasRecentData": true, "lastEventAt": 1790000000000, "pageviews24h": 42 }
```

`hasRecentData` is `true` when any event arrived in the last 15 minutes. `lastEventAt` is a millisecond timestamp, or `null` when the website has no events. This is what **Test tracking** in the console uses.

### Get stats

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://api.flareboard.dev/api/websites/WEBSITE_ID/stats?startAt=$START&endAt=$END"
```

```json
{
  "pageviews": { "value": 1240, "change": 12 },
  "visitors": { "value": 530, "change": 8 },
  "visits": { "value": 610, "change": 9 },
  "bounces": { "value": 240, "change": -3 },
  "totaltime": { "value": 91000, "change": 5 }
}
```

`value` is for the period you asked for. `change` is the percent change against the previous period of the same length.

### Get an overview

`/stats/overview` returns the stats, a pageview series, one breakdown and a visitors and pageviews time series in one response. It accepts the same time parameters, plus:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string | `path` | The breakdown to include. Same values as `/metrics` below. |
| `sortBy` | `views`, `visitors` or `time` | none | Sort for `path` and `url` breakdowns. |
| `limit` | 1 to 500 | 10 | Rows in the breakdown. |

```json
{
  "stats": { "pageviews": { "value": 1240, "change": 12 }, "visitors": { "value": 530, "change": 8 } },
  "pageviews": { "pageviews": [{ "x": "2026-10-08", "y": 410 }] },
  "metrics": [{ "x": "/pricing", "y": 220 }],
  "timeseries": {
    "pageviews": [{ "x": "2026-10-08", "y": 410 }],
    "visitors": [{ "x": "2026-10-08", "y": 180 }]
  }
}
```

The `stats` object in the real response lists all five stats, as in the previous section.

### Pageviews over time

`GET /api/websites/WEBSITE_ID/pageviews?startAt=...&endAt=...&unit=day` returns:

```json
{ "pageviews": [{ "x": "2026-10-07", "y": 380 }, { "x": "2026-10-08", "y": 410 }] }
```

### Breakdowns

`GET /api/websites/WEBSITE_ID/metrics?type=referrer&limit=5` returns a ranked list of `x` (the value) and `y` (the count):

```json
[{ "x": "google.com", "y": 310 }, { "x": "news.ycombinator.com", "y": 120 }]
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string | `path` | One of `path`, `url`, `entry`, `exit`, `referrer`, `channel`, `browser`, `os`, `device`, `country`, `region`, `city`, `language`, `event`. |
| `limit` | 1 to 500 | 10 | Rows to return. |
| `sortBy` | `views`, `visitors` or `time` | none | Sort for `path` and `url`. |

### Custom events

`GET /api/websites/WEBSITE_ID/events?startAt=...&endAt=...` lists custom events by count, most frequent first:

```json
[{ "x": "signup_completed", "y": 48 }, { "x": "purchase", "y": 17 }]
```

`GET /api/websites/WEBSITE_ID/events/series?event=signup_completed&unit=day` returns one event over time as `[{ "x": "2026-10-08", "y": 9 }]`. The `event` parameter is required: without it the API answers 400. `GET /api/websites/WEBSITE_ID/events/stats` returns `{ "events": { "value": 65 }, "visitors": { "value": 51 } }`, the number of custom events and the number of sessions that sent one.

Pageviews are not custom events, so they are not in these lists.

### Sessions

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://api.flareboard.dev/api/websites/WEBSITE_ID/sessions?page=1&pageSize=20&country=DE"
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `page` | number | 1 | Page number, starting at 1. |
| `pageSize` | number | 20 | Rows per page, 1 to 100. |
| `country`, `device`, `browser`, `path`, `referrer` | string | none | Only sessions that match. |

```json
{
  "data": [
    {
      "id": "SESSION_ID",
      "browser": "Chrome",
      "os": "macOS",
      "device": "desktop",
      "country": "DE",
      "city": "Berlin",
      "createdAt": 1790000000000,
      "visits": 1,
      "pageviews": 3,
      "events": 2,
      "lastAt": 1790000120000
    }
  ],
  "count": 134,
  "page": 1,
  "pageSize": 20
}
```

`count` is the total number of matching sessions across all pages. Sessions are newest activity first.

### People

`GET /api/websites/WEBSITE_ID/people?limit=100&q=ada` returns `{ "people": [...], "startAt": ..., "endAt": ... }`. Each person has `personId`, `latestEmail`, `latestName`, `firstSeenAt`, `lastSeenAt`, `sessions`, `visits`, `pageviews`, `events`, `country` and `city`. `limit` is 1 to 500 and defaults to 100. `q` filters by id, email or name.

### Feature flags

These endpoints need the Cloud or Business plan on the website owner's account.

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api.flareboard.dev/api/websites/WEBSITE_ID/feature-flags
```

Each flag has `id`, `key`, `name`, `description`, `enabled`, `conditionGroups`, `variants`, `payload`, `rollout`, `createdAt` and `updatedAt`, and a `summary` of its exposures.

Turn a flag on or off with its `id` (needs a key with **Write**):

```bash
curl -X PATCH \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' \
  https://api.flareboard.dev/api/websites/WEBSITE_ID/feature-flags/FLAG_ID
```

The same endpoint accepts `name`, `description`, `rollout`, `variants`, `conditionGroups`, `payload` and `key`. A flag key that already exists answers 400.

Evaluate one flag for a visitor (needs a key with **Write**, because it is a `POST`):

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key": "new-checkout", "distinctId": "user_123"}' \
  https://api.flareboard.dev/api/websites/WEBSITE_ID/feature-flags/evaluate
```

When the request includes a `distinctId`, `sessionId` or `anonymousId`, the evaluation is recorded as an exposure. To evaluate without recording one, use the `evaluate_feature_flag` tool of the [MCP server](/docs/mcp). See [Feature flags](/docs/feature-flags) for what flags do.

### Run SQL

`POST /api/websites/WEBSITE_ID/warehouse/query` runs one read-only query against the website's data. It needs the Cloud or Business plan and a key with **Write** (it is a `POST`).

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT event_name, COUNT(*) AS n FROM website_event WHERE website_id = ?1 AND event_name IS NOT NULL GROUP BY event_name ORDER BY n DESC LIMIT 10"}' \
  https://api.flareboard.dev/api/websites/WEBSITE_ID/warehouse/query
```

```json
{
  "columns": ["event_name", "n"],
  "rows": [{ "event_name": "signup_completed", "n": 48 }],
  "rowCount": 1,
  "cost": { "rowsRead": 5230, "durationMs": 14 }
}
```

The response also has an `analysis` object that describes how the query was checked. `GET /api/websites/WEBSITE_ID/warehouse/schema` lists the tables and columns you can query.

The query must be one statement with no semicolons or comments, at most 8,000 characters, starting with `SELECT` or `WITH`, and it must filter on `website_id = ?1`. Without a `LIMIT` you get 100 rows, and a `LIMIT` above 1,000 is capped at 1,000. A query stops after reading 100,000 rows or running for 10 seconds. You can run 20 queries a minute per user and website. Past that the API answers 429 with `Rate limit exceeded`. A failed query answers 400 with the reason in `message`.

### Export CSV

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  -o events.csv \
  "https://api.flareboard.dev/api/websites/WEBSITE_ID/export?type=events&startAt=$START&endAt=$END"
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | `events` or `pageviews` | `events` | `events` exports every event, pageviews included. `pageviews` exports only pageviews. |
| `startAt`, `endAt` | number | last 30 days | Period, as milliseconds. |

The response is `text/csv` with the columns `createdAt`, `sessionId`, `visitId`, `urlPath`, `eventName`, `referrer` and `country`, newest first, at most 10,000 rows. When the cap cut older rows off, the response has the header `X-Truncated: true` (and `X-Row-Cap: 10000`); export the rest with shorter periods. It needs the Cloud or Business plan on the website owner's account and is recorded in the website's audit log.

## Pagination

Only a few endpoints paginate:

| Endpoint | Parameters | Response |
| --- | --- | --- |
| Sessions | `page`, `pageSize` (1 to 100) | `data`, `count`, `page`, `pageSize` |
| Website activity (`/api/websites/WEBSITE_ID/audit`) and account activity (`/api/me/audit-log`) | `page`, `pageSize` (1 to 100, default 50) | `items`, `page`, `pageSize`, `total` |

Lists such as people, breakdowns and event names take a `limit` instead and return the top rows for the period.

## Errors

Errors are JSON with a `message`, and sometimes a `code`:

```json
{ "message": "This API key does not have the write scope" }
```

| Status | Meaning |
| --- | --- |
| 400 | Invalid parameters or body. The `message` says which. |
| 401 | The key is missing, malformed or revoked. The body is `{ "message": "Invalid API key" }` or an empty object. |
| 403 | The key lacks the scope the method needs, the account is read-only (`Read-only access`), the action is not allowed for keys, or the plan does not include the feature (for example `Feature flags require a paid plan.`). |
| 404 | The website or object does not exist, or you cannot access it. |
| 429 | Too many requests to a rate-limited endpoint. |

## Rate limits

The API code applies explicit limits to these:

| Endpoint | Limit |
| --- | --- |
| `POST /mcp` | 120 requests a minute per key |
| `POST` SQL queries and SQL CSV exports on a website | 20 a minute per user and website |

Other endpoints have no per-key limit in the API code. Be considerate anyway. Cache responses you read often, and use `/stats/overview` instead of several separate calls.

## Troubleshooting

- **401 on every request.** The header must be `Authorization: Bearer fb_sk_...`. A project key (`fb_pk_...`) is not accepted.
- **403 "does not have the write scope" on a read-only call.** You called a `POST` endpoint, such as SQL. Use a key with **Write** as well as **Read**.
- **403 "does not have the read scope".** The key has only **Write**. Create one with **Read**.
- **404 for a website you own.** Check the website ID. It is the UUID in the install snippet's `data-website-id`.
- **Empty stats.** The default period is the last 24 hours. Pass `startAt` and `endAt`.
