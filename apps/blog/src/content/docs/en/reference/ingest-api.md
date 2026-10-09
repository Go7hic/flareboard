---
title: Ingest API reference
sidebarTitle: Ingest API
description: Every public endpoint of the Flareboard ingest address, with method, authentication, request, response and limits.
---

The ingest address receives data from browsers, servers, PostHog SDKs and OpenTelemetry exporters. This page lists every public route. On Flareboard Cloud the address is `https://t.flareboard.dev`. Self-hosters use their own ingest address. The routes are the same.

For task-oriented guides, see [Send events from your server](/docs/install/server), [Use PostHog SDKs](/docs/install/posthog) and [Logs and traces](/docs/logs-traces). To read or change data in your account, use the [REST API](/docs/api) on `https://api.flareboard.dev` instead.

## Conventions

**Authentication.** Ingest routes have no login. A request names its website with one of:

| Credential | Looks like | Accepted by |
| --- | --- | --- |
| Website ID | A UUID | `/api/send`, `/api/batch`, `/api/record`, `/api/tracker-config`, `/api/feature-flags/evaluate`, `/api/surveys` routes, `/api/websites/:websiteId/active` |
| Project key | `fb_pk_` and 24 letters and digits | Everywhere a website ID is accepted, and the only credential for the PostHog-compatible routes and the OpenTelemetry routes |

Both are public. See [Concepts](/docs/concepts#project-key). An unknown project key is treated as an unknown website.

**Requests.** Bodies are JSON unless stated. `/api/send` and `/api/record` read the body as text, so any `Content-Type` works (the tracker uses `text/plain` to avoid a CORS preflight).

**CORS.** Every route allows any origin. Allowed request headers are `Content-Type`, `Content-Encoding`, `Authorization`, `x-flareboard-cache` and `x-flareboard-key`.

**Errors.** Routes under `/api` answer errors with `{ "message": "…" }` and the HTTP status. The PostHog-compatible routes use PostHog's shape, `{ "type", "code", "detail" }`. The OpenTelemetry routes use `{ "code", "message" }` or protobuf, as the request did. An unexpected failure is `500` with `{ "message": "Server error" }`.

**Limits.** Limits are per minute and listed with each route and in [Limits](#limits). On Flareboard Cloud, collection also stops when the account's monthly allowance is used up, and the route answers `402`. Self-hosted installs have no plan limits.

## POST /api/send

Collects one event, identify call, group call, error, log, AI call, web vital or heatmap hit. This is the route the tracking script uses.

**Request body**

```json
{
  "type": "event",
  "payload": { "website": "YOUR_PROJECT_KEY", "url": "/pricing", "name": "signup" },
  "cache": "TOKEN_FROM_A_PREVIOUS_RESPONSE"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `type` | string, required | `event`, `identify`, `group`, `performance`, `heatmap`, `error`, `log` or `ai`. |
| `payload` | object, required | The fields for that type, below. |
| `cache` | string, optional | The `cache` value from an earlier response. Keeps events in the same visit. It can also be sent in the `x-flareboard-cache` header. Server callers can leave it out. |

**Common `payload` fields.** These apply to `event`, `identify`, `group`, `performance`, `error`, `log` and `ai`.

| Field | Type | Description |
| --- | --- | --- |
| `website` | string | Website ID or project key. Send this one. |
| `link`, `pixel` | UUID | Used by short links and tracking pixels instead of `website`. |
| `url` | string | Page path, cut at 500 characters. |
| `hostname` | string, up to 100 | Page hostname. |
| `referrer`, `title` | string | Cut at 500 characters. |
| `language` | string, up to 35 | Browser language. |
| `screen` | string, up to 11 | For example `1920x1080`. |
| `name` | string, up to 50 | Event name. Without it an `event` is a pageview. |
| `tag` | string, up to 50 | Optional label. |
| `data` | object, up to 100 keys | Properties. |
| `id` | string, up to 128 | Distinct ID of the user. |
| `anonymousId` | string, up to 128 | Random device ID from the tracker. Counted as the visitor only if the website has **Remember visitors across sessions** on. Otherwise it is dropped. |
| `timestamp` | integer | Seconds or milliseconds since the epoch. Outside 90 days back and 5 minutes ahead, the time of receipt is used. |
| `revenue`, `currency` | number, string (up to 10) | Revenue. Both are needed to record it. |
| `ip`, `userAgent`, `browser`, `os`, `device` | string | Override what is read from the request. The IP address is only hashed and is never stored. |

**Fields by `type`**

| `type` | Fields |
| --- | --- |
| `event` | The common fields. Matched action definitions are tagged on the event. `name: "$alias"` with `data: { "alias", "distinctId" }` links an anonymous ID to a user ID. |
| `identify` | `id`, `data`. Creates or updates the person. |
| `group` | `id`, `groupType` (up to 80), `groupKey` (up to 200), `data`. |
| `performance` | `lcp`, `inp`, `cls`, `fcp`, `ttfb`, either at the top level or in `data`. |
| `heatmap` | `kind` (`click` or `scroll`), `url`, `hostname`, and for clicks `x`, `y`, `viewportWidth`, `viewportHeight`, and for scrolls `scrollDepth` (0 to 100). `website` must be a website ID or project key. |
| `error` | `message` (up to 1,000), `errorName`, `stack` (up to 12,000), `source`, `lineno`, `colno`, `severity` (`fatal`, `error`, `warning`, `info`), `handled`, `release`, `environment`, `data`. |
| `log` | `level` (`trace`, `debug`, `info`, `warn`, `error`, `fatal`), `message`, `traceId`, `spanId`, `parentSpanId`, `service`, `operation`, `durationMs`, `status`, `release`, `environment`, `data`. |
| `ai` | `kind` (`generation`, `span`, `trace`, `embedding`), `provider`, `model`, `name`, `inputTokens`, `outputTokens`, `totalTokens`, `cacheReadTokens`, `cacheWriteTokens`, `costUsd`, `latencyMs`, `status` (`success` or `error`), `message`, `quality`, `traceId`, `spanId`, `parentSpanId`, `operation`, `input`, `output` (any JSON, 32 KB each, dropped when the website stores no content), `release`, `environment`, `data`. |

**Response.** `200`:

```json
{ "cache": "…", "sessionId": "…", "visitId": "…" }
```

A heatmap hit, or a link or pixel hit, answers `{ "ok": true }`. A request from a crawler user agent answers `200` with `{ "beep": "boop" }` and is dropped. HTTP client user agents such as `node`, `axios`, `python-requests`, `curl` and `Go-http-client` are accepted.

| Status | Body | Meaning |
| --- | --- | --- |
| `400` | `{ "message": "Payload too large" }` | The body is over 64 KB (65,536 characters). |
| `400` | `{ "message": "Invalid JSON" }` | The body is not JSON. |
| `400` | `{ "message": "Website not found." }` | Unknown website ID or project key. |
| `400` | `{ "message": "…" }` | A field failed validation. |
| `402` | `{ "message": "Monthly event limit exceeded." }` | Cloud allowance used up. |
| `429` | `{ "message": "Rate limit exceeded" }` | Over the rate limit. |

**Limits.** 64 KB per request. With a website ID: 100 requests per minute per IP address and website. With a project key: 30,000 per minute per key.

## POST /api/batch

Sends several `/api/send` bodies in one request.

**Request body.** A JSON array of up to 50 objects of the form `{ "type", "payload" }`, at most 512 KB in total and 64 KB per item. Each item is validated and processed on its own, with the same checks as `/api/send`.

**Response.** `200`:

```json
{ "size": 2, "processed": 1, "errors": 1, "details": [{ "index": 1, "response": { "message": "Website not found." } }], "cache": "…" }
```

`cache` is the token from the first item that returned one. Whole-request errors are `400` (`Batch payload too large`, `Invalid JSON`, `Expected array`, `Batch exceeds 50 items`) and `429`.

**Limits.** Unless every item names its website by project key, the batch call itself is limited to 100 per minute per IP address, and each item also counts against the per-website limit of `/api/send`. A batch where every item uses a project key counts against the key's limit only.

## POST /api/record

Receives a chunk of a session replay. `recorder.js` calls it. You do not call it yourself. See [Session replay](/docs/session-replay).

**Request body**

```json
{
  "type": "record",
  "payload": {
    "website": "YOUR_WEBSITE_ID",
    "sessionId": "…",
    "visitId": "…",
    "chunkIndex": 0,
    "events": [],
    "startedAt": 1760000000000,
    "endedAt": 1760000005000
  }
}
```

**Response.** `200` with `{ "ok": true, "replayId": "…", "r2Key": "…" }` when stored, `{ "ok": true, "replayId": "…", "deduped": true }` when the chunk was already stored, or `{ "ok": true, "skipped": true }` when nothing was stored (a crawler, replay turned off for the website, a plan without replay, or the monthly replay allowance used up). Errors: `400` (`Payload too large`, `Invalid JSON`, `Website not found`, validation) and `429`.

**Limits.** 512 KB per request. The rate limit is the same as `/api/send`. Console and network entries are dropped unless the website turned them on, and every entry is rebuilt from an allowed list of fields.

## GET /api/tracker-config

Returns the settings the tracking script needs for one website.

**Query.** `website` (or `key`, which the script sends for `data-project-key`): the website ID or project key. Required (`400` without it, `404` if unknown).

**Response.** `200`, JSON, cached for 60 seconds (`Cache-Control: public, max-age=60`):

| Field | Description |
| --- | --- |
| `websiteId` | The website ID. |
| `autocapture`, `persistence`, `respectDnt` | The website's **Data collection** settings. `persistence` is **Remember visitors across sessions**. |
| `replay` | Session replay settings: `sampleRate`, `maskInputs`, `maskAllText`, `maskSelector`, `blockSelector`, `console`, `network`, `minDurationMs`. |
| `heatmapSampleRate`, `heatmapEnabled` | Heatmap sampling. |
| `featureFlags` | Enabled flags with `key`, `enabled`, `rollout`, `variants`, `targeted`, and `payload` when set. Targeting rules are never exposed. Flags with `targeted: true` are evaluated through `/api/feature-flags/evaluate`. |
| `earlyAccessFeatures` | `flagKey`, `name`, `description`. |
| `surveys` | The active surveys. |

## POST /api/feature-flags/evaluate

Evaluates flags that need server-side targeting.

**Request body**

```json
{
  "website": "YOUR_PROJECT_KEY",
  "keys": ["pricing.banner"],
  "context": { "path": "/pricing", "language": "en-US", "distinctId": "user_123", "sessionId": "session-abc" }
}
```

`website` and `keys` are required. At most 200 unique keys are used. `context` may hold `distinctId`, `userId`, `sessionId`, `visitId`, `anonymousId`, `path`, `url`, `hostname`, `referrer`, `language`, `userAgent`, `environment`, `release`, `groups`, `properties`, `personProperties` and `groupProperties`.

**Response.** `200`:

```json
{ "results": { "pricing.banner": "test" }, "payloads": {} }
```

Each result is a variant key, `'test'` for an enabled flag without variants, `'control'` when the flag is off for this context, or `false` when the key is not an enabled flag of the website. `payloads` holds the payloads of enabled flags that have one. Errors: `400` (`website is required`, `keys is required`), `404` and `429`.

**Limits.** With a website ID: 120 requests per minute per IP address. With a project key: the key's flag budget (30,000 per minute).

## Surveys

### GET /api/surveys

Returns the active surveys for a website, in the same shape as `surveys` in `/api/tracker-config`.

**Query.** `website`: website ID or project key. Required.

**Response.** `200` with `{ "surveys": [ … ] }`, cached for 60 seconds. Only enabled surveys inside their schedule and under their response limit are listed. `400` without `website`, `404` if unknown.

### POST /api/surveys/response

Stores one survey answer, from the tracker, a hosted survey page, or your own client.

**Request body**

```json
{
  "website": "YOUR_WEBSITE_ID",
  "surveyId": "SURVEY_ID",
  "answers": { "nps": 10, "why": "Faster exports" },
  "completed": true,
  "responseId": "OPTIONAL_UUID",
  "source": "api"
}
```

| Field | Description |
| --- | --- |
| `website`, `surveyId` | Required. |
| `answers` | Question ID to value. Unknown IDs and invalid values are dropped. At least one valid answer is required. The old form `answer` (one string, for the first question) still works. |
| `completed` | `false` records a partial answer. |
| `responseId` | A UUID you generate. Posting again with the same ID merges the answers. |
| `source` | `widget`, `hosted` or `api`. |
| `distinctId`, `sessionId`, `visitId`, `urlPath` | Optional attribution. |

**Response.** `200` with `{ "ok": true, "responseId": "…", "completed": true }`. `400` for validation, an unknown website or survey, or no valid answers. `409` when the survey is closed or the response was already completed. `413` when the body is over 32 KB. `429` when over the limits.

**Limits.** 30 requests per minute per IP address, and 5 per hour per IP address for each survey.

### GET /api/surveys/hosted/:key

Returns the public definition of a hosted survey. `:key` is the survey ID or its slug.

**Response.** `200` with `{ id, websiteId, name, closed, questions, appearance }`. `closed: true` (with no questions) means the survey is disabled, outside its schedule or at its response limit. `404` if the survey does not exist or has no hosted page. Not cached. Limited to 60 requests per minute per IP address.

## PostHog-compatible routes

These let PostHog SDKs send to Flareboard. They are authenticated by project key only. See [Use PostHog SDKs](/docs/install/posthog).

### POST /capture, /e, /i/v0/e, /batch, /track

All five paths do the same thing, with or without a trailing slash. They accept a single event, an array of events, or `{ "api_key", "batch", "sent_at" }`.

**Authentication.** The project key from `api_key`, `token`, or an event's `properties.token`. Events that carry a different project's key are dropped.

**Body encodings.** JSON; gzip (`?compression=gzip-js`, `Content-Encoding: gzip`, or a bare gzip body); a `data=<base64>` form body; or a base64 body with `?compression=base64`. The legacy `lz64` encoding is rejected with `400`.

**Each event** needs `event` (cut at 200 characters) and `distinct_id` (up to 200 characters). `timestamp`, `offset`, `uuid`, `$set`, `$set_once` and `properties` are used when present.

**Response.** `200` with `{ "status": 1 }`.

| Status | `code` | Meaning |
| --- | --- | --- |
| `400` | `invalid_payload` | The body cannot be decoded, or no event is valid. |
| `401` | `invalid_api_key` | Missing or unknown project key. |
| `402` | `quota_limited` | Cloud allowance used up. |
| `413` | `invalid_payload` | The request is too large. |
| `429` | `rate_limited` | Over the rate limit. |

**Limits.** 2 MB on the wire, 8 MB decoded, 1,000 events per request, and 30,000 requests per minute per project key.

### POST /decide, /flags

Evaluates every enabled feature flag of the website and returns the SDK config. Both paths take the same request and return the same response, with or without a trailing slash.

**Request body.** JSON (the encodings above apply). The project key is read from `token` or `api_key` in the body, or `?token=`. Other fields used: `distinct_id`, `$anon_distinct_id` or `$device_id`, `person_properties`, `groups`, `flag_keys` or `flag_keys_to_evaluate` (to evaluate only some flags), and `disable_flags`.

**Response.** `200` with `featureFlags` (key to `true`, `false` or variant key), `featureFlagPayloads`, `flags` (a detail object per flag with the reason), `requestId`, and the config fields (`sessionRecording: false`, `surveys: false`, `heatmaps: false`, and so on). `401` for a missing or unknown key, `429` when over the flag budget (30,000 requests per minute per key).

### GET /array/:token/config, /array/:token/config.js

The remote config posthog-js loads on start. `:token` is the project key. `config.js` returns the same config as a script. Cached for 60 seconds. `404` for an unknown key, `429` when over the flag budget.

## OpenTelemetry (OTLP/HTTP)

### POST /v1/logs, POST /v1/traces

Receive OpenTelemetry logs and traces. Point an OpenTelemetry SDK or Collector at the ingest address. Metrics are not accepted, and gRPC is not supported. See [Logs and traces](/docs/logs-traces).

**Authentication.** The project key, as `Authorization: Bearer YOUR_PROJECT_KEY` or `x-flareboard-key: YOUR_PROJECT_KEY`. A website ID is not accepted.

**Request.** `Content-Type: application/json` or `application/x-protobuf` (`application/protobuf` also works). `Content-Encoding` may be `gzip` or absent.

**Response.** `200` with the OTLP export response in the request's encoding, with `partialSuccess` (`rejectedLogRecords` or `rejectedSpans`, and an `errorMessage`) when some records were rejected. Records older than 30 days are rejected.

| Status | Meaning |
| --- | --- |
| `400` | Malformed JSON or protobuf. |
| `401` | Missing or unknown project key. |
| `402` | Monthly log and span allowance used up (Cloud). |
| `413` | Body too large, or more than 10,000 records. |
| `415` | Unsupported `Content-Type` or `Content-Encoding`. |
| `429` | Rate limited. `Retry-After: 30`. Retry. |
| `501` | OTLP is not available on this deployment. |
| `503` | Storage temporarily unavailable. `Retry-After: 5`. Retry. |

**Limits.** 4 MB on the wire, 8 MB decoded, 10,000 records per request, and 30,000 requests per minute per project key (a budget separate from event capture).

## Scripts

### GET /script.js

The browser tracking script. `Content-Type: application/javascript`, `Cache-Control: public, max-age=86400`. Install it with `<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>`. All options are in the [Tracker reference](/docs/reference/tracker).

### GET /recorder.js

The session replay recorder. Same headers as `script.js`. It needs rrweb's UMD build and `script.js` loaded first. See [Session replay](/docs/session-replay).

## Other routes

| Route | Description |
| --- | --- |
| `GET /` | Returns `{ "name": "flareboard-ingest", "version": "0.0.1" }`. |
| `GET /api/heartbeat` | Returns `{ "ok": true }`. |
| `GET /api/websites/:websiteId/active` | Returns `{ "users": 12 }`, the number of visitors seen in the last 5 minutes. `:websiteId` may be a project key. Unknown websites return `{ "users": 0 }`. |
| `GET /:slug`, `GET /l/:slug`, `GET /api/links/:slug/redirect` | A short link. Answers `302` to the link's target and records the click. `404` for an unknown slug. |
| `GET /p/:slug.gif` | A tracking pixel. Always returns a 1x1 transparent GIF and records the hit when the pixel exists. |

## Limits

| Route | Limit |
| --- | --- |
| `/api/send` | 64 KB per request. 100 per minute per IP and website (website ID), or 30,000 per minute per key (project key). |
| `/api/batch` | 50 items, 512 KB, 64 KB per item. |
| `/api/record` | 512 KB per request. Same rate limit as `/api/send`. |
| `/api/feature-flags/evaluate` | 120 per minute per IP (website ID), or the key's flag budget of 30,000 per minute (project key). |
| `/api/surveys/response` | 32 KB. 30 per minute per IP, 5 per hour per IP per survey. |
| `/api/surveys/hosted/:key` | 60 per minute per IP. |
| `/capture`, `/e`, `/i/v0/e`, `/batch`, `/track` | 2 MB on the wire, 8 MB decoded, 1,000 events. 30,000 per minute per key. |
| `/decide`, `/flags`, `/array/:token/config` | 30,000 per minute per key, a budget separate from capture. |
| `/v1/logs`, `/v1/traces` | 4 MB on the wire, 8 MB decoded, 10,000 records. 30,000 per minute per key, a separate budget. |

The per-key limit is 30,000 requests per minute by default. Self-hosters can change it with the ingest `PROJECT_KEY_RATE_LIMIT` variable. Monthly allowances on Flareboard Cloud are in [Plans and limits](/docs/plans-limits).
