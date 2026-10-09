---
title: LLM analytics
description: Record LLM calls with PostHog's LLM wrappers or flareboard.ai(), then see cost, tokens, latency and errors per model, trace and user on the AI observability page.
---

Flareboard records each LLM call as an AI event and turns them into cost, token, latency and error charts, a list of traces with every step, and cost per user. There are two ways to send the data, and both end up in the same place:

- **PostHog LLM wrappers** (posthog-python, posthog-node, the LangChain callback) pointed at Flareboard.
- **Flareboard's own call**: `flareboard.ai()` in the browser script or npm package, or a `POST` to `/api/send` from your server.

## Before you start

- A website in Flareboard. See the [Quickstart](/docs/quickstart).
- Its **project key** (`fb_pk_…`). Open **Websites**, then the website's **Settings**. The **Project API key** card shows it. See [Concepts](/docs/concepts#project-key).
- The ingest address: `https://t.flareboard.dev` on Flareboard Cloud. Self-hosters use their own.

AI events are stored as events, so they count toward your monthly event allowance. See [Plans and limits](/docs/plans-limits).

## 1. Send LLM calls with the PostHog wrappers

Use the ingest address as the PostHog host and the project key as the PostHog API key. The general setup is in [PostHog SDKs](/docs/install/posthog).

### Python (OpenAI)

```python
from posthog import Posthog
from posthog.ai.openai import OpenAI

posthog = Posthog("YOUR_PROJECT_KEY", host="https://t.flareboard.dev")
client = OpenAI(api_key="YOUR_OPENAI_API_KEY", posthog_client=posthog)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "What is Flareboard?"}],
    posthog_distinct_id="user_123",        # the user the call is attributed to
    posthog_trace_id="conversation-42",    # groups calls into one trace
    posthog_properties={"feature": "chat"},
)
posthog.shutdown()
```

The Anthropic and Gemini wrappers and the LangChain `CallbackHandler` work the same way. The LangChain handler sends the whole trace, span and generation tree.

### Node.js (OpenAI)

```js
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

### Capture API (curl)

```bash
curl -X POST https://t.flareboard.dev/batch/ \
  -H 'Content-Type: application/json' \
  -d '{
    "api_key": "YOUR_PROJECT_KEY",
    "batch": [{
      "event": "$ai_generation",
      "distinct_id": "user_123",
      "properties": {
        "$ai_trace_id": "conversation-42",
        "$ai_model": "gpt-4o-mini",
        "$ai_provider": "openai",
        "$ai_input": [{"role": "user", "content": "What is Flareboard?"}],
        "$ai_output_choices": [{"role": "assistant", "content": "An analytics platform."}],
        "$ai_input_tokens": 12,
        "$ai_output_tokens": 6,
        "$ai_latency": 0.84,
        "$ai_http_status": 200
      }
    }]
  }'
```

### PostHog properties Flareboard reads

| PostHog property | Stored as | Notes |
| --- | --- | --- |
| Event name: `$ai_generation`, `$ai_span`, `$ai_trace`, `$ai_embedding` | Kind: `generation`, `span`, `trace`, `embedding` | A `$ai_trace` is its own span |
| `$ai_trace_id`, `$ai_span_id`, `$ai_parent_id` | Trace ID, span ID, parent span ID | |
| `$ai_span_name` (or `$ai_trace_name`) | Span name | |
| `$ai_model`, `$ai_provider` | Model, provider | The provider is lower-cased |
| `$ai_input_tokens`, `$ai_output_tokens` | Input, output and total tokens | |
| `$ai_cache_read_input_tokens`, `$ai_cache_creation_input_tokens` | Cache read and cache write tokens | |
| `$ai_reasoning_tokens` | Reasoning tokens | |
| `$ai_total_cost_usd` (or `$ai_input_cost_usd` plus `$ai_output_cost_usd`) | Cost in USD | A cost you send is used as it is |
| `$ai_latency` | Latency | In seconds in PostHog, stored in milliseconds |
| `$ai_http_status`, `$ai_is_error`, `$ai_error` | HTTP status, status, error message | A call is an error when `$ai_is_error` is true, else when the HTTP status is 400 or above, else when `$ai_error` is set |
| `$ai_input` or `$ai_input_state` | Prompt content | See [Content](#content) |
| `$ai_output_choices`, `$ai_output` or `$ai_output_state` | Response content | See [Content](#content) |

Other `$ai_*` values that are plain strings, numbers or booleans (such as `$ai_stream`) and your own properties are kept as they are. `$ai_tools` is not stored. `$ai_metric` and `$ai_feedback` events are stored as ordinary custom events.

## 2. Send LLM calls with `flareboard.ai()`

In the browser, with the tracking script or the npm package:

```js
flareboard.ai({
  model: 'claude-sonnet-4-5',
  provider: 'anthropic',
  inputTokens: 1200,
  outputTokens: 300,
  cacheReadTokens: 4000,
  latencyMs: 2100,
  traceId: 'conversation-42',
  spanId: 'answer',
  parentSpanId: 'conversation-42',
  input: [{ role: 'user', content: '…' }],
  output: '…',
});
```

After `flareboard.identify()`, the call is attributed to that user. Without it, Flareboard groups the call under the anonymous visitor.

From your server, send `"type": "ai"` to `/api/send`:

```bash
curl -X POST https://t.flareboard.dev/api/send \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "ai",
    "payload": {
      "website": "YOUR_PROJECT_KEY",
      "id": "user_123",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "inputTokens": 1200,
      "outputTokens": 300,
      "latencyMs": 2100,
      "traceId": "conversation-42",
      "status": "success"
    }
  }'
```

The response is `200`. For the rest of the endpoint (batching, limits, how `id` attributes the call), see [Send events from your server](/docs/install/server).

### Fields

| Field | Type | What it does |
| --- | --- | --- |
| `kind` | `generation` (default), `span`, `trace` or `embedding` | What the record is. Use `span` or `trace` for steps that are not model calls |
| `model` | string, up to 120 characters | The model ID. Needed for pricing. A generation without one is recorded under `name`, or `unknown` |
| `provider` | string, up to 80 characters | For example `openai` or `anthropic` |
| `name` | string, up to 50 characters | The event name |
| `inputTokens`, `outputTokens` | integer | Token counts. `totalTokens` is their sum when you leave it out |
| `totalTokens`, `cacheReadTokens`, `cacheWriteTokens` | integer | Optional token counts |
| `costUsd` | number | Cost in USD. Leave it out to have Flareboard price the call |
| `latencyMs` | integer | Duration in milliseconds |
| `status` | `success` (default) or `error` | Outcome |
| `message` | string | The error message when `status` is `error` |
| `traceId`, `spanId`, `parentSpanId` | string, up to 200 characters | Build the trace tree |
| `operation` | string, up to 200 characters | The span name |
| `quality` | string, up to 80 characters | A label you can filter by |
| `input`, `output` | any JSON | The prompt and the response. See [Content](#content) |
| `release`, `environment` | string | Deployment context |
| `data` | object | Extra properties |
| `id` | string, up to 128 characters | The user the call belongs to. The browser script fills it in from `identify()` |

## 3. What Flareboard records

For each call: the model and provider, input, output, cached and reasoning tokens, cost, latency, status and error message, its place in a trace, and the user and session behind it. Failed calls count toward the error rate and keep their error message.

### Content

The prompt and response (`input` and `output`) are stored up to 32 KB each. Longer content is cut and ends with a marker saying how many bytes the original had. The trace view shows a truncated badge.

Prompts can contain personal data. To stop storing them, open **AI observability**, then **Settings**, and turn off **Store prompts and responses**. Flareboard then keeps only metadata: model, tokens, cost, latency, status and trace IDs. The change applies to new events within about a minute. Content already stored stays until the website's data retention removes it. The wrappers' own privacy mode (`posthog_privacy_mode` in Python, `posthogPrivacyMode` in Node) keeps content from leaving your server at all.

### How cost is calculated

Cost is calculated when you view it, not when the call arrives, so a corrected price changes past numbers without a re-import. For each call:

1. A cost sent with the call (`costUsd`, `$ai_total_cost_usd`, or the input and output costs added up) is used as it is.
2. Otherwise, your own price for that model, set under **AI observability**, **Settings**, **Model prices**. Prices are in USD per 1M tokens, and a model ID without a date matches all its dated versions.
3. Otherwise, Flareboard's built-in list price for the model.

A model with no price is shown as **Unpriced** and is left out of the cost. It is never priced by guessing from a similar name. Add a price under **Model prices** to include it (**Add price**, then set **Model ID**, **Input / 1M**, **Output / 1M** and optionally **Cached input / 1M** and **Cache write / 1M**).

Model IDs are matched after normalizing: lower case, without vendor prefixes such as `openai/`, Bedrock and Vertex decorations, date suffixes or `-latest`.

Cached tokens: for most models (OpenAI, Gemini and others), cached tokens are counted inside the input tokens, so Flareboard charges them at the cache price and removes them from the regular input. For Claude models they are reported separately, unless the provider is `openai`, `openrouter`, `litellm` or `azure`, which report Claude usage the OpenAI way. If a model has no cache price, cached tokens are charged at the input price.

DeepSeek charges half price off-peak. The built-in list uses the peak price, so DeepSeek costs are an upper bound unless you set your own price.

## 4. Read the data

Open the website, then **AI observability** (under **Quality**). Choose a date range at the top. Four tabs:

- **Overview**: **Cost**, **Generations** (with the trace count), **Tokens**, **p50 latency** (with p95), **Error rate** and **Users**. Below are charts of cost, generations and errors, and latency (p50 and p95), then **Cost by model**, a **Models** table (model, provider, generations, input and output tokens, cost, error rate, average latency) and a **Breakdown**. Filter by model, provider, status, release, environment and quality. Filters appear when there is more than one value to choose from.
- **Traces**: each trace with its start, latency, generations, tokens, cost, user and status. Filter by model, user, error status and cost range (**Min cost ($)**, **Max cost ($)**). A call without a trace ID is a trace of its own. Open a trace to see a **Timeline** of its steps. Select a step to see its **Input**, **Output** and **Properties**.
- **Users**: cost and usage per user, with generations, traces, tokens, errors, models and last seen. Anonymous visitors are grouped by visitor. **View traces** opens that user's traces.
- **Settings**: **Store prompts and responses** and **Model prices**. Changing them needs edit access to the website.

## Check that it works

1. Send one call with the `curl` example in step 2, with your own project key.
2. Confirm the response is `200`.
3. Open **AI observability**. The call shows in **Overview** within a few seconds. If its model is **Unpriced**, add a price under **Settings**.

## Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| **No AI calls in this period** | Nothing arrived, or the date range is too narrow | Widen the range. Check the host and key in your SDK |
| `400` `Website not found.` | The project key is wrong or was rotated | Copy the **Project API key** from **Settings** again |
| Cost shows **Unpriced** | The model ID is not in the built-in list and you set no price | Add a price under **Model prices**, or send `costUsd` |
| Prompts are missing in a trace | **Store prompts and responses** is off | Turn it on. It applies to new events only |
| `402` `Monthly event limit exceeded.` | The plan's monthly event allowance is used up (Cloud only) | Wait for next month or change plan |
