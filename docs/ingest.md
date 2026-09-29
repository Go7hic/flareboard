# Ingest worker reference

The ingest worker handles public collection from browsers and server-side SDKs. Base URL example: `https://t.your-domain.com`.

## Core endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/send` | Single collection payload |
| POST | `/api/batch` | Array of send payloads; returns `processed`, `errors`, and optional `cache` |
| POST | `/api/feature-flags/evaluate` | Server-side feature flag evaluation for targeted flags |
| GET | `/api/tracker-config?website=<uuid>` | Feature flags, surveys, heatmap settings for the tracker |
| POST | `/api/surveys/response` | Survey answer collection |
| POST | `/api/record` | Session replay chunks |
| GET | `/script.js` | Browser tracker |
| GET | `/recorder.js` | rrweb recorder bundle |

Rate limit: **100 requests/min per IP per website** (Durable Objects). Returns `429` when exceeded.

## `/api/send` payload types

All payloads use `{ "type": "<kind>", "payload": { ... } }`.

### Event (`type: "event"`)

Standard pageviews and custom events.

| Field | Notes |
|-------|-------|
| `website` | Website UUID |
| `hostname`, `url`, `referrer`, `title` | Page context |
| `name` | Custom event name; omit for pageview |
| `data` | Arbitrary JSON properties stored in `event_data` |
| `tag` | Optional event tag |
| `revenue`, `currency` | Optional revenue attribution |
| `id` | Distinct ID: the `identify()` user id, or the anonymous id (see below) |
| `anonymousId` | Random device id from the tracker. When it equals `id` (or `id` is absent) the event is anonymous: ingest counts the visitor by it only if the website has **Remember visitors across sessions** on, and otherwise drops it and uses the monthly IP + user agent hash |

Matched action definitions are tagged at ingest time on `$flareboard_action_ids` and `$flareboard_action_names` in event properties.

### Identify (`type: "identify"`)

Upserts a person profile in D1 and writes session properties.

```json
{
  "type": "identify",
  "payload": {
    "website": "<uuid>",
    "id": "user-123",
    "data": { "email": "ada@example.com", "plan": "pro" }
  }
}
```

### Group (`type: "group"`)

Associates the current distinct ID with a group key and optional group properties.

```json
{
  "type": "group",
  "payload": {
    "website": "<uuid>",
    "id": "user-123",
    "groupType": "company",
    "groupKey": "acme-inc",
    "data": { "name": "Acme Inc" }
  }
}
```

### Alias (`flareboard.alias()` / `$alias` event)

Links an anonymous distinct ID to a canonical user ID. Stored on the person profile as `$alias` and mirrored on a secondary `person` row keyed by the alias distinct ID.

```json
{
  "type": "event",
  "payload": {
    "website": "<uuid>",
    "name": "$alias",
    "data": { "alias": "anon-abc", "distinctId": "user-123" }
  }
}
```

### Error (`type: "error"`)

| Field | Notes |
|-------|-------|
| `message` | Error message |
| `errorName` | Error class/name |
| `stack`, `source`, `lineno`, `colno` | Stack metadata |
| `severity`, `handled` | Issue triage hints |
| `release`, `environment` | Deployment context |
| `data` | Extra properties |

Stored as `event_type = error` with properties in `event_data`.

### Log (`type: "log"`)

Structured log and trace spans.

| Field | Notes |
|-------|-------|
| `level` | `debug`, `info`, `warn`, `error` |
| `message` | Log line |
| `traceId`, `spanId`, `parentSpanId` | Trace correlation |
| `service`, `operation`, `durationMs`, `status` | Span metadata |
| `release`, `environment` | Deployment context |
| `data` | Extra properties |

### AI observability (`type: "ai"`)

| Field | Notes |
|-------|-------|
| `kind` | `generation` (default), `span`, `trace` or `embedding` |
| `provider`, `model`, `name` | Model metadata (`name` is the event name) |
| `inputTokens`, `outputTokens`, `totalTokens`, `cacheReadTokens`, `cacheWriteTokens` | Token usage |
| `costUsd`, `latencyMs` | Omit `costUsd` to have it computed from the model price table |
| `status`, `message`, `quality` | Outcome; `message` is the error of a failed call |
| `traceId`, `spanId`, `parentSpanId`, `operation` | Trace tree (`operation` is the span name) |
| `input`, `output` | Prompt / response (any JSON), 32 KB each, dropped when the website stores no content |
| `release`, `environment` | Deployment context |
| `data` | Extra properties |

PostHog `$ai_*` events map onto the same fields. See [llm-observability.md](./llm-observability.md).

## Tracker config (`GET /api/tracker-config`)

Returns runtime config for `script.js`:

- `websiteId`, and the website's tracker settings: `autocapture`, `persistence` (remember visitors
  across sessions) and `respectDnt`

- Heatmap sampling and enablement
- Active feature flags with rollout, variants, and a `targeted` boolean (targeting rules are not exposed)
- Active surveys with type, options, trigger event, display delay, and display rules

Example:

```bash
curl "https://t.example.com/api/tracker-config?website=<uuid>"
```

## Browser tracker (`script.js`)

```html
<script defer src="https://t.example.com/script.js" data-website-id="<uuid>"></script>
```

Script tag options (all optional; absent means "follow the website settings"):

| Attribute | Effect |
|-----------|--------|
| `data-autocapture="false"` / `"true"` | Turn `$autocapture` off or on for this page |
| `data-pageleave="false"` / `"true"` | `$pageleave` events (default: same as autocapture) |
| `data-persistence="false"` | Never keep an anonymous id in localStorage on this page |
| `data-respect-dnt` | Send nothing from browsers with Do Not Track or Global Privacy Control |
| `data-project-key` | Instead of `data-website-id`; resolved through `/api/tracker-config?key=` (the response must carry `websiteId`) |
| `data-release`, `data-environment`, `data-heatmap-sample-rate` | As before |

Events the tracker adds:

- `$autocapture`: clicks on links, buttons, `[role=button]` and submit/button inputs, form submits
  and field changes. Properties: `$event_type` (`click`, `submit`, `change`), `$el_tag`, `$el_id`,
  `$el_classes` (up to 10), `$el_type`, `$el_name` (fields and forms), `$el_text` (up to 255
  characters, never for fields, password or sensitive-looking elements, or text that looks like a
  card number, SSN or email), `$el_href` and `$el_selector` (element plus up to 5 ancestors).
  Values typed or selected are never sent. Nothing inside `[data-fb-no-capture]` or
  `.ph-no-capture` is captured. At most 10 per burst (refilling one per second) and 100 per page.
- `$pageleave`: `$time_on_page` (seconds the page was visible) and `$max_scroll_depth` (percent),
  sent with `sendBeacon` on `pagehide` and before each SPA pageview.

API additions on `window.flareboard`: `register(props)`, `registerOnce(props)`, `unregister(key)`,
`optOut()`, `optIn()`, `hasOptedOut()`, `getFeatureFlagPayload(key)`,
`onFeatureFlags((flags, variants, payloads) => {})` (returns an unsubscribe function). Calls made
before the script loads can be queued on `window.flareboard = { _q: [[method, args], ...] }`; the
npm package [`@flareboard/js`](../packages/sdk-js/README.md) does this for you.

## Feature flag evaluation (`POST /api/feature-flags/evaluate`)

Public endpoint used by the embedded tracker for flags with `targeted: true`. Targeting rules stay server-side.

```json
{
  "website": "<uuid>",
  "keys": ["pricing.banner"],
  "context": {
    "path": "/pricing",
    "language": "en-US",
    "distinctId": "user-123",
    "sessionId": "session-abc"
  }
}
```

Response:

```json
{
  "results": {
    "pricing.banner": "test"
  }
}
```

Rate limit: **120 requests/min per IP**.

## Survey responses

`POST /api/surveys/response`

```json
{
  "website": "<uuid>",
  "surveyId": "<uuid>",
  "answer": "Great checkout flow",
  "sessionId": "<optional>",
  "visitId": "<optional>",
  "url": "/checkout"
}
```

## Batch collection

`POST /api/batch` accepts an array of the same objects accepted by `/api/send`. Each item is validated independently; partial success is allowed.

## Related docs

- [API reference](./api.md)
- [Development guide](./development.md)
