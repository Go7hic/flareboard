# PostHog-compatible ingestion

Flareboard's ingest worker speaks enough of PostHog's capture and flags API that PostHog SDKs can
send to Flareboard by changing only two settings:

- **API key**: the website's **project API key** (`fb_pk_…`). Find it in the dashboard under
  *Website → Settings → Project API key* (or in the ingest snippet panel). It is public, like
  PostHog's project key, and can be rotated there.
- **Host**: your ingest URL (the host serving `script.js`, e.g. `https://ingest.example.com`).

## Setup

### posthog-js (browser)

```js
import posthog from 'posthog-js'

posthog.init('fb_pk_…', {
  api_host: 'https://ingest.example.com',
  person_profiles: 'identified_only',
  // Not served through this API: use Flareboard replay and surveys instead.
  disable_session_recording: true,
  disable_surveys: true,
})
```

Use the npm package (or a self-hosted bundle). The CDN snippet loads extensions such as the
recorder, surveys and web-vitals from `api_host`, which Flareboard does not serve.

### posthog-node

```js
import { PostHog } from 'posthog-node'

const posthog = new PostHog('fb_pk_…', { host: 'https://ingest.example.com' })
posthog.capture({ distinctId: 'user_123', event: 'subscription_renewed', properties: { plan: 'pro' } })
const variant = await posthog.getFeatureFlag('checkout.new_flow', 'user_123')
await posthog.shutdown()
```

Local flag evaluation (`personalApiKey` + `/api/feature_flag/local_evaluation`) is not supported;
flags are evaluated remotely through `/flags`.

### posthog-python

```python
from posthog import Posthog

posthog = Posthog('fb_pk_…', host='https://ingest.example.com')
posthog.capture(distinct_id='user_123', event='subscription_renewed', properties={'plan': 'pro'})
posthog.shutdown()
```

Other PostHog server SDKs (Ruby, Go, PHP, Java, …) use the same `/batch/` and `/flags/` calls and
should work the same way.

## Endpoints

| Path | Purpose |
|------|---------|
| `POST /capture/`, `/e/`, `/i/v0/e/`, `/batch/`, `/track/` | Events: a single event, an array of events, or `{ api_key, batch, sent_at }` |
| `POST /decide/`, `/flags/` | Feature flags (v2 `flags` detail plus v3 `featureFlags` / `featureFlagPayloads`) and SDK config |
| `GET /array/<key>/config`, `/array/<key>/config.js` | Remote config posthog-js loads on start |

Trailing slashes are optional. Accepted body encodings: JSON; gzip (`?compression=gzip-js`,
`Content-Encoding: gzip`, or a bare gzip body as newer posthog-js sends); `data=<base64>` form bodies
(posthog-js base64 mode and `sendBeacon`), or a base64 body with `?compression=base64`. The legacy
`lz64` encoding is rejected with 400. Limits: 2 MB on the wire, 8 MB decoded, 1000 events per request.

The key is read from `api_key`, `token`, or `properties.token`. Events carrying a different
project's token are dropped, so one request always writes to one website.

Responses: `200 {"status": 1}`; `401` for a missing or unknown key; `400` for undecodable
payloads or when no event is valid (each needs `event` and `distinct_id`); `402` when a hosted
plan's monthly event quota is used up; `429` when the key's rate limit is exceeded.

## Event mapping

| PostHog | Flareboard |
|---------|-----------|
| `$pageview` | Pageview. URL from `$current_url` (path, query, UTM and click ids), referrer from `$referrer` (`$direct` = none), title from `$title` / `title`, hostname from `$host` |
| `$pageleave`, `$autocapture`, `$rageclick`, `$feature_flag_called`, custom events | Custom events with their properties |
| `$exception` | Error event (message, type, stack built from `$exception_list` frames, source, line, column, level, handled) |
| `$web_vitals` | Performance event (LCP, INP, CLS, FCP) |
| `$identify` | Person properties from `$set` / `$set_once`, and `$anon_distinct_id` aliased to the identified id |
| `$set` (event or property on any event), `$set_once` | Person properties; `$set_once` never overwrites an existing value |
| `$create_alias`, `$merge_dangerously` | Alias (the alias gets a person row pointing at the canonical id) |
| `$groupidentify` | Group properties (`$group/<type>`, `$group/<type>/<prop>`) and group membership |
| `$groups` on any event | Group membership of the visitor's session |
| `$snapshot`, `$performance_event`, `$$…` | Ignored (session recording data) |

Stored event properties: the customer's own properties first, then PostHog properties worth
keeping (`$lib`, `$lib_version`, `$feature/*`, `$feature_flag*`, `$el_text`, `$elements_chain`,
`$prev_pageview_*`, `$survey*`, `$ai_*`, …), primitives only, up to 100 keys. Properties already
mapped to columns and SDK internals are dropped. `$ip` and `$raw_user_agent` are never stored.

Browser, OS, device type, screen and language come from `$browser`, `$os`, `$device_type`,
`$screen_width` × `$screen_height` and `$browser_language` (PostHog names such as `Mac OS X` or
`Mobile Safari` are normalized to the tracker's), falling back to `$raw_user_agent` and then the
request's user agent when it is a browser. Location comes from the request only for browser
traffic; a server SDK's request location is the server's, so server events have no location.

With `$process_person_profile: false` (posthog-js `person_profiles: 'identified_only'` for
anonymous users) no person is created or updated and the session is not tied to the distinct id.

Every event goes through the same queue messages and aggregator path as the tracker's
`/api/send`, including action tagging, workflows and realtime counts.

### Sessions and visits

Mapping is deterministic and scoped per website:

- Flareboard session (visitor) = `uuid(websiteId, distinct_id)`, the same id the tracker uses for an
  identified visitor, so tracker and SDK events for the same user line up.
- Flareboard visit = `uuid(session, $session_id)`: one PostHog session is one Flareboard visit.
  Events without `$session_id` (server SDKs) fall into an hourly visit, as tracker events without
  a cache token do.
- Event ids derive from the PostHog event `uuid`, so SDK retries do not create duplicates.

When a visitor identifies mid-session, later events belong to the identified distinct id (its
own Flareboard session and visit, as with the tracker in a new tab), and the anonymous id is
aliased to it so the two ids are linked.

### Timestamps

PostHog's rules: an event `timestamp` is corrected for client clock skew when the request says
when it was sent (`sent_at` in the body, or the `sent_at` / `_` query parameter) unless the event
sets `$ignore_sent_at`; otherwise `offset` (milliseconds before now) is used; otherwise server
time. The result must fall within Flareboard's accepted window (90 days back, 5 minutes ahead) or
server time is used.

## Feature flags

`/decide` and `/flags` evaluate every enabled flag of the website with the shared evaluator
(`packages/shared/src/feature-flag-evaluator.ts`), using `distinct_id` for bucketing,
`person_properties` for property rules and `groups` for group rules. Boolean flags return
`true`/`false`; flags with variants return the variant key. `flag_keys` / `flag_keys_to_evaluate`
restrict the response. Payloads are returned when flags carry them.

## Rate limits and quotas

Requests are limited per project key (default 30,000 requests per minute across all IPs,
configurable with the ingest `PROJECT_KEY_RATE_LIMIT` variable), not per IP, since server SDKs
send from a few IPs. Flag requests have their own budget of the same size. Hosted-plan monthly
event quotas apply as for the tracker.

## Not supported

- Session recording (`/s/`), surveys, heatmaps, site apps, the toolbar and web experiments through
  the PostHog SDK (the config returned to posthog-js turns them off).
- Local flag evaluation and the PostHog management API (`/api/projects/…`). Use Flareboard's API
  with a personal API key (`Authorization: Bearer fb_sk_…`) instead.
- `lz64` compression, `$unset`, and group-level person merging rules beyond aliasing.
- Revenue: PostHog events have no standard revenue field, so none is recorded.
