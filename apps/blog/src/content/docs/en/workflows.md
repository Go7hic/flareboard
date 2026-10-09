---
title: Workflows
description: Run automations when an event happens. Filter, wait, branch on conditions, then call a webhook, send an email or post to Slack, with tests, run history and retries.
---

A workflow starts when a named event arrives, for example `checkout_completed` or `signup`. It then runs a list of steps in order: wait, check a condition, call a webhook, send an email, or post to Slack. You can test a workflow against a sample event before it goes live, and every run is logged.

## Before you start

- A website that already sends the event you want to react to. See [Track events](/docs/events).
- Edit access to the website. With read-only access you can see workflows and runs, but not create, test or change them. Header values and Slack URLs are hidden from read-only users.
- Self-hosters only: email steps need email sending to be set up on your deployment. See [Configuration](/docs/self-host/configuration).

Events from the tracking script, the server API and PostHog SDKs can all start a workflow. A plain pageview has no name, so it cannot. Workflows need no particular plan.

## 1. Create a workflow

1. Open the website, then **Workflows** (under **Automation**).
2. Click **Create workflow**.
3. Enter a **Name**, and choose the **Trigger event** (the event name, such as `checkout_completed`). The picker lists events the website has received. An optional **Description** says what the workflow is for.
4. Add **Trigger filters** if you want it to run for only some events (see below).
5. Add **Steps**.
6. Click **Create workflow**.

If the workflow has a webhook step, Flareboard shows its **Webhook signing secret** once, on the workflow's **Overview** right after you create it. Copy it then. See [Verify a webhook](#verify-a-webhook).

Use **Enable** and **Disable** on a workflow to turn it on and off. Unfinished runs of a disabled workflow are cancelled before their next step. A workflow with no steps only records its runs.

### Trigger filters

Filters narrow which events start the workflow. All filters must match. A workflow can have up to 20.

| Field | Matches |
| --- | --- |
| **Event property** | A property of the event. Enter the property name as the key |
| **Person property** | A property of the person who sent the event. Enter the property name as the key |
| **Path** | The page path of the event |
| **URL** | The full page URL |
| **Hostname** | The page hostname |

Operators: **equals**, **does not equal**, **contains**, **does not contain**, **starts with**, **ends with**, **greater than**, **at least**, **less than**, **at most**, **is set** and **is not set**. Text comparisons ignore case, and the numeric operators need a number.

### Steps

Steps run in order. A workflow can have up to 20 steps, and up to 10 of them can be webhook, email or Slack steps.

**Delay.** Waits from 1 minute to 7 days. All delays in one workflow together can add up to at most 30 days.

**Condition.** Continues only if every condition holds when the step runs. Person properties are read again at that moment, so a condition after a delay sees fresh data. If a condition does not hold, the run stops there with the status **Stopped**.

**Webhook.** Sends an HTTP request.

| Setting | What it does |
| --- | --- |
| **Method** | `POST` (default), `PUT`, `PATCH`, `GET` or `DELETE`. `GET` and `DELETE` send no body |
| **URL** | A public `http` or `https` address. Private, loopback and internal hosts, IPv6 literals and URLs with credentials are refused |
| **Headers** | Up to 20. Names such as `Host`, `Content-Length`, `User-Agent`, `Cookie`, and any name starting with `X-Flareboard-` or `CF-`, are set by Flareboard and refused |
| **JSON body** | A template of up to 10,000 characters. Leave it empty to send the default payload below |

**Email.** Sends a plain-text email to up to 5 **Recipients**, with a **Subject** and a **Message**. Leave them empty to use the defaults: the subject `Flareboard workflow: {{workflow.name}}` and a short message with the event name, page and time. Flareboard adds a footer saying which workflow sent it.

**Slack.** Posts a **Message** (up to 3,000 characters) to a Slack incoming webhook. The URL must start with `https://hooks.slack.com/` or `https://hooks.slack-gov.com/`. Values you insert are escaped so a property cannot add mentions or links.

### Placeholders

Use `{{name}}` placeholders in webhook header values and JSON bodies, email subjects and messages, and Slack messages. Webhook and Slack URLs are not templated. Click a placeholder in the editor to insert it into the field you edited last.

| Placeholder | Value |
| --- | --- |
| `{{event.name}}`, `{{event.id}}`, `{{event.timestamp}}` | The event name, its ID and its time (ISO 8601) |
| `{{event.url}}`, `{{event.path}}`, `{{event.hostname}}` | The page |
| `{{event.distinct_id}}`, `{{event.session_id}}` | The user ID and session |
| `{{event.properties.KEY}}` | An event property. Replace `KEY` with its name. Nested values work, for example `{{event.properties.plan.tier}}` |
| `{{person.distinct_id}}`, `{{person.properties.KEY}}` | The person and one of their properties |
| `{{website.id}}`, `{{website.name}}`, `{{website.domain}}` | The website |
| `{{workflow.id}}`, `{{workflow.name}}`, `{{execution.id}}` | The workflow and this run |

In a JSON body, a placeholder inside a quoted string is inserted as escaped text. A placeholder outside quotes is inserted as a JSON value, so `"amount": {{event.properties.amount}}` sends a number. A missing value becomes `null`. Flareboard checks that the body is valid JSON and that every placeholder is known when you save.

Event properties are carried into a run only when they are 32 KB or smaller.

### Default webhook payload

With an empty body, a webhook sends:

```json
{
  "type": "workflow",
  "workflowId": "…",
  "workflowName": "Notify sales",
  "executionId": "…",
  "websiteId": "…",
  "sessionId": "…",
  "visitId": "…",
  "eventId": "…",
  "eventName": "checkout_completed",
  "createdAt": 1760000000000,
  "event": {
    "name": "checkout_completed",
    "timestamp": "2026-10-09T10:13:20.000Z",
    "url": "https://example.com/checkout",
    "path": "/checkout",
    "hostname": "example.com",
    "distinctId": "user_123",
    "properties": { "plan": "pro" }
  },
  "person": { "distinctId": "user_123", "properties": {} },
  "website": { "id": "…", "name": "My site", "domain": "example.com" }
}
```

`person` is `null` when the event has no user ID.

### Request headers

Every webhook request carries these headers:

| Header | Value |
| --- | --- |
| `User-Agent` | `Flareboard-Webhooks/1.0 (+https://flareboard.dev)` |
| `Content-Type` | `application/json`, when there is a body and you set no content type |
| `X-Flareboard-Event` | The event name |
| `X-Flareboard-Delivery` | An ID for the step's delivery, the same on every attempt. Use it to drop duplicates |
| `X-Flareboard-Execution` | The run ID |
| `X-Flareboard-Attempt` | The attempt number, starting at 1 |
| `X-Flareboard-Timestamp` | Unix time in seconds |
| `X-Flareboard-Signature` | `v1=` followed by the HMAC, see below |
| `X-Flareboard-Test` | `1`, only on test sends |

### Verify a webhook

The signature is `v1=` plus the hex of `HMAC-SHA256(secret, "<X-Flareboard-Timestamp>.<raw body>")`, using the workflow's signing secret (it starts with `whsec_`). Recompute it over the raw request body and reject old timestamps:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyFlareboard(rawBody, headers, secret) {
  const timestamp = headers['x-flareboard-timestamp'];
  const received = headers['x-flareboard-signature'] ?? '';
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

To get a new secret, open the workflow, go to **Overview** and click **Rotate secret**. The old secret stops working at once, including for retries of deliveries that are still pending, so update your receiver right after. The signing secret section appears when the workflow has a webhook step.

## 2. Test a workflow

Open the workflow, then the **Test** tab (you need edit access).

1. Click **Load latest event** to fill the form from the most recent stored event with the trigger name, or fill it in: **Page URL or path**, **Distinct ID** (optional, loads that person's stored properties), **Event properties (JSON)** and **Person property overrides (JSON)**.
2. Click **Preview** to render every step without sending anything, or **Send test** to deliver each webhook, email and Slack step once.

The result says whether the sample event matches the trigger filters (if it does not, no step would run), and shows each step as **Rendered**, **Sent**, **Passed**, **Stops here**, **Failed**, **Skipped** or **Not reached**. Sent steps show the response code and body. Delays are skipped, and test runs are not logged. Webhook tests carry the header `X-Flareboard-Test: 1`. A website can send up to 30 test sends an hour.

## 3. Read the run history

Open the workflow, then **Overview** for the flow, a runs-per-day chart, the success rate and a status breakdown. Open **Runs** to see every time the trigger fired, newest first.

- Filter by status, by dates (**From** and **To**) or search by event, session or error.
- Expand a run (**Show step details**) to see each step, each attempt, the response code and body, the time of the next attempt, and when a waiting run continues.

Run statuses:

| Status | Meaning |
| --- | --- |
| **Recorded** | The workflow has no steps, so the run was only recorded |
| **Queued**, **Running** | About to run, or running |
| **Waiting** | In a delay step |
| **Retrying** | A delivery failed and will be tried again |
| **Succeeded** | All steps finished |
| **Failed** | A step failed for good, or ran out of attempts |
| **Stopped** | A condition step did not hold |
| **Throttled** | A delivery was refused because the website passed 60 deliveries in an hour, and the run ended |
| **Cancelled** | The workflow was disabled or deleted before the run finished |

Runs and their attempt logs are kept for 90 days. Deleting a workflow deletes its log and stops pending runs.

## Limits and retries

| Limit | Value |
| --- | --- |
| Runs started per website | 1,000 per hour. More triggers are dropped |
| Deliveries per website (first attempts of webhook, email and Slack steps) | 60 per hour. Retries do not count |
| Triggers from one client IP | 30 per minute overall, and 10 per hour for one website. Events sent from your server count against your server's IP |
| Webhook and Slack request time | 10 seconds. A slower request counts as a failed attempt |
| Attempts per delivery | 5, with waits of 30 seconds, 2 minutes, 8 minutes and 32 minutes |
| Steps | 20, at most 10 of them webhook, email or Slack |
| Delay | 1 minute to 7 days per step, 30 days per workflow |

A delivery is retried after a network error, a timeout, or a response of `408`, `425`, `429` or any `5xx`. Other `4xx` responses are permanent failures, such as a wrong URL or a rejected credential.

## Check that it works

1. Create a workflow with a Slack, webhook or email step.
2. Open **Test**, click **Load latest event** and click **Send test**. Confirm the result is **Sent** and that your destination received it.
3. Turn the workflow on, trigger the real event, and open **Runs**. The run shows **Succeeded**.

## Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| No runs appear | The event name differs, a filter does not match, or the workflow is disabled | Compare the trigger with the name in **Events**. Use **Test** to see if the sample event matches |
| **Throttled** | The website passed 60 deliveries in an hour | Reduce triggers, or add a condition step to narrow them |
| Failed with `4xx` | The destination rejected the request | Check the URL, headers and body in the run's step details |
| **Rendered body is not valid JSON** | A placeholder or the template broke the JSON | Test with **Preview** and fix the body |
| Email step fails with an email sending message | Email sending is not set up on this deployment | Self-hosters: set up email sending. See [Configuration](/docs/self-host/configuration) |
| Signature check fails | You hashed a parsed body, or the secret was rotated | Hash the raw body, and use the current secret |
