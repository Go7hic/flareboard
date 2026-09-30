import type { Context } from 'hono';
import type { Env } from '../env';
import { assertEventAllowed, recordUsage } from '../lib/hosted-limits';
import { normalizeLogs, normalizeSpans, OtlpPayloadError, type Normalized } from '../lib/otlp/normalize';
import { decodeOtlpProtobuf, encodeExportResponse, encodeRpcStatus, ProtobufError } from '../lib/otlp/protobuf';
import { otelStore, writeLogRows, writeSpanRows } from '../lib/otlp/store';
import { gunzip, PostHogBodyError, readLimited } from '../lib/posthog/body';
import { resolveProjectKey } from '../lib/project-keys';
import { checkProjectKeyRateLimit } from '../lib/rate-limit';

/**
 * OTLP/HTTP receiver (OpenTelemetry Protocol 1.x): `POST /v1/logs` and `POST /v1/traces`, JSON
 * (`application/json`) or binary protobuf (`application/x-protobuf`), optionally gzip-compressed.
 * Authenticated with the website's project key: `Authorization: Bearer fb_pk_…` or
 * `x-flareboard-key: fb_pk_…`. See docs/logs-otlp.md.
 *
 * Responses follow the OTLP/HTTP spec: success is an `Export*ServiceResponse` (with
 * `partialSuccess` when records were rejected), errors carry a `google.rpc.Status`, both in the
 * request's encoding. 429 and 503 are retryable; every other error is not.
 */

type Ctx = Context<{ Bindings: Env }>;
type Format = 'json' | 'protobuf';
type Signal = 'logs' | 'traces';

/** Compressed or plain bytes on the wire. */
export const OTLP_MAX_REQUEST_BYTES = 4 * 1024 * 1024;
/** Decoded size; also stops gzip bombs. */
export const OTLP_MAX_DECODED_BYTES = 8 * 1024 * 1024;

const GRPC_CODE: Record<number, number> = {
  400: 3, // INVALID_ARGUMENT
  401: 16, // UNAUTHENTICATED
  402: 8, // RESOURCE_EXHAUSTED
  413: 8,
  415: 3,
  429: 8,
  501: 12, // UNIMPLEMENTED
  503: 14, // UNAVAILABLE
};

function formatOf(contentType: string | undefined): Format | null {
  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  if (type === 'application/json') return 'json';
  if (type === 'application/x-protobuf' || type === 'application/protobuf') return 'protobuf';
  return null;
}

function statusResponse(format: Format, status: number, message: string, headers: Record<string, string> = {}) {
  const code = GRPC_CODE[status] ?? 2;
  if (format === 'protobuf') {
    return new Response(encodeRpcStatus(code, message), {
      status,
      headers: { 'Content-Type': 'application/x-protobuf', ...headers },
    });
  }
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function successResponse(format: Format, signal: Signal, result: Normalized<unknown>) {
  const message = result.reasons.join('; ');
  if (format === 'protobuf') {
    return new Response(encodeExportResponse(result.rejected, message), {
      headers: { 'Content-Type': 'application/x-protobuf' },
    });
  }
  const rejectedKey = signal === 'logs' ? 'rejectedLogRecords' : 'rejectedSpans';
  const body =
    result.rejected || message ? { partialSuccess: { [rejectedKey]: result.rejected, errorMessage: message } } : {};
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

/** `Authorization: Bearer fb_pk_…` or `x-flareboard-key: fb_pk_…`. */
export function otlpKey(req: Request): string | null {
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  return bearer ?? req.headers.get('x-flareboard-key')?.trim() ?? null;
}

async function readBody(req: Request): Promise<Uint8Array> {
  const declared = Number.parseInt(req.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > OTLP_MAX_REQUEST_BYTES) throw new PostHogBodyError(413, 'Payload too large');
  const encoding = (req.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
  if (encoding !== 'gzip' && encoding !== 'identity' && encoding !== '') {
    throw new UnsupportedEncoding(`Unsupported Content-Encoding "${encoding}": use gzip or none`);
  }
  const bytes = await readLimited(req.body, OTLP_MAX_REQUEST_BYTES, 'Payload');
  if (encoding === 'gzip' && bytes.length) return await gunzip(bytes, OTLP_MAX_DECODED_BYTES);
  return bytes;
}

class UnsupportedEncoding extends Error {}

const utf8 = new TextDecoder('utf-8');

function parse(bytes: Uint8Array, format: Format, signal: Signal): unknown {
  if (format === 'protobuf') {
    return decodeOtlpProtobuf(bytes, signal === 'logs' ? 'ExportLogsServiceRequest' : 'ExportTraceServiceRequest');
  }
  const text = utf8.decode(bytes);
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function handleExport(c: Ctx, signal: Signal) {
  const format = formatOf(c.req.header('content-type'));
  if (!format) {
    return statusResponse(
      'json',
      415,
      'Unsupported Content-Type: send OTLP as application/json or application/x-protobuf',
    );
  }

  const key = otlpKey(c.req.raw);
  const websiteId = key ? await resolveProjectKey(c.env, key) : null;
  if (!key || !websiteId) {
    return statusResponse(
      format,
      401,
      'Missing or unknown project key: send "Authorization: Bearer fb_pk_…" or "x-flareboard-key: fb_pk_…"',
    );
  }

  const db = otelStore(c.env, websiteId);
  if (!db) {
    return statusResponse(format, 501, 'OpenTelemetry ingestion needs the per-website stores (EVENT_STORE dual or do)');
  }

  const [rl, quota] = await Promise.all([
    checkProjectKeyRateLimit(c.env, key, 'otlp'),
    assertEventAllowed(c.env, websiteId, 'otel'),
  ]);
  if (!rl.allowed) return statusResponse(format, 429, 'Rate limit exceeded', { 'Retry-After': '30' });
  if (!quota.ok) return statusResponse(format, 402, quota.message);

  let payload: unknown;
  try {
    payload = parse(await readBody(c.req.raw), format, signal);
  } catch (error) {
    if (error instanceof PostHogBodyError) return statusResponse(format, error.status, error.message);
    if (error instanceof UnsupportedEncoding) return statusResponse(format, 415, error.message);
    if (error instanceof ProtobufError) return statusResponse(format, 400, `Invalid protobuf: ${error.message}`);
    if (error instanceof SyntaxError) return statusResponse(format, 400, 'Invalid JSON');
    throw error;
  }

  const receivedAt = Date.now();
  let result: Normalized<unknown>;
  try {
    if (signal === 'logs') {
      const logs = await normalizeLogs(payload, receivedAt);
      await writeLogRows(db, websiteId, logs.rows);
      result = logs;
    } else {
      const spans = await normalizeSpans(payload, receivedAt);
      await writeSpanRows(db, websiteId, spans.rows);
      result = spans;
    }
  } catch (error) {
    if (error instanceof OtlpPayloadError) {
      return statusResponse(format, error.status, error.message);
    }
    console.error(
      JSON.stringify({
        event: 'otlp_write_failed',
        signal,
        websiteId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    // Retryable: the exporter sends the batch again (log ids are deterministic, spans upsert).
    return statusResponse(format, 503, 'Storage temporarily unavailable', { 'Retry-After': '5' });
  }

  if (result.rows.length) {
    c.executionCtx.waitUntil(
      recordUsage(c.env, quota.userId, 'otel', result.rows.length).catch((error: unknown) => {
        console.error(JSON.stringify({ event: 'usage_record_failed', metric: 'otel', error: String(error) }));
      }),
    );
  }
  return successResponse(format, signal, result);
}

export const handleOtlpLogs = (c: Ctx) => handleExport(c, 'logs');
export const handleOtlpTraces = (c: Ctx) => handleExport(c, 'traces');
