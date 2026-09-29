# Ingest worker reference

The ingest worker handles public collection from browsers and server-side SDKs. Base URL example: `https://t.your-domain.com`.

## Core endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/send` | Single collection payload |
| POST | `/api/batch` | Array of send payloads; returns `processed`, `errors`, and optional `cache` |
| POST | `/api/feature-flags/evaluate` | Server-side feature flag evaluation for targeted flags |
| GET | `/api/tracker-config?website=<uuid>` | Feature flags, surveys, heatmap settings for the tracker |
| POST | `/api/surveys/response` | Survey answer collection (widget, hosted page, headless) |
| GET | `/api/surveys?website=<uuid>` | Headless: active surveys for a website |
| GET | `/api/surveys/hosted/:key` | Public definition of a hosted survey (`/s/<id or slug>`) |
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
| `provider`, `model`, `name` | Model metadata |
| `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `latencyMs` | Usage metrics |
| `status`, `quality` | Outcome metadata |
| `release`, `environment` | Deployment context |
| `data` | Extra properties |

## Tracker config (`GET /api/tracker-config`)

Returns runtime config for `script.js`:

- `websiteId`, and the website's tracker settings: `autocapture`, `persistence` (remember visitors
  across sessions) and `respectDnt`

- Heatmap sampling and enablement
- Active feature flags with rollout, variants, and a `targeted` boolean (targeting rules are not exposed)
- Active surveys (see [Surveys](#surveys) for the shape)

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

## Session recorder (`recorder.js`)

Load rrweb's UMD build (`https://cdn.jsdelivr.net/npm/rrweb@2/umd/rrweb.min.js`), `script.js`, then
`recorder.js` with the same `data-website-id`. Settings come from `tracker-config` → `replay` (edited in
the website's replay settings); source and full rules in `apps/ingest/src/tracker/recorder.ts`.

- Opted-out visitors (`flareboard.optOut()`) are never recorded; opting out mid-visit stops the recording.
  Do Not Track / GPC stop it when the website respects them or a script tag has `data-respect-dnt`.
- Inputs are masked unless the site turns that off; password, payment, one-time-code and sensitive-looking
  fields stay masked regardless. `maskAllText` masks every text node.
- Markup: `data-fb-mask` / `.fb-mask` / `.ph-mask` mask text and inputs inside; `data-fb-no-capture` /
  `.ph-no-capture` / `data-fb-block` / `.fb-block` / `.ph-block` are not recorded (same-size placeholder).
- Console (`$console` { level, message }) and network (`$network` { method, url, status, duration, size,
  failed }) capture are per-site opt-ins. URLs lose their query string, messages are scrubbed and capped at
  1000 characters, headers and bodies are never read. `/api/record` drops these entries when the site has
  not opted in and rebuilds the rest from that allowlist.
- `sampleRate` is decided once per visit; `minDurationMs` holds the first chunk until the visit is that long.

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

## Surveys

### Active surveys (`GET /api/surveys?website=<uuid>`)

Headless clients (mobile apps, custom widgets) fetch the same list the tracker gets in
`/api/tracker-config` → `surveys`. Only enabled surveys whose schedule is open and whose response
limit is not reached are listed (cached for 60 seconds, at most 10). Each survey:

```json
{
  "id": "<uuid>",
  "name": "Relationship NPS",
  "question": "How likely are you to recommend us?",
  "type": "choice",
  "options": ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  "triggerPath": "/pricing",
  "triggerEvent": null,
  "displayDelaySeconds": 0,
  "displayRules": [{ "field": "path", "operator": "contains", "value": "/checkout" }],
  "version": 2,
  "questions": [
    {
      "id": "nps", "type": "rating", "scale": "nps", "question": "How likely are you to recommend us?",
      "description": "", "optional": false, "buttonText": "", "lowerLabel": "Unlikely", "upperLabel": "Very likely",
      "branching": [{ "when": { "type": "range", "min": 9, "max": 10 }, "next": "end" }]
    },
    { "id": "why", "type": "open", "question": "What should we improve?", "placeholder": "", "...": "" }
  ],
  "appearance": {
    "position": "bottom-right", "theme": "auto", "accent": "blue", "submitText": "", "showThankYou": true,
    "thankYouMessage": "",
    "colors": { "light": { "background": "#ffffff", "text": "#171717", "mutedText": "#4d4d4d", "border": "#eaeaea", "accent": "#006bff", "accentText": "#ffffff" }, "dark": { "...": "" } }
  },
  "sampleRate": 100,
  "repeatIntervalDays": null,
  "endsAt": null
}
```

- `question` / `type` (`text` | `rating` | `choice`) / `options` mirror the first question for
  clients written before multi-question surveys. New clients use `questions`.
- Question types: `open` (`placeholder`), `rating` (`scale`: `5`, `10` or `"nps"` = 0-10, with
  `lowerLabel` / `upperLabel`), `single_choice` and `multiple_choice` (`options`, `hasOther`),
  `link` (`url`, always skippable). `optional: true` questions may be skipped.
- Branching: after answering question *i*, the first rule in `branching` whose `when` matches picks
  the next question (`next` = a later question id, or `"end"`). `any` always matches (also when
  skipped), `choice` matches a selected option (`"$other"` = any free-text "Other" answer), `range`
  matches a rating between `min` and `max` inclusive. No match → the next question in order.
- `sampleRate` (0-100): show to a person only when their bucket is below it. Bucket = FNV-1a hash
  of `survey:<surveyId>:<distinctId>` modulo 100 (`surveySampleBucket` in `packages/shared`).
- `repeatIntervalDays`: `null` = show once per person, otherwise the survey may be shown again
  that many days after it was last shown.

### Submitting responses (`POST /api/surveys/response`)

```json
{
  "website": "<uuid>",
  "surveyId": "<uuid>",
  "responseId": "<uuid generated by the client, optional>",
  "answers": { "nps": 10, "why": "Faster exports", "plan": ["Pro", "Something else"] },
  "completed": true,
  "source": "api",
  "distinctId": "<optional>",
  "sessionId": "<optional>",
  "visitId": "<optional>",
  "urlPath": "/checkout"
}
```

- `answers` maps question id → value: text for `open` and `single_choice`, an integer for
  `rating`, an array for `multiple_choice` (options plus at most one "Other" text), `"clicked"`
  for `link`. Unknown ids and invalid values are dropped. At least one valid answer is required.
- The legacy form `{ "answer": "7" }` (one string) answers the first question.
- `completed: false` records a partial response (for example when the survey is dismissed).
  Posting again with the same `responseId` merges the new answers and can complete it. A
  completed response cannot be changed (409).
- A response only counts as complete when the answers reach the end of the survey through the
  branching rules. The reply is `{ "ok": true, "responseId": "…", "completed": true }`.
- New responses are refused with 409 once the survey is outside its schedule or has reached its
  response limit. Hosted submissions (`source: "hosted"`) are accepted only for surveys with the
  hosted page enabled.
- Rate limits: 30 requests per minute per IP, and 5 per hour per IP for each survey. Bodies above
  32 KB are rejected (413).

### Hosted surveys (`GET /api/surveys/hosted/:key`)

`key` is the survey id or its custom slug. Returns `{ id, websiteId, name, closed, questions,
appearance }` for surveys with the hosted page enabled (404 otherwise). `closed: true` (with no
questions) means the survey is disabled, outside its schedule or at its response limit. The
dashboard serves the page at `/s/<key>`; add `?distinct_id=<id>` to attribute the response to a
known person.

## Batch collection

`POST /api/batch` accepts an array of the same objects accepted by `/api/send`. Each item is validated independently; partial success is allowed.

## Related docs

- [API reference](./api.md)
- [Development guide](./development.md)
