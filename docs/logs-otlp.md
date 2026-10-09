# OpenTelemetry logs and traces (OTLP)

Flareboard's ingest worker is an OTLP/HTTP receiver. Point any OpenTelemetry SDK or the
OpenTelemetry Collector at it and your server and app logs and traces show up in the website's
**Logs** page, next to the logs sent by the tracker's `flareboard.log()`.

| Signal | Endpoint | Encodings |
|--------|----------|-----------|
| Logs   | `POST https://<ingest-host>/v1/logs`   | `application/x-protobuf` or `application/json`, optionally `Content-Encoding: gzip` |
| Traces | `POST https://<ingest-host>/v1/traces` | same |

Metrics (`/v1/metrics`) are not accepted.

## Authentication

Use the website's **project key** (`fb_pk_…`, in the website settings), either as

```
Authorization: Bearer fb_pk_…
```

or as `x-flareboard-key: fb_pk_…`. A website id is not accepted here. Rotating the key in the
settings stops the old one within minutes.

## SDK environment variables

Every OpenTelemetry SDK reads the standard exporter variables:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://<ingest-host>
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf        # or http/json
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer%20fb_pk_…"
OTEL_EXPORTER_OTLP_COMPRESSION=gzip
OTEL_SERVICE_NAME=checkout-api
OTEL_RESOURCE_ATTRIBUTES="service.version=2.4.1,deployment.environment.name=production"
OTEL_LOGS_EXPORTER=otlp
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=none
```

The SDK appends `/v1/logs` and `/v1/traces` to `OTEL_EXPORTER_OTLP_ENDPOINT`. Header values are
URL-encoded (`%20` is the space after `Bearer`). gRPC (`OTEL_EXPORTER_OTLP_PROTOCOL=grpc`) is not
supported; use `http/protobuf` or `http/json`.

Browser apps using `@opentelemetry/exporter-*-otlp-http` can send the key in `x-flareboard-key`;
the receiver allows that header in CORS preflights. The project key is public (it is the same key
the tracker uses), so exposing it in a browser bundle is fine.

## OpenTelemetry Collector

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
    endpoint: https://<ingest-host>
    headers:
      Authorization: Bearer fb_pk_…
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

## How records are mapped

| OTLP | Flareboard |
|------|------------|
| resource `service.name`, `service.version` | service, release |
| resource `deployment.environment.name` (or `deployment.environment`) | environment |
| other resource attributes | shown under *Resource* in the log detail, filterable |
| `severityNumber` (1-4 trace … 21-24 fatal), else `severityText`, else info | severity (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `body` | message (non-string bodies are stored as JSON) |
| log/span attributes | attributes (filterable as `key=value`) |
| `traceId`, `spanId` | links a log line to its trace |
| attribute `session.id`, `session_id` or `$session_id` (record, then resource) | links the log or trace to the Flareboard session and its replay |
| instrumentation scope `name@version` | scope |
| span `name`, `kind`, start/end, `status`, `events`, `links` | span waterfall and span detail |

To link backend logs and traces to a visitor's session replay, add the tracker's session id as an
attribute: `flareboard.getSessionId()` in the browser, forwarded to your backend, then set as
`session.id` on the span or log record.

Timestamps: `timeUnixNano`, else `observedTimeUnixNano`, else the receive time. Records stamped
more than a day in the future are stored at their receive time; records older than the retention
window (30 days) are rejected and reported in `partialSuccess`.

## Limits

| Limit | Value |
|-------|-------|
| Request body (compressed or not) | 4 MB |
| Decompressed body | 8 MB |
| Log records or spans per request | 10,000 (413 above) |
| Attributes per record / span / event / link | 128 (more are dropped and reported) |
| Attribute key length | 256 characters |
| Attribute value length | 4,096 characters (arrays and maps as JSON) |
| Log body length | 32 KB |
| Events and links per span | 128 each |
| Requests per project key | `PROJECT_KEY_RATE_LIMIT` per minute (default 30,000), a budget separate from event capture |

Hosted plans count every stored log record and span toward their own monthly allowance
(`maxOtelRowsPerMonth` in `packages/shared/src/billing.ts`), separate from events; an account over
it gets `402`.

## Responses

Responses follow the OTLP/HTTP spec, in the request's encoding:

- `200` with an empty `Export*ServiceResponse` when everything was stored; with `partialSuccess`
  (`rejectedLogRecords` / `rejectedSpans` and an `errorMessage`) when some records were rejected or
  attributes were dropped.
- Errors carry a `google.rpc.Status` (`{"code": …, "message": …}` for JSON):
  `400` malformed body, `401` missing/unknown key, `402` over quota, `413` too large,
  `415` unsupported `Content-Type` or `Content-Encoding`, `429` rate limited (`Retry-After`),
  `501` OTLP unavailable on this deployment, `503` storage unavailable (`Retry-After`).
  Exporters retry `429` and `503` only.

Retries are safe: a log record's id is derived from its content and position in the batch, so a
re-sent batch is not stored twice, and a re-sent span replaces the earlier copy.

## Storage, retention and deletion

Records are written straight to the website's store (`log_record`, `trace_span` in the
`EventStore` Durable Object, store schema version 4), one transaction per request. They do not go
through the event queue: exporters already batch, a failed write should answer `503` so the
exporter retries, and an OTLP batch is far larger than a queue message.

- OTLP needs the per-website stores: `EVENT_STORE` `dual` or `do`. With the legacy `d1` mode the
  endpoints answer `501` and the Logs page shows tracker logs only (read from D1).
- Logs and spans are deleted after 30 days by the store's own alarm, sooner when the website has a
  shorter retention period (`lib/retention.ts`). Deleting a website erases its store.

## Querying

The Logs page (`/websites/:id/logs`) combines OTLP logs and `flareboard.log()` lines:

- **Explore**: severity histogram (click a severity to filter), text search in the message
  (a literal substring, case-insensitive for ASCII), filters for service, environment, release,
  source, trace id, session id and any number of `key=value` attributes; a detail pane with all
  attributes, a link to the trace and to the session and its replay.
- **Live tail**: new lines every two seconds, in arrival order, including batches exported late.
- **Traces**: traces from OTLP spans (and from `flareboard.log()` lines with a `traceId`), with a
  span waterfall, span attributes and events, and the trace's log lines.
- **Saved filters** and **alert rules**: an alert fires when the number of matching lines in its
  window reaches the threshold (severity, service, text, release, environment and one attribute);
  delivery goes through the error-alert channels (record, email, webhook).

API: `GET /api/websites/:id/logs`, `/logs/histogram`, `/logs/tail`, `/logs/traces`,
`/logs/traces/:traceId`, `/logs/services` accept `level` (comma-separated), `q`, `service`,
`environment`, `release`, `source` (`otlp` | `browser`), `traceId`, `sessionId` and repeated
`attr=key=value` (or `attr=key` for "is set").

Full-text search uses `LIKE` with escaped wildcards. SQLite FTS5 is available in Durable Object
storage, but an FTS index would roughly double the storage of every log line, only tokenizes whole
words (log search is usually for substrings such as ids and paths), and would not cover tracker
logs; with 30-day retention and per-website stores, a time-bounded `LIKE` scan is fast enough.
