# LLM analytics

Flareboard records LLM calls as AI events and shows them under *Website → AI observability*:
cost, tokens, generations, latency (p50/p95) and error rate over time; a traces list; a trace
tree with a timing waterfall and the input/output of every step; and cost per user.

There are two ways to send data. Both end up in the same model.

- **PostHog LLM wrappers** (posthog-python, posthog-node, LangChain callbacks) pointed at the
  Flareboard ingest host with the website's project key (`fb_pk_…`). They send `$ai_generation`,
  `$ai_span`, `$ai_trace` and `$ai_embedding` events.
- **Flareboard's own API**: `flareboard.ai({ … })` from the tracker or `@flareboard/js`, or
  `POST /api/send` with `type: "ai"` from a server.

## PostHog SDKs

Use the ingest host (the one serving `script.js`) as the PostHog host and the project key as the
API key. See [ingest-posthog-compat.md](./ingest-posthog-compat.md) for the general setup.

### Python (OpenAI)

```python
from posthog import Posthog
from posthog.ai.openai import OpenAI

posthog = Posthog("fb_pk_…", host="https://ingest.example.com")
client = OpenAI(api_key="sk-…", posthog_client=posthog)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "What is Flareboard?"}],
    posthog_distinct_id="user_123",        # the user the call is attributed to
    posthog_trace_id="conversation-42",    # groups calls into one trace
    posthog_properties={"feature": "chat"},
)
posthog.shutdown()
```

`posthog.ai.anthropic.Anthropic`, the Gemini wrapper and `posthog.ai.langchain.CallbackHandler`
work the same way (the LangChain handler sends the trace, span and generation tree).

### Node (OpenAI)

```js
import { PostHog } from 'posthog-node'
import { OpenAI } from '@posthog/ai'

const posthog = new PostHog('fb_pk_…', { host: 'https://ingest.example.com' })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, posthog })

await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'What is Flareboard?' }],
  posthogDistinctId: 'user_123',
  posthogTraceId: 'conversation-42',
})
await posthog.shutdown()
```

Setting the wrappers' privacy mode (`posthog_privacy_mode` / `posthogPrivacyMode`) keeps content
from leaving your server at all; the website setting below drops it at ingest instead.

### curl (capture API)

```bash
curl -X POST https://ingest.example.com/batch/ \
  -H 'Content-Type: application/json' \
  -d '{
    "api_key": "fb_pk_…",
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

### Mapped properties

| PostHog property | Flareboard property | Notes |
|------------------|---------------------|-------|
| event name | `aiKind` | `generation`, `span`, `trace`, `embedding` |
| `$ai_trace_id`, `$ai_span_id`, `$ai_parent_id` | `traceId`, `spanId`, `parentSpanId` | a `$ai_trace` is its own span (`spanId` = trace id) |
| `$ai_span_name` (or `$ai_trace_name`) | `spanName` | |
| `$ai_model`, `$ai_provider` | `model`, `provider` | provider lower-cased |
| `$ai_input_tokens`, `$ai_output_tokens` | `inputTokens`, `outputTokens`, `totalTokens` | |
| `$ai_cache_read_input_tokens`, `$ai_cache_creation_input_tokens` | `cacheReadTokens`, `cacheWriteTokens` | |
| `$ai_reasoning_tokens` | `reasoningTokens` | |
| `$ai_total_cost_usd` (or input + output cost) | `costUsd` | a sent cost is used as-is |
| `$ai_latency` (seconds) | `latencyMs` | |
| `$ai_http_status`, `$ai_is_error`, `$ai_error` | `httpStatus`, `status`, `aiError` | error when `$ai_is_error`, else HTTP status ≥ 400 |
| `$ai_base_url` / `$ai_request_url` | `baseUrl` | |
| `$ai_model_parameters` | `aiModelParams` | JSON, up to 2000 chars |
| `$ai_input` / `$ai_input_state` | `aiInput` | content, see below |
| `$ai_output_choices` / `$ai_output` / `$ai_output_state` | `aiOutput` | content, see below |

Other primitive `$ai_*` properties (`$ai_stream`, `$ai_temperature`, …) and your own properties are
kept as they are. `$ai_tools` is not stored. `$ai_metric` and `$ai_feedback` events are stored as
ordinary custom events.

## Flareboard API

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
})
```

Server side, send the same fields as `POST /api/send` with `{"type": "ai", "payload": {"website":
"fb_pk_…", …}}` (see [ingest.md](./ingest.md#ai-observability-type-ai)). Use `kind: "span"` or
`kind: "trace"` for non-LLM steps and `operation` for their name.

## Content and size limits

- Prompt and response content (`aiInput`, `aiOutput`) is capped at **32 KB each** (UTF-8). Longer
  payloads are cut and end with `…[truncated by Flareboard: N bytes, first M kept]`; the trace view
  shows a "truncated" badge.
- *AI observability → Settings → Store prompts and responses* turns content off for a website.
  Ingest then keeps only metadata and marks events with `aiContentOmitted`. The setting is cached
  (KV `llm-settings:<websiteId>`, cleared on change) and applies to new events within about a
  minute. Content already stored is not rewritten; it follows the website's retention.

## Cost

Cost is computed when the data is read, not at ingest:

1. a cost sent with the event (`costUsd`, `$ai_total_cost_usd`, `$ai_input_cost_usd` +
   `$ai_output_cost_usd`) is used as-is;
2. otherwise the website's price overrides (*Settings → Model prices*, USD per 1M tokens);
3. otherwise the built-in list prices in `packages/shared/src/llm.ts` (`LLM_PRICE_TABLE`, with its
   review date).

DeepSeek (`deepseek-flash`, `deepseek-v4-pro`) charges half price off-peak. Costs are computed on
per-model sums, not per call, so the table uses the peak rate: DeepSeek costs are an upper bound.
Set a website override with the off-peak rate if most of your traffic runs off-peak.

Computing at read time means fixing a price or adding an override changes past costs at once
without a backfill, and ingest does not read prices on the hot path. SQL sums unpriced tokens per
model, so it stays cheap.

Model ids are matched exactly after normalizing (lower case; vendor prefixes such as `openai/`,
Bedrock `anthropic.` and `-v1:0`, Vertex `@date`, date suffixes and `-latest` removed). A model
that is not found is **unpriced**: it counts in "Unpriced", never at a guessed price.

Cached tokens: OpenAI, Gemini and DeepSeek count cached tokens inside the input count, so they are charged at
the cache price and removed from the regular input; Anthropic (also on Bedrock/Vertex) reports them
separately. Without a cache price, cached tokens are charged at the input price.

## API

| Method | Path | |
|--------|------|-|
| GET | `/api/websites/:id/ai-observability` | overview stats + recent calls (`startAt`, `endAt`, `model`, `provider`, `status`, `release`, `environment`, `quality`, `distinctId`) |
| GET | `/api/websites/:id/ai-observability/traces` | traces; also `error=true|false`, `minCost`, `maxCost`, `limit` |
| GET | `/api/websites/:id/ai-observability/traces/:traceId` | trace tree; `at` (ms) searches a day either side, else the last 30 days |
| GET | `/api/websites/:id/ai-observability/users` | cost and usage per user |
| GET / PUT | `/api/websites/:id/ai-observability/settings` | `captureContent`, `priceOverrides` (PUT replaces the list) |
