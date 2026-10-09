---
title: Use PostHog SDKs
sidebarTitle: PostHog SDKs
description: Point posthog-js, posthog-node, posthog-python and the PostHog LLM wrappers at Flareboard by changing the API key and the host.
---

Flareboard's ingest address speaks enough of PostHog's capture and flags API that PostHog SDKs can send to it. If your code already uses PostHog, change two settings and keep the rest: the API key becomes your website's [project key](/docs/concepts#project-key), and the host becomes your Flareboard ingest address.

## Before you start

- A website in Flareboard. See the [Quickstart](/docs/quickstart).
- Its project key. Open **Websites**, then the website's **Settings**. The **Project API key** card shows it (it starts with `fb_pk_`). The **PostHog SDKs** tab of the install snippet shows the same snippets below with your key filled in.
- The ingest address: `https://t.flareboard.dev` on Flareboard Cloud. If you self-host, use your own ingest address (the host that serves `script.js`).

The examples use `YOUR_PROJECT_KEY` for the key. The project key is public, so it is fine in browser code.

## 1. posthog-js (browser)

Install the npm package and set `api_host`:

```ts
import posthog from 'posthog-js'

posthog.init('YOUR_PROJECT_KEY', {
  api_host: 'https://t.flareboard.dev',
  person_profiles: 'identified_only',
  // Session recording and surveys run through Flareboard, not the PostHog SDK
  disable_session_recording: true,
  disable_surveys: true,
})
```

Use the npm package, not PostHog's CDN snippet. The CDN snippet loads extra code (the recorder, surveys, web vitals) from `api_host`, and Flareboard does not serve those files.

With `person_profiles: 'identified_only'`, anonymous visitors do not get a person profile. The profile appears when you call `posthog.identify()`.

## 2. posthog-node (server)

```ts
import { PostHog } from 'posthog-node'

const posthog = new PostHog('YOUR_PROJECT_KEY', { host: 'https://t.flareboard.dev' })

posthog.capture({ distinctId: 'user_123', event: 'subscription_renewed', properties: { plan: 'pro' } })
const variant = await posthog.getFeatureFlag('checkout.new_flow', 'user_123')

await posthog.shutdown()
```

Call `shutdown()` before the process exits so queued events are sent.

Local flag evaluation (`personalApiKey`) is not supported. Flags are evaluated remotely by Flareboard on each call.

## 3. posthog-python (server)

```python
from posthog import Posthog

posthog = Posthog('YOUR_PROJECT_KEY', host='https://t.flareboard.dev')
posthog.capture(distinct_id='user_123', event='subscription_renewed', properties={'plan': 'pro'})
posthog.shutdown()
```

Other PostHog server SDKs (Ruby, Go, PHP, Java and so on) use the same `/batch/` and `/flags/` calls. Setting the key and host the same way should work for them too.

## What works

| PostHog | What Flareboard does |
| --- | --- |
| Custom events | Stored as custom events with their properties. |
| `$pageview` | A pageview. The URL comes from `$current_url`, the referrer from `$referrer` and the title from `$title`. |
| `$pageleave`, `$autocapture`, `$rageclick`, `$feature_flag_called` | Stored as custom events. |
| `$identify`, `$set`, `$set_once` | Create or update the person. `$set_once` never overwrites an existing value. `$identify` also links `$anon_distinct_id` to the identified ID. |
| `$create_alias`, `$merge_dangerously` | Link the alias to the main ID. |
| `$groupidentify` and `$groups` on any event | Group properties and group membership. |
| `$exception` | An error event with message, type, stack, source, line, column, level and whether it was handled. See [Error tracking](/docs/error-tracking). |
| `$web_vitals` | Performance data: LCP, INP, CLS and FCP. |
| `$ai_generation`, `$ai_span`, `$ai_trace`, `$ai_embedding` | AI events. See [LLM wrappers](#llm-wrappers). |
| Feature flags | Evaluated by Flareboard through `/flags` and `/decide`. Boolean flags return `true` or `false`, and flags with variants return the variant key. Payloads are returned when a flag has one. See [Feature flags](/docs/feature-flags). |

Details that matter:

- **One request, one website.** An event that carries another project's key is dropped.
- **Properties.** Your own properties are stored first, then PostHog properties worth keeping (such as `$lib`, `$feature/*` and `$ai_*`). Only strings, numbers and booleans are kept, up to 100 keys per event.
- **Privacy.** `$ip` and `$raw_user_agent` are never stored.
- **Browser and device.** Taken from `$browser`, `$os`, `$device_type`, `$screen_width`, `$screen_height` and `$browser_language`, then from the user agent.
- **Location.** Only requests from browsers get a country and city. A server SDK's request location is your server's, so server events have none.
- **Retries.** Event IDs are derived from the PostHog event `uuid`, so an SDK retry does not create a duplicate.
- **Time.** `timestamp` is corrected for clock skew when the request says when it was sent. A time outside 90 days back and 5 minutes ahead is replaced with the time of receipt.
- **Visitors and visits.** The visitor is derived from the PostHog `distinct_id` and the visit from `$session_id`, so tracker events and SDK events for the same user line up. See [Concepts](/docs/concepts#visits-and-sessions).
- **Anonymous users.** With `$process_person_profile: false` (what `person_profiles: 'identified_only'` sends for anonymous users) no person is created or updated.

## What does not work

- **Session recording** through the PostHog SDK. Use Flareboard's own recorder: see [Session replay](/docs/session-replay). The `$snapshot` and `$performance_event` events are ignored.
- **Surveys** through the PostHog SDK. Use [Flareboard surveys](/docs/surveys).
- Heatmaps, site apps, the PostHog toolbar and web experiments. The config Flareboard returns to posthog-js turns them off, and the same config switches off posthog-js's automatic exception capture.
- Local flag evaluation and PostHog's management API (`/api/projects/...`). To read or change Flareboard data from code, use the [REST API](/docs/api) with a personal API key.
- The legacy `lz64` compression. Use gzip, base64 or plain JSON.
- `$unset`, and group-level person merging beyond aliasing.
- Revenue. PostHog events have no standard revenue field, so none is recorded.

## LLM wrappers

The PostHog LLM wrappers work when they use the same key and host. They send `$ai_generation`, `$ai_span`, `$ai_trace` and `$ai_embedding` events, which appear under **AI observability**.

```python
from posthog import Posthog
from posthog.ai.openai import OpenAI

posthog = Posthog('YOUR_PROJECT_KEY', host='https://t.flareboard.dev')
client = OpenAI(api_key='YOUR_OPENAI_API_KEY', posthog_client=posthog)

response = client.chat.completions.create(
    model='gpt-4o-mini',
    messages=[{'role': 'user', 'content': 'What is Flareboard?'}],
    posthog_distinct_id='user_123',      # the user the call is attributed to
    posthog_trace_id='conversation-42',  # groups calls into one trace
)
posthog.shutdown()
```

```ts
import { PostHog } from 'posthog-node'
import { OpenAI } from '@posthog/ai'

const posthog = new PostHog('YOUR_PROJECT_KEY', { host: 'https://t.flareboard.dev' })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, posthog })

await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'What is Flareboard?' }],
  posthogDistinctId: 'user_123',
  posthogTraceId: 'conversation-42',
})
await posthog.shutdown()
```

The Anthropic and Gemini wrappers and the LangChain callback handler work the same way. Prompts and responses are stored up to 32 KB each. To keep them out, turn off **Store prompts and responses** in the website's AI observability settings, or use the wrappers' privacy mode so content never leaves your server. See [LLM analytics](/docs/llm-analytics).

## Check that it works

Send one event with `curl`:

```bash
curl -X POST https://t.flareboard.dev/capture/ \
  -H 'Content-Type: application/json' \
  -d '{"api_key": "YOUR_PROJECT_KEY", "event": "posthog_test", "distinct_id": "user_123"}'
```

The response is `{"status":1}`. Then open **Events** for the website and look for `posthog_test`. Events from your real SDK setup show up there too.

## Limits

| Limit | Value |
| --- | --- |
| Request body on the wire | 2 MB |
| Request body after decompression | 8 MB |
| Events per request | 1,000 |
| Requests per project key | 30,000 per minute by default, with a separate budget of the same size for flag requests |

Self-hosters can change the per-key limit with the ingest `PROJECT_KEY_RATE_LIMIT` variable. On Flareboard Cloud, events also count toward your plan's monthly allowance. See [Plans and limits](/docs/plans-limits). Request formats and every route are listed in the [Ingest API reference](/docs/reference/ingest-api).

## Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| `401` with `invalid_api_key` | The key is missing, mistyped, or was rotated. | Copy the key again from the website's **Settings**. |
| `400` with `No valid events` | Each event needs an event name and a `distinct_id`. | Check the event your code sends. |
| `402` | The monthly event allowance is used up. | Wait for next month or change plan. |
| `429` | The project key's rate limit was exceeded. | Send fewer, larger batches. |
| posthog-js tries to load files and fails | You used the CDN snippet. | Use the npm package. |
