---
title: Logs and traces
description: Send OpenTelemetry logs and traces to Flareboard over OTLP/HTTP, or log from the browser, then search, tail and alert on them in the console.
---

Flareboard is an OTLP/HTTP receiver. Point any OpenTelemetry SDK or the OpenTelemetry Collector at your ingest address and your backend logs and traces appear on the website's **Logs** page, next to log lines sent from the browser with `flareboard.log()`. You can search them, follow a trace, jump to the visitor session behind a line and get alerted when a kind of line becomes frequent.

## Before you start

- A website in Flareboard. See the [Quickstart](/docs/quickstart).
- Its **project key** (`fb_pk_…`). Open **Websites**, then the website's **Settings**. The **Project API key** card shows it. See [Concepts](/docs/concepts#project-key).
- The ingest address: `https://t.flareboard.dev` on Flareboard Cloud. Self-hosters use their own.
- Self-hosters only: OTLP needs the per-website stores (`EVENT_STORE` set to `dual` or `do`). With the legacy `d1` mode the endpoints answer `501`.

## 1. Send logs and traces over OTLP

### Endpoints

| Signal | Method and URL | Content types |
| --- | --- | --- |
| Logs | `POST https://t.flareboard.dev/v1/logs` | `application/x-protobuf` or `application/json` |
| Traces | `POST https://t.flareboard.dev/v1/traces` | `application/x-protobuf` or `application/json` |

Both accept `Content-Encoding: gzip`. gRPC is not supported, so use the `http/protobuf` or `http/json` protocol. Metrics (`/v1/metrics`) are not accepted.

### Authentication

Send the project key in one of two headers:

- `Authorization: Bearer YOUR_PROJECT_KEY`
- `x-flareboard-key: YOUR_PROJECT_KEY`

A website ID is not accepted here. If you rotate the key in **Settings**, the old one stops working within minutes. The project key is public by design (the tracker uses the same one), so it is fine in a browser bundle.

### Environment variables

Every OpenTelemetry SDK reads the standard exporter variables:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://t.flareboard.dev
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer%20YOUR_PROJECT_KEY"
OTEL_EXPORTER_OTLP_COMPRESSION=gzip
OTEL_SERVICE_NAME=checkout-api
OTEL_RESOURCE_ATTRIBUTES="service.version=2.4.1,deployment.environment.name=production"
OTEL_LOGS_EXPORTER=otlp
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=none
```

The SDK adds `/v1/logs` and `/v1/traces` to the endpoint itself. Header values in `OTEL_EXPORTER_OTLP_HEADERS` are URL-encoded, so the space after `Bearer` is `%20`. Flareboard accepts both encodings. Use `http/json` instead of `http/protobuf` if you prefer JSON, except with the Python SDK, which only exports `http/protobuf` over HTTP.

### Node.js

Install the OpenTelemetry auto-instrumentation package, set the variables above and start your app with it preloaded:

```bash
npm install @opentelemetry/api @opentelemetry/auto-instrumentations-node
NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register" node server.js
```

### Python

Install the OpenTelemetry distro, the OTLP HTTP exporter and the instrumentations for the libraries your app uses, set the variables above and start your app through `opentelemetry-instrument`:

```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp-proto-http
opentelemetry-bootstrap -a install
export OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED=true
opentelemetry-instrument python app.py
```

### OpenTelemetry Collector

```yaml
receivers:
  otlp:
    protocols:
      grpc:
      http:

processors:
  batch:
    send_batch_size: 2048
    send_batch_max_size: 4096   # stay under the 10,000 records per request limit
    timeout: 5s

exporters:
  otlphttp/flareboard:
    endpoint: https://t.flareboard.dev
    headers:
      Authorization: Bearer YOUR_PROJECT_KEY
    compression: gzip
    encoding: proto             # or json

service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/flareboard]
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/flareboard]
```

### curl

Send one log record as JSON. The timestamp must be within the last 30 days:

```bash
curl -X POST https://t.flareboard.dev/v1/logs \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_PROJECT_KEY' \
  -d '{
    "resourceLogs": [{
      "resource": { "attributes": [
        { "key": "service.name", "value": { "stringValue": "checkout-api" } },
        { "key": "deployment.environment.name", "value": { "stringValue": "production" } }
      ] },
      "scopeLogs": [{
        "scope": { "name": "manual-test" },
        "logRecords": [{
          "timeUnixNano": "'"$(date +%s)"'000000000",
          "severityNumber": 17,
          "severityText": "ERROR",
          "body": { "stringValue": "Payment failed" },
          "attributes": [ { "key": "order.id", "value": { "stringValue": "ord_123" } } ]
        }]
      }]
    }]
  }'
```

Send one span to `/v1/traces` the same way:

```bash
curl -X POST https://t.flareboard.dev/v1/traces \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_PROJECT_KEY' \
  -d '{
    "resourceSpans": [{
      "resource": { "attributes": [
        { "key": "service.name", "value": { "stringValue": "checkout-api" } }
      ] },
      "scopeSpans": [{
        "scope": { "name": "manual-test" },
        "spans": [{
          "traceId": "5b8efff798038103d269b633813fc60c",
          "spanId": "eee19b7ec3c1b174",
          "name": "POST /checkout",
          "kind": 2,
          "startTimeUnixNano": "'"$(date +%s)"'000000000",
          "endTimeUnixNano": "'"$(date +%s)"'250000000",
          "status": { "code": 1 }
        }]
      }]
    }]
  }'
```

A successful request returns `200` with an empty JSON object (`{}`).

### How OpenTelemetry fields are mapped

| OpenTelemetry | In Flareboard |
| --- | --- |
| Resource `service.name`, `service.version` | Service and release |
| Resource `deployment.environment.name` (or `deployment.environment`) | Environment |
| Other resource attributes | Shown under **Resource** in the log detail, and filterable |
| `severityNumber` (1 to 4 trace, up to 21 to 24 fatal), else `severityText`, else info | Level: `trace`, `debug`, `info`, `warn`, `error` or `fatal` |
| `body` | Message. A body that is not a string is stored as JSON |
| Log and span attributes | Attributes, filterable as `key=value` |
| `traceId`, `spanId` | Links a log line to its trace |
| Attribute `session.id`, `session_id` or `$session_id` (record first, then resource) | Links the line or trace to a Flareboard session and its replay |
| Instrumentation scope | Scope, as `name@version` |
| Span name, kind, start and end time, status, events and links | Span waterfall and span detail |

Timestamps come from `timeUnixNano`, then `observedTimeUnixNano`, then the time of receipt. A record stamped more than a day in the future is stored at its receipt time. A record older than 30 days is rejected and reported in `partialSuccess`.

### Limits

| Limit | Value |
| --- | --- |
| Request body, compressed or not | 4 MB |
| Body after decompression | 8 MB |
| Log records or spans per request | 10,000 (`413` above) |
| Attributes per record, span, event or link | 128. More are dropped. Drops on records and spans are reported in `partialSuccess` |
| Attribute key length | 256 characters |
| Attribute value length | 4,096 characters |
| Log body length | 32 KB |
| Events and links per span | 128 each |
| Requests per project key | 30,000 per minute by default, a budget separate from event capture. Self-hosters can change it with `PROJECT_KEY_RATE_LIMIT` |

### Responses

Responses follow the OTLP/HTTP specification, in the encoding of your request.

- `200`: stored. When some records were rejected or attributes were dropped, the body carries `partialSuccess` with `rejectedLogRecords` (or `rejectedSpans`) and an `errorMessage`.
- `400`: malformed body.
- `401`: missing or unknown project key.
- `402`: your monthly log and span allowance is used up (Cloud only).
- `413`: request too large.
- `415`: unsupported `Content-Type` or `Content-Encoding`.
- `429`: rate limited, with a `Retry-After` header.
- `501`: OTLP is not available on this deployment.
- `503`: storage is temporarily unavailable, with a `Retry-After` header.

Exporters retry `429` and `503` only. Retries are safe: a log record's ID is derived from its content and its position in the batch, so a re-sent batch is not stored twice, and a re-sent span replaces its earlier copy.

## 2. Send logs from the browser

With the tracking script installed, call `flareboard.log()`:

```js
flareboard.log('error', 'Checkout failed', { step: 'payment' });
```

The signature is `flareboard.log(level, message, data)`. `level` is one of `trace`, `debug`, `info`, `warn`, `error` or `fatal`. These lines show up with the source **Browser** and carry the visitor's session, so you can open the session from the line. The npm package has the same call. See [npm package](/docs/install/npm).

From a server without OpenTelemetry, you can send the same kind of line with `"type": "log"` to `/api/send`. See [Send events from your server](/docs/install/server).

Do not put passwords, tokens or personal data in log messages or attributes.

## 3. Find logs in the console

Open the website, then **Logs** (under **Quality**). Choose a date range at the top. Three tabs show the data.

### Explore

- The top strip shows **Lines**, **Errors**, **Warnings** and **Affected sessions** for the range and filters.
- The **Log volume** chart shows lines over time by level. Click a level to filter by it.
- The toolbar filters by message text (a case-insensitive substring), service, environment, release and source (**OpenTelemetry** or **Browser**). Type `key=value` in the attribute box and click **Add attribute filter** to filter on an attribute. A key without a value matches lines where the attribute is set. Active filters appear as removable chips, and **Reset** clears them.
- Click a line to open **Log line**: the message, attributes, resource and scope. **View trace** opens its trace. **Open session and replay** opens the visitor's session when the line carries a session ID.
- **Load older lines** at the bottom fetches the next page.

### Live tail

**Live tail** shows new lines as they arrive, checked every two seconds, in arrival order. It keeps the latest 1,000 lines and respects the filters you set. Use **Pause**, **Resume** and **Clear** to control it.

### Traces

**Traces** lists traces built from OpenTelemetry spans, and from browser log lines that carry a `traceId`. Search by span name, or turn on **Errors only**. Click a trace to see **Span waterfall**, span attributes and events, and **Logs in this trace**.

## 4. Save filters

Set filters in **Explore**, then click **Save filter** (or open **Saved filters**), enter a name and save. **Apply** loads a saved filter back into **Explore**. Saving and deleting need edit access to the website.

## 5. Alert on log volume

1. Open **Logs**, then **Alert rules**, then **New rule**.
2. Fill in:
   - **Rule name**.
   - **Threshold**: the number of matching lines (1 to 100,000).
   - **Window (minutes)**: 1 to 10,080.
   - Optional filters: **Log level**, **Service**, **Search**, **Attribute** (`key=value`), **Release**, **Environment**.
   - **Channel**: **Record only**, **Email** or **Webhook**. For the last two, set **Target** to an email address or a webhook URL.
3. Click **Create alert rule**.

A rule fires when the number of matching lines in its window reaches the threshold. Rules are checked once an hour. After a rule fires, it does not fire again until its window has passed. **Record only** stores the alert without sending anything.

A webhook alert is a `POST` with a JSON body:

```json
{
  "type": "log_alert",
  "websiteId": "YOUR_WEBSITE_ID",
  "ruleName": "Checkout errors",
  "count": 42,
  "threshold": 20,
  "windowMinutes": 60
}
```

Webhook URLs must be public `http` or `https` addresses. Private, loopback and internal hosts are refused.

## Retention and allowances

- OpenTelemetry logs and spans are kept for 30 days, or less if the website's data retention is shorter.
- Browser log lines are stored as events and follow the website's event retention.

On Flareboard Cloud, log records and spans have their own monthly allowance, counted per account across all your websites and separate from product events:

| Plan | Logs and spans per month |
| --- | --- |
| Free | 50,000 |
| Cloud | 500,000 |
| Business | 5,000,000 |

The Free plan stops collecting at the allowance. Cloud and Business keep collecting up to 120% of it, then stop until the next month. You get an email at 80%, at 100% and when collection stops. Once collection stops, OTLP requests return `402`. Usage shows under **Logs & spans** on the **Billing** page. Lines sent with `flareboard.log()` count toward your monthly events instead. Self-hosted installs have no plan limits.

## Check that it works

1. Send the log `curl` request from step 1, or start your instrumented app.
2. Confirm the response is `200`.
3. Open **Logs** for the website. The line appears within seconds. In **Live tail** it shows up as it arrives.

On a website with no logs yet, the **Logs** page shows the environment variables to use, as long as the deployment accepts OTLP.

## Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| `401` | The key is missing, wrong or rotated. | Copy the **Project API key** from **Settings** again. A website ID does not work here. |
| `415` | The content type or encoding is not supported. | Use `application/json` or `application/x-protobuf`, with gzip or no compression. |
| `501` | The deployment does not use the per-website stores. | Self-hosters: set `EVENT_STORE` to `dual` or `do`. |
| `402` | The monthly log and span allowance is used up. | Wait for next month or change plan. See [Plans and limits](/docs/plans-limits). |
| `200` but `partialSuccess` names rejected records | Timestamps older than 30 days, or invalid IDs. | Fix the timestamps or IDs and send again. |
| The exporter shows no error but nothing appears | The SDK is on gRPC, or the endpoint has a path added twice. | Set the protocol to `http/protobuf` or `http/json` and use the bare ingest address as the endpoint. |
