/**
 * OTLP logs and traces (JSON shape, see protobuf.ts for the binary encoding) → rows of the
 * website store's `log_record` and `trace_span` tables (apps/api/src/store/schema.ts).
 *
 * Mapping (docs/logs-otlp.md):
 * - resource `service.name` / `service.version` / `deployment.environment[.name]` → service,
 *   service_version, environment; the rest of the resource attributes → `resource` JSON;
 * - `session.id`, `session_id` or `$session_id` (record, then resource attributes) → session_id,
 *   which links a log or span to the Flareboard session and its replay;
 * - severity: `severityNumber` ranges, else `severityText`, else info;
 * - AnyValue → JSON (int64 beyond 2^53 stays a string, bytes are base64).
 *
 * Limits keep one noisy client from bloating a website's store: attribute count, key and value
 * length, body length, span events and links. Records outside the retention window are rejected.
 */

export const OTLP_LIMITS = {
  /** Attributes kept per record, span, event or link (OTel SDK default). */
  maxAttributes: 128,
  maxKeyLength: 256,
  /** String values (and JSON-encoded arrays/maps) are cut here. */
  maxValueLength: 4096,
  maxBodyLength: 32 * 1024,
  maxSpanEvents: 128,
  maxSpanLinks: 128,
  maxNameLength: 1024,
  /** Log records or spans per request. */
  maxItems: 10_000,
} as const;

/** Must match OTEL_RETENTION_DAYS in apps/api/src/store/schema.ts. */
export const OTEL_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Records stamped further ahead than this (clock skew) are stored at their receive time. */
const MAX_FUTURE_MS = DAY_MS;

export type LogRow = {
  logId: string;
  createdAt: number;
  timeUs: number;
  severity: Severity;
  severityNumber: number;
  severityText: string | null;
  body: string | null;
  service: string | null;
  serviceVersion: string | null;
  environment: string | null;
  scope: string | null;
  traceId: string | null;
  spanId: string | null;
  sessionId: string | null;
  attributes: string | null;
  resource: string | null;
};

export type SpanRow = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  service: string | null;
  serviceVersion: string | null;
  environment: string | null;
  scope: string | null;
  createdAt: number;
  startUs: number;
  endUs: number;
  durationUs: number;
  statusCode: 'unset' | 'ok' | 'error';
  statusMessage: string | null;
  sessionId: string | null;
  attributes: string | null;
  resource: string | null;
  events: string | null;
  links: string | null;
};

export type Normalized<T> = { rows: T[]; rejected: number; reasons: string[] };

export class OtlpPayloadError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 = 400,
  ) {
    super(message);
  }
}

export const SEVERITIES = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type Severity = (typeof SEVERITIES)[number];

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** int64 as number when exact, else its decimal string. */
function int64(value: unknown): number | string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) return null;
  const big = BigInt(value.trim());
  return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big.toString();
}

/** Unsigned nanosecond timestamp (string or number) as BigInt; 0 when absent or invalid. */
function nanos(value: unknown): bigint {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  return 0n;
}

/** AnyValue → JSON value; strings are cut at `maxString`. */
export function anyValue(value: unknown, depth = 0, maxString: number = OTLP_LIMITS.maxValueLength): Json {
  if (!isObj(value) || depth > 16) return null;
  if ('stringValue' in value) return truncate(String(value.stringValue ?? ''), maxString);
  if ('boolValue' in value) return value.boolValue === true || value.boolValue === 'true';
  if ('intValue' in value) return int64(value.intValue);
  if ('doubleValue' in value) {
    const n = typeof value.doubleValue === 'number' ? value.doubleValue : Number(value.doubleValue);
    // JSON has no NaN/Infinity; keep their names.
    return Number.isFinite(n) ? n : String(value.doubleValue);
  }
  if ('arrayValue' in value) {
    const values = isObj(value.arrayValue) ? list(value.arrayValue.values) : [];
    return values.slice(0, OTLP_LIMITS.maxAttributes).map((item) => anyValue(item, depth + 1));
  }
  if ('kvlistValue' in value) {
    return keyValues(isObj(value.kvlistValue) ? value.kvlistValue.values : [], depth + 1).map;
  }
  if ('bytesValue' in value) return typeof value.bytesValue === 'string' ? truncate(value.bytesValue, OTLP_LIMITS.maxValueLength) : null;
  return null;
}

/** Keeps nested values within the value length limit once serialized. */
function capNested(value: Json): Json {
  if (value === null || typeof value !== 'object') return value;
  const encoded = JSON.stringify(value);
  return encoded.length > OTLP_LIMITS.maxValueLength ? truncate(encoded, OTLP_LIMITS.maxValueLength) : value;
}

/** repeated KeyValue → object, with count/key/value caps. `dropped` counts attributes cut off. */
function keyValues(value: unknown, depth = 0): { map: { [key: string]: Json }; dropped: number } {
  const map: { [key: string]: Json } = {};
  let kept = 0;
  let dropped = 0;
  for (const item of list(value)) {
    if (!isObj(item) || typeof item.key !== 'string' || !item.key) continue;
    if (kept >= OTLP_LIMITS.maxAttributes) {
      dropped++;
      continue;
    }
    const key = truncate(item.key, OTLP_LIMITS.maxKeyLength);
    if (!(key in map)) kept++;
    map[key] = capNested(anyValue(item.value, depth));
  }
  return { map, dropped };
}

function jsonOrNull(map: { [key: string]: Json }): string | null {
  return Object.keys(map).length ? JSON.stringify(map) : null;
}

function stringAttr(map: { [key: string]: Json }, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = map[key];
    if (typeof value === 'string' && value.trim()) return truncate(value.trim(), OTLP_LIMITS.maxNameLength);
    if (typeof value === 'number') return String(value);
  }
  return null;
}

const SESSION_KEYS = ['session.id', 'session_id', '$session_id'];

type ResourceInfo = {
  service: string | null;
  serviceVersion: string | null;
  environment: string | null;
  sessionId: string | null;
  resource: string | null;
};

function resourceInfo(resource: unknown): ResourceInfo {
  const { map } = keyValues(isObj(resource) ? resource.attributes : []);
  const service = stringAttr(map, 'service.name');
  const serviceVersion = stringAttr(map, 'service.version');
  const environment = stringAttr(map, 'deployment.environment.name', 'deployment.environment');
  const sessionId = stringAttr(map, ...SESSION_KEYS);
  for (const key of ['service.name', 'service.version', 'deployment.environment.name', 'deployment.environment']) delete map[key];
  return { service, serviceVersion, environment, sessionId, resource: jsonOrNull(map) };
}

function scopeName(scope: unknown): string | null {
  if (!isObj(scope) || typeof scope.name !== 'string' || !scope.name) return null;
  const version = typeof scope.version === 'string' && scope.version ? `@${scope.version}` : '';
  return truncate(`${scope.name}${version}`, OTLP_LIMITS.maxNameLength);
}

const SEVERITY_NUMBER_NAMES: Record<string, number> = Object.fromEntries(
  ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].flatMap((name, i) =>
    ['', '2', '3', '4'].map((suffix, j) => [`SEVERITY_NUMBER_${name}${suffix}`, i * 4 + j + 1]),
  ),
);

export function severityNumberOf(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value >= 0 && value <= 24 ? value : 0;
  if (typeof value === 'string') return SEVERITY_NUMBER_NAMES[value] ?? (/^\d+$/.test(value) ? severityNumberOf(Number(value)) : 0);
  return 0;
}

const SEVERITY_TEXT: Record<string, Severity> = {
  trace: 'trace',
  verbose: 'trace',
  debug: 'debug',
  info: 'info',
  information: 'info',
  informational: 'info',
  notice: 'info',
  log: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  err: 'error',
  fatal: 'fatal',
  critical: 'fatal',
  crit: 'fatal',
  alert: 'fatal',
  emerg: 'fatal',
  emergency: 'fatal',
  panic: 'fatal',
};

/** OTel severity number ranges (1-4 trace … 21-24 fatal), else the text, else info. */
export function normalizeSeverity(severityNumber: number, severityText: string | null): Severity {
  if (severityNumber >= 1 && severityNumber <= 24) return SEVERITIES[Math.floor((severityNumber - 1) / 4)]!;
  const text = severityText?.trim().toLowerCase().replace(/\d+$/, '');
  return (text && SEVERITY_TEXT[text]) || 'info';
}

/**
 * Trace/span ids: OTLP/JSON uses hex. Some non-conforming clients send the protobuf JSON default
 * (base64); accept that too. Returns lowercase hex, or null for missing/invalid/all-zero ids.
 */
export function normalizeId(value: unknown, bytes: 8 | 16): string | null {
  if (typeof value !== 'string' || !value) return null;
  let hex: string | null = null;
  if (value.length === bytes * 2 && /^[0-9a-fA-F]+$/.test(value)) {
    hex = value.toLowerCase();
  } else if (/^[A-Za-z0-9+/_-]+=*$/.test(value)) {
    try {
      const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
      if (binary.length === bytes) {
        hex = Array.from(binary, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      }
    } catch {
      hex = null;
    }
  }
  return hex && /[^0]/.test(hex) ? hex : null;
}

async function recordId(parts: unknown[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(digest).subarray(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Receive-side time checks shared by logs and spans: µs timestamp or a rejection reason. */
function placeInTime(us: bigint, receivedAt: number): { us: number } | { reject: string } {
  const receivedUs = receivedAt * 1000;
  if (us <= 0n) return { us: receivedUs };
  const value = Number(us);
  if (value > receivedUs + MAX_FUTURE_MS * 1000) return { us: receivedUs };
  if (value < receivedUs - OTEL_RETENTION_DAYS * DAY_MS * 1000) {
    return { reject: `older than the ${OTEL_RETENTION_DAYS}-day retention` };
  }
  return { us: value };
}

function addReason(reasons: string[], reason: string) {
  if (!reasons.includes(reason) && reasons.length < 5) reasons.push(reason);
}

function countItems(resources: unknown[], scopesKey: string, itemsKey: string): number {
  let count = 0;
  for (const resource of resources) {
    if (!isObj(resource)) continue;
    for (const scope of list(resource[scopesKey])) if (isObj(scope)) count += list(scope[itemsKey]).length;
  }
  return count;
}

function requireRoot(payload: unknown, key: string): unknown[] {
  if (!isObj(payload)) throw new OtlpPayloadError('Request body must be an OTLP JSON object');
  const resources = payload[key];
  if (resources !== undefined && !Array.isArray(resources)) throw new OtlpPayloadError(`${key} must be an array`);
  return resources ?? [];
}

/** `ExportLogsServiceRequest` → log_record rows. */
export async function normalizeLogs(payload: unknown, receivedAt: number): Promise<Normalized<LogRow>> {
  const resources = requireRoot(payload, 'resourceLogs');
  const total = countItems(resources, 'scopeLogs', 'logRecords');
  if (total > OTLP_LIMITS.maxItems) throw new OtlpPayloadError(`At most ${OTLP_LIMITS.maxItems} log records per request`, 413);

  const rows: LogRow[] = [];
  const reasons: string[] = [];
  let rejected = 0;
  for (const [ri, resourceLogs] of resources.entries()) {
    if (!isObj(resourceLogs)) continue;
    const info = resourceInfo(resourceLogs.resource);
    const resourceKey = JSON.stringify(resourceLogs.resource ?? null);
    for (const [si, scopeLogs] of list(resourceLogs.scopeLogs).entries()) {
      if (!isObj(scopeLogs)) continue;
      const scope = scopeName(scopeLogs.scope);
      for (const [li, record] of list(scopeLogs.logRecords).entries()) {
        if (!isObj(record)) {
          rejected++;
          addReason(reasons, 'log record is not an object');
          continue;
        }
        const time = nanos(record.timeUnixNano) || nanos(record.observedTimeUnixNano);
        const placed = placeInTime(time / 1000n, receivedAt);
        if ('reject' in placed) {
          rejected++;
          addReason(reasons, `log record ${placed.reject}`);
          continue;
        }
        const { map: attributes, dropped } = keyValues(record.attributes);
        if (typeof record.eventName === 'string' && record.eventName && !('event.name' in attributes)) {
          attributes['event.name'] = truncate(record.eventName, OTLP_LIMITS.maxNameLength);
        }
        if (dropped) addReason(reasons, `attributes beyond ${OTLP_LIMITS.maxAttributes} per record were dropped`);
        const severityNumber = severityNumberOf(record.severityNumber);
        const severityText = typeof record.severityText === 'string' && record.severityText ? truncate(record.severityText, 64) : null;
        const bodyValue = anyValue(record.body, 0, OTLP_LIMITS.maxBodyLength);
        const body =
          bodyValue === null
            ? null
            : truncate(typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue), OTLP_LIMITS.maxBodyLength);
        rows.push({
          // Deterministic, so an exporter retrying the same batch does not store it twice.
          logId: await recordId([resourceKey, scope, ri, si, li, record]),
          createdAt: Math.floor(placed.us / 1000),
          timeUs: placed.us,
          severity: normalizeSeverity(severityNumber, severityText),
          severityNumber,
          severityText,
          body,
          service: info.service,
          serviceVersion: info.serviceVersion,
          environment: info.environment,
          scope,
          traceId: normalizeId(record.traceId, 16),
          spanId: normalizeId(record.spanId, 8),
          sessionId: stringAttr(attributes, ...SESSION_KEYS) ?? info.sessionId,
          attributes: jsonOrNull(attributes),
          resource: info.resource,
        });
      }
    }
  }
  return { rows, rejected, reasons };
}

const SPAN_KINDS = ['unspecified', 'internal', 'server', 'client', 'producer', 'consumer'] as const;

function spanKind(value: unknown): string {
  if (typeof value === 'number') return SPAN_KINDS[value] ?? 'unspecified';
  if (typeof value === 'string') {
    const name = value.replace(/^SPAN_KIND_/, '').toLowerCase();
    return (SPAN_KINDS as readonly string[]).includes(name) ? name : 'unspecified';
  }
  return 'unspecified';
}

function statusCode(value: unknown): SpanRow['statusCode'] {
  if (value === 1 || value === 'STATUS_CODE_OK') return 'ok';
  if (value === 2 || value === 'STATUS_CODE_ERROR') return 'error';
  return 'unset';
}

/** `ExportTraceServiceRequest` → trace_span rows. */
export async function normalizeSpans(payload: unknown, receivedAt: number): Promise<Normalized<SpanRow>> {
  const resources = requireRoot(payload, 'resourceSpans');
  const total = countItems(resources, 'scopeSpans', 'spans');
  if (total > OTLP_LIMITS.maxItems) throw new OtlpPayloadError(`At most ${OTLP_LIMITS.maxItems} spans per request`, 413);

  const rows: SpanRow[] = [];
  const reasons: string[] = [];
  let rejected = 0;
  for (const resourceSpans of resources) {
    if (!isObj(resourceSpans)) continue;
    const info = resourceInfo(resourceSpans.resource);
    for (const scopeSpans of list(resourceSpans.scopeSpans)) {
      if (!isObj(scopeSpans)) continue;
      const scope = scopeName(scopeSpans.scope);
      for (const span of list(scopeSpans.spans)) {
        const traceId = isObj(span) ? normalizeId(span.traceId, 16) : null;
        const spanId = isObj(span) ? normalizeId(span.spanId, 8) : null;
        if (!isObj(span) || !traceId || !spanId) {
          rejected++;
          addReason(reasons, 'span without a valid traceId/spanId');
          continue;
        }
        const startNs = nanos(span.startTimeUnixNano);
        const endNs = nanos(span.endTimeUnixNano);
        const placed = placeInTime(startNs / 1000n, receivedAt);
        if ('reject' in placed) {
          rejected++;
          addReason(reasons, `span ${placed.reject}`);
          continue;
        }
        const durationUs = startNs > 0n && endNs > startNs ? Number((endNs - startNs) / 1000n) : 0;
        const { map: attributes, dropped } = keyValues(span.attributes);
        if (dropped) addReason(reasons, `attributes beyond ${OTLP_LIMITS.maxAttributes} per span were dropped`);
        const events = list(span.events)
          .slice(0, OTLP_LIMITS.maxSpanEvents)
          .filter(isObj)
          .map((event) => {
            const at = nanos(event.timeUnixNano);
            return {
              name: typeof event.name === 'string' ? truncate(event.name, OTLP_LIMITS.maxNameLength) : '',
              timeUs: at > 0n ? Number(at / 1000n) : placed.us,
              attributes: keyValues(event.attributes).map,
            };
          });
        const links = list(span.links)
          .slice(0, OTLP_LIMITS.maxSpanLinks)
          .filter(isObj)
          .map((link) => ({
            traceId: normalizeId(link.traceId, 16),
            spanId: normalizeId(link.spanId, 8),
            attributes: keyValues(link.attributes).map,
          }))
          .filter((link) => link.traceId && link.spanId);
        const status = isObj(span.status) ? span.status : {};
        rows.push({
          traceId,
          spanId,
          parentSpanId: normalizeId(span.parentSpanId, 8),
          name: typeof span.name === 'string' && span.name ? truncate(span.name, OTLP_LIMITS.maxNameLength) : '(unnamed)',
          kind: spanKind(span.kind),
          service: info.service,
          serviceVersion: info.serviceVersion,
          environment: info.environment,
          scope,
          createdAt: Math.floor(placed.us / 1000),
          startUs: placed.us,
          endUs: placed.us + durationUs,
          durationUs,
          statusCode: statusCode(status.code),
          statusMessage: typeof status.message === 'string' && status.message ? truncate(status.message, OTLP_LIMITS.maxValueLength) : null,
          sessionId: stringAttr(attributes, ...SESSION_KEYS) ?? info.sessionId,
          attributes: jsonOrNull(attributes),
          resource: info.resource,
          events: events.length ? JSON.stringify(events) : null,
          links: links.length ? JSON.stringify(links) : null,
        });
      }
    }
  }
  return { rows, rejected, reasons };
}
