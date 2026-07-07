# Ingest worker reference

The ingest worker handles public collection from browsers and server-side SDKs. Base URL example: `https://t.your-domain.com`.

## Core endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/send` | Single collection payload |
| POST | `/api/batch` | Array of send payloads; returns `processed`, `errors`, and optional `cache` |
| GET | `/api/tracker-config?website=<uuid>` | Feature flags, surveys, heatmap settings for the tracker |
| POST | `/api/surveys/response` | Survey answer collection |
| POST | `/api/record` | Session replay chunks |
| GET | `/script.js` | Browser tracker |
| GET | `/recorder.js` | rrweb recorder bundle |

Rate limit: **100 requests/min per IP per website** (KV). Returns `429` when exceeded.

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
| `id` | Distinct ID from `identify()` |

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
| `provider`, `model`, `name` | Model metadata |
| `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `latencyMs` | Usage metrics |
| `status`, `quality` | Outcome metadata |
| `release`, `environment` | Deployment context |
| `data` | Extra properties |

## Tracker config (`GET /api/tracker-config`)

Returns runtime config for `script.js`:

- Heatmap sampling and enablement
- Active feature flags with rollout, variants, and targeting rules
- Active surveys with type, options, trigger event, display delay, and display rules

Example:

```bash
curl "https://t.example.com/api/tracker-config?website=<uuid>"
```

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
