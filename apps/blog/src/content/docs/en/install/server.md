---
title: Send events from your server
sidebarTitle: Server-side events
description: Send events, identify calls, errors and logs to Flareboard from your backend with plain HTTP requests, no SDK needed.
---

Use this when something happens on your server that the browser cannot see: a payment succeeded, a subscription renewed, a job finished. You send a JSON request to the ingest address. If you already use PostHog's server SDKs, [use those instead](/docs/install/posthog).

## Before you start

- A website in Flareboard. See the [Quickstart](/docs/quickstart).
- Its **project key**. Open **Websites**, then the website's **Settings**. The **Project API key** card shows it. See [Concepts](/docs/concepts#project-key).
- The ingest address: `https://t.flareboard.dev` on Flareboard Cloud. Self-hosters use their own.

The examples use `YOUR_PROJECT_KEY`. The website ID also works in its place, but a server should use the project key: requests that use it get a much higher rate limit (see [Limits](#limits)) and you can rotate it if it leaks.

## 1. Send an event

Make one request:

- **Method and URL:** `POST https://t.flareboard.dev/api/send`
- **Headers:** `Content-Type: application/json`
- **Authentication:** the key is the only credential. Put the project key (or website ID) in `payload.website`. No `Authorization` header is needed.

```bash
curl -X POST https://t.flareboard.dev/api/send \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "event",
    "payload": {
      "website": "YOUR_PROJECT_KEY",
      "hostname": "example.com",
      "url": "/billing",
      "name": "subscription_renewed",
      "id": "user_123",
      "data": { "plan": "pro", "seats": 5 }
    }
  }'
```

The response is `200` with ids you can ignore:

```json
{ "cache": "…", "sessionId": "…", "visitId": "…" }
```

### Event fields

The body is `{ "type": "<kind>", "payload": { … } }`. For `"type": "event"`, `payload` takes:

| Field | Type | What it does |
| --- | --- | --- |
| `website` | string, required | Your project key (`fb_pk_…`) or website ID (UUID). |
| `name` | string, up to 50 characters | The event name. Leave it out to record a pageview instead of a custom event. |
| `data` | object, up to 100 keys | Event properties. Send ids and plan names, not passwords or other personal data. |
| `id` | string, up to 128 characters | The user's distinct ID. See [How events are attributed](#how-events-are-attributed). |
| `url` | string | The path the event belongs to, for example `/billing`. Cut at 500 characters. |
| `hostname` | string, up to 100 characters | The site's hostname, for example `example.com`. |
| `referrer`, `title` | string | Page context. Cut at 500 characters. |
| `tag` | string, up to 50 characters | An optional label. |
| `revenue`, `currency` | number, string | Revenue for the event. Both are needed for it to be recorded. |
| `timestamp` | integer | When it happened, in seconds or milliseconds since the epoch. Use it to send events late. A time more than 90 days back or more than 5 minutes ahead is replaced with the time of receipt. |
| `ip`, `userAgent` | string | See [How events are attributed](#how-events-are-attributed). |

Unknown fields are ignored. Send `website` and leave out `link` and `pixel`, which belong to short links and tracking pixels.

## 2. Send other kinds of data

The same endpoint takes other `type` values. Each uses the same `payload.website`.

| `type` | Use it to | Main fields in `payload` |
| --- | --- | --- |
| `identify` | Create or update a person | `id`, `data` (profile properties) |
| `group` | Attach a user to a group such as a company | `id`, `groupType`, `groupKey`, `data` |
| `error` | Record an error | `message`, `errorName`, `stack`, `severity`, `handled`, `release`, `environment` |
| `log` | Record a structured log line | `level`, `message`, `traceId`, `spanId`, `service`, `release`, `environment` |
| `ai` | Record an LLM call | `provider`, `model`, `inputTokens`, `outputTokens`, `costUsd`, `latencyMs`, `status` |

An identify call looks like this:

```bash
curl -X POST https://t.flareboard.dev/api/send \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "identify",
    "payload": {
      "website": "YOUR_PROJECT_KEY",
      "id": "user_123",
      "data": { "plan": "pro" }
    }
  }'
```

For the full field list of every type, see the [Ingest API reference](/docs/reference/ingest-api). More on [Error tracking](/docs/error-tracking), [Logs and traces](/docs/logs-traces) and [LLM analytics](/docs/llm-analytics).

## 3. Send several events at once

`POST https://t.flareboard.dev/api/batch` takes a JSON array of the same `{ "type", "payload" }` objects. Each item is checked on its own, so some can succeed while others fail.

```bash
curl -X POST https://t.flareboard.dev/api/batch \
  -H 'Content-Type: application/json' \
  -d '[
    { "type": "event", "payload": { "website": "YOUR_PROJECT_KEY", "hostname": "example.com", "url": "/billing", "name": "invoice_paid", "id": "user_123" } },
    { "type": "event", "payload": { "website": "YOUR_PROJECT_KEY", "hostname": "example.com", "url": "/billing", "name": "invoice_paid", "id": "user_456" } }
  ]'
```

The response says what happened to each item:

```json
{ "size": 2, "processed": 2, "errors": 0, "details": [], "cache": "…" }
```

Failed items are listed in `details` as `{ "index": 0, "response": { "message": "…" } }`. A batch holds at most 50 items and 512 KB, and each item is limited to 64 KB.

## 4. Examples without an SDK

### Node.js

Node 18 and later have `fetch` built in:

```ts
const INGEST = 'https://t.flareboard.dev'

export async function trackServerEvent(name: string, userId: string, data: Record<string, unknown> = {}) {
  const res = await fetch(`${INGEST}/api/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'event',
      payload: {
        website: process.env.FLAREBOARD_PROJECT_KEY,
        hostname: 'example.com',
        url: '/server',
        name,
        id: userId,
        data,
      },
    }),
  })
  if (!res.ok) console.warn('Flareboard rejected the event', res.status, await res.text())
}

await trackServerEvent('subscription_renewed', 'user_123', { plan: 'pro' })
```

### Python

This uses the `requests` package (`pip install requests`):

```python
import os
import requests

INGEST = 'https://t.flareboard.dev'

def track_server_event(name, user_id, data=None):
    res = requests.post(
        f'{INGEST}/api/send',
        json={
            'type': 'event',
            'payload': {
                'website': os.environ['FLAREBOARD_PROJECT_KEY'],
                'hostname': 'example.com',
                'url': '/server',
                'name': name,
                'id': user_id,
                'data': data or {},
            },
        },
        timeout=5,
    )
    if not res.ok:
        print('Flareboard rejected the event', res.status_code, res.text)

track_server_event('subscription_renewed', 'user_123', {'plan': 'pro'})
```

Keep the call off your request path where you can: send from a queue or a background task, and do not let a failed call break your own code.

## How events are attributed

- **With `id`.** The event belongs to the visitor identified by that distinct ID. It gets the same visitor as browser events from the same user (after `flareboard.identify()` with that ID), so a server event and a browser event for `user_123` line up in one timeline. Use the same ID your frontend passes to `identify()`.
- **Without `id`.** Flareboard counts the visitor from a one-way hash of the IP address and user agent of your request, which is your server. All such events collapse into one "visitor". Always send `id` for server events.
- **`ip` and `userAgent`.** You can pass the end user's IP address and user agent in `payload` and Flareboard hashes them instead of your server's. The IP address is never stored. The user agent is used for the hash and to work out the browser, OS and device.
- **Visits.** Without a visit token, events for the same visitor fall into one visit per clock hour (UTC). You do not need to send the `cache` value from the response.
- **People.** Only an `identify` call creates or updates a profile under **People**. Send one when a user signs up or their plan changes.
- **Location.** Country and city come from the request, so server events get your server's location. Passing `ip` does not change that.

## Check that it works

1. Send the `curl` request from step 1.
2. Confirm the response is `200` and contains `sessionId` and `visitId`.
3. In the console, open **Events** for the website and look for your event name.

## Limits

| Limit | Value |
| --- | --- |
| Request body of `/api/send` | 64 KB |
| Batch | 50 items, 512 KB, 64 KB per item |
| Requests using a project key | 30,000 per minute per key, across all IPs (default; self-hosters can change it with `PROJECT_KEY_RATE_LIMIT`) |
| Events using a website ID | 100 requests per minute per IP address and website |
| Monthly events (Flareboard Cloud) | By plan. See [Plans and limits](/docs/plans-limits). |

## Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| `400` `Website not found.` | The website ID or project key is wrong, or the key was rotated. | Copy the key again from **Settings**. |
| `400` `Invalid JSON` | The body is not valid JSON. | Check the request body and the `Content-Type` header. |
| `400` `Payload too large` | The body is over 64 KB. | Send smaller payloads or use `/api/batch`. |
| `400` with a validation message | A field is too long or has the wrong type. | Compare it with the table above. |
| `402` `Monthly event limit exceeded.` | The plan's monthly allowance is used up (Cloud only). | Wait for next month or change plan. |
| `429` `Rate limit exceeded` | Too many requests. | Use the project key instead of the website ID, and batch events. |
| `200` with `{"beep":"boop"}` | The request was ignored because its user agent looks like a crawler. | Use your HTTP client's default user agent. |
