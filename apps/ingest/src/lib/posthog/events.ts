import { deviceFromUserAgent } from '@flareboard/shared';
import { parseBrowser, parseEventTimestamp, parseOs } from '../../routes/collect';

/**
 * Pure mapping from PostHog's wire format to Flareboard's concepts. No I/O here: the pipeline
 * (pipeline.ts) turns these results into queue messages and person updates.
 */

type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max?: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return max ? trimmed.slice(0, max) : trimmed;
}

function finite(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Events accepted per request; posthog-node and posthog-python send at most 100 by default. */
export const MAX_EVENTS_PER_REQUEST = 1000;
const MAX_DISTINCT_ID_LENGTH = 200;
const MAX_EVENT_NAME_LENGTH = 200;
/** Queue messages are capped at 128 KB; event properties stay well below that. */
const MAX_PROPERTY_BYTES = 32 * 1024;
const MAX_PROPERTIES = 100;
const MAX_PERSON_PROPERTIES = 100;

/** Distinct ids PostHog refuses to merge people on (placeholders sent by buggy integrations). */
const UNSAFE_MERGE_IDS = new Set([
  'anonymous',
  'guest',
  'distinctid',
  'distinct_id',
  'id',
  'not_authenticated',
  'email',
  'undefined',
  'null',
  'true',
  'false',
  '0',
  'nan',
  '[object object]',
]);

export function safeToMerge(distinctId: string) {
  return !UNSAFE_MERGE_IDS.has(distinctId.trim().toLowerCase());
}

export type PostHogEvent = {
  event: string;
  distinctId: string;
  properties: Json;
  uuid?: string;
  timestamp?: unknown;
  offset?: unknown;
  set?: Json;
  setOnce?: Json;
  /** Token given on the event itself, if any (must match the request's). */
  token?: string;
};

export type PostHogRequest = {
  token: string | null;
  sentAt: number | null;
  events: unknown[];
};

/** Milliseconds since the epoch from an ISO string or a number (seconds or milliseconds). */
export function parsePostHogTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value > 1e11 ? value : value * 1000;
  if (typeof value === 'string' && value.trim()) {
    if (/^\d+(\.\d+)?$/.test(value.trim())) return parsePostHogTime(Number(value));
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function eventToken(raw: Json): string | undefined {
  const props = isRecord(raw.properties) ? raw.properties : {};
  return text(raw.api_key) ?? text(raw.token) ?? text(props.token);
}

/**
 * Accepts every body shape PostHog SDKs send: a single event, an array of events (posthog-js),
 * or `{ api_key, batch, sent_at }` (server SDKs and newer posthog-js).
 */
export function extractPostHogRequest(body: unknown, url: URL): PostHogRequest {
  let events: unknown[] = [];
  let token: string | undefined;
  let sentAt: unknown;
  if (Array.isArray(body)) {
    events = body;
  } else if (isRecord(body)) {
    token = text(body.api_key) ?? text(body.token);
    sentAt = body.sent_at ?? body.sentAt;
    if (Array.isArray(body.batch)) events = body.batch;
    else if (Array.isArray(body.data)) events = body.data;
    else if (typeof body.event === 'string') events = [body];
  }
  if (!token) {
    for (const raw of events) {
      if (isRecord(raw) && (token = eventToken(raw))) break;
    }
  }
  const sentAtMs =
    parsePostHogTime(sentAt) ?? parsePostHogTime(url.searchParams.get('sent_at')) ?? parsePostHogTime(url.searchParams.get('_'));
  return { token: token ?? null, sentAt: sentAtMs, events };
}

function mergeRecords(...values: unknown[]): Json | undefined {
  const records = values.filter(isRecord);
  if (!records.length) return undefined;
  const merged = Object.assign({}, ...records) as Json;
  return Object.keys(merged).length ? merged : undefined;
}

export function normalizePostHogEvent(raw: unknown): PostHogEvent | null {
  if (!isRecord(raw)) return null;
  const event = text(raw.event, MAX_EVENT_NAME_LENGTH);
  if (!event) return null;
  const properties: Json = isRecord(raw.properties) ? { ...raw.properties } : {};
  const distinctRaw = raw.distinct_id ?? raw.distinctId ?? properties.distinct_id ?? properties.$distinct_id;
  const distinctId =
    typeof distinctRaw === 'number' && Number.isFinite(distinctRaw) ? String(distinctRaw) : text(distinctRaw);
  if (!distinctId || distinctId.length > MAX_DISTINCT_ID_LENGTH) return null;
  return {
    event,
    distinctId,
    properties,
    uuid: text(raw.uuid, 64),
    timestamp: raw.timestamp ?? (properties.$time != null ? properties.$time : undefined),
    offset: raw.offset,
    // `$set` can be top level (posthog-js, capture API) or a property (server SDKs); both count.
    set: mergeRecords(properties.$set, raw.$set),
    setOnce: mergeRecords(properties.$set_once, raw.$set_once),
    token: eventToken(raw),
  };
}

/**
 * PostHog's timestamp rules: an event `timestamp` is corrected for client clock skew when the
 * request says when it was sent (`sent_at`), otherwise `offset` (ms before now) is used, else the
 * server time. The result must also pass Flareboard's bounds (90 days back, 5 minutes ahead).
 */
export function resolveEventTime(event: Pick<PostHogEvent, 'timestamp' | 'offset' | 'properties'>, sentAt: number | null, now = Date.now()): Date {
  let ms: number | null = null;
  const timestamp = parsePostHogTime(event.timestamp);
  if (timestamp != null) {
    ms = sentAt != null && event.properties.$ignore_sent_at !== true ? now + (timestamp - sentAt) : timestamp;
  } else {
    const offset = finite(event.offset);
    if (offset != null && offset >= 0) ms = now - offset;
  }
  return (ms != null ? parseEventTimestamp(Math.round(ms), now) : null) ?? new Date(now);
}

export type ClientInfo = {
  browser: string | null;
  os: string | null;
  device: string | null;
  screen: string | null;
  language: string | null;
  /** The visitor's user agent when known (used for bot filtering, never stored). */
  userAgent: string | null;
};

export function isBrowserUserAgent(ua: string | null | undefined): ua is string {
  return Boolean(ua && /^Mozilla\/\d/.test(ua));
}

/** PostHog's names for browsers and OSes, mapped onto the tracker's so breakdowns line up. */
const BROWSER_NAMES: Record<string, string> = {
  'microsoft edge': 'Edge',
  'mobile safari': 'Safari',
  'chrome ios': 'Chrome',
  'firefox ios': 'Firefox',
  'opera mini': 'Opera',
};
const OS_NAMES: Record<string, string> = {
  'mac os x': 'macOS',
  'mac os': 'macOS',
  macos: 'macOS',
  'chrome os': 'ChromeOS',
  chromeos: 'ChromeOS',
  ios: 'iOS',
  ipados: 'iOS',
  android: 'Android',
  windows: 'Windows',
  linux: 'Linux',
};

export function normalizeBrowser(value: unknown): string | null {
  const name = text(value, 100);
  if (!name) return null;
  return BROWSER_NAMES[name.toLowerCase()] ?? name;
}

export function normalizeOs(value: unknown): string | null {
  const name = text(value, 100);
  if (!name) return null;
  return OS_NAMES[name.toLowerCase()] ?? name;
}

/**
 * Browser, OS, device, screen and language from PostHog properties, falling back to the user
 * agent: `$raw_user_agent`, else the request's own user agent when it is a browser (a server
 * SDK's user agent says nothing about the visitor).
 */
export function clientInfo(properties: Json, requestUserAgent: string | null): ClientInfo {
  const rawUa = text(properties.$raw_user_agent, 1000);
  const ua = rawUa ?? (isBrowserUserAgent(requestUserAgent) ? requestUserAgent : null);
  const deviceType = text(properties.$device_type, 50)?.toLowerCase();
  const width = finite(properties.$screen_width);
  const height = finite(properties.$screen_height);
  const screen = width && height ? `${Math.round(width)}x${Math.round(height)}` : null;
  return {
    browser: normalizeBrowser(properties.$browser) ?? (ua ? parseBrowser(ua) : null),
    os: normalizeOs(properties.$os) ?? (ua ? parseOs(ua) : null),
    device: deviceType ?? (ua ? deviceFromUserAgent(ua) : null),
    screen: screen && screen.length <= 11 ? screen : null,
    language: text(properties.$browser_language, 35) ?? null,
    userAgent: ua,
  };
}

export type PageInfo = {
  url?: string;
  hostname?: string;
  referrer?: string;
  title?: string;
};

export function pageInfo(event: PostHogEvent): PageInfo {
  const props = event.properties;
  const url = text(props.$current_url, 2000);
  const referrer = text(props.$referrer, 2000);
  return {
    url,
    hostname: text(props.$host, 100),
    // posthog-js reports direct traffic as "$direct".
    referrer: referrer && referrer !== '$direct' ? referrer : undefined,
    title: event.event === '$pageview' ? (text(props.$title, 500) ?? text(props.title, 500)) : text(props.$title, 500),
  };
}

/** Mapped into columns or handled elsewhere; never stored as event properties. */
const DROPPED_PROPERTIES = new Set([
  'token',
  'api_key',
  'distinct_id',
  '$distinct_id',
  // Flareboard never stores IP addresses or raw user agents.
  '$ip',
  '$raw_user_agent',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'fbclid',
  'msclkid',
  'ttclid',
  'li_fat_id',
  'twclid',
]);

/** PostHog's own `$` properties worth keeping; the rest are SDK internals or mapped to columns. */
const KEPT_DOLLAR_PROPERTIES = new Set([
  '$lib',
  '$lib_version',
  '$feature_flag',
  '$feature_flag_response',
  '$event_type',
  '$el_text',
  '$elements_chain',
  '$external_click_url',
  '$exception_fingerprint',
]);
const KEPT_DOLLAR_PREFIXES = ['$feature/', '$prev_pageview_', '$survey', '$ai_'];

function keepDollarProperty(key: string) {
  return KEPT_DOLLAR_PROPERTIES.has(key) || KEPT_DOLLAR_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Event properties to store: the customer's own properties first, then the PostHog `$`
 * properties worth keeping, as primitives, within the key and size budget.
 */
export function eventProperties(event: PostHogEvent, exclude: ReadonlySet<string> = new Set()): Json {
  const custom: Array<[string, unknown]> = [];
  const dollar: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(event.properties)) {
    if (DROPPED_PROPERTIES.has(key) || exclude.has(key)) continue;
    if (value === null || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    if (key.startsWith('$')) {
      if (keepDollarProperty(key)) dollar.push([key, value]);
    } else {
      custom.push([key, value]);
    }
  }
  const out: Json = {};
  let bytes = 0;
  let count = 0;
  for (const [key, value] of [...custom, ...dollar]) {
    if (count >= MAX_PROPERTIES) break;
    const size = key.length + (typeof value === 'string' ? Math.min(value.length, 2000) : 8);
    if (bytes + size > MAX_PROPERTY_BYTES) continue;
    out[key] = value;
    bytes += size;
    count++;
  }
  return out;
}

/** At most MAX_PERSON_PROPERTIES keys of a `$set` / `$set_once` object. */
export function personProperties(value: Json | undefined): Json | undefined {
  if (!value) return undefined;
  const entries = Object.entries(value).filter(([key]) => key !== '$ip').slice(0, MAX_PERSON_PROPERTIES);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

const SEVERITIES = new Set(['fatal', 'error', 'warning', 'info']);

type ExceptionFrame = { filename?: unknown; abs_path?: unknown; function?: unknown; lineno?: unknown; colno?: unknown };

/** Fields of Flareboard's error event from a PostHog `$exception`. */
export function exceptionPayload(properties: Json) {
  const list = Array.isArray(properties.$exception_list) ? properties.$exception_list.filter(isRecord) : [];
  const first = list[0];
  const mechanism = isRecord(first?.mechanism) ? first.mechanism : {};
  const frames = (
    isRecord(first?.stacktrace) && Array.isArray(first.stacktrace.frames) ? first.stacktrace.frames : []
  ).filter(isRecord) as ExceptionFrame[];
  // PostHog (like Sentry) lists frames oldest first; the crash site is the last one.
  const top = frames[frames.length - 1];
  const frameLine = (frame: ExceptionFrame) => {
    const file = text(frame.filename) ?? text(frame.abs_path) ?? '<anonymous>';
    const fn = text(frame.function);
    const position = [file, finite(frame.lineno), finite(frame.colno)].filter((part) => part != null).join(':');
    return fn ? `    at ${fn} (${position})` : `    at ${position}`;
  };
  const message =
    text(first?.value, 1000) ?? text(properties.$exception_message, 1000) ?? text(properties.message, 1000) ?? 'Unknown error';
  const errorName = text(first?.type, 200) ?? text(properties.$exception_type, 200) ?? 'Error';
  const stack =
    text(properties.$exception_stack_trace_raw) ??
    (frames.length ? [`${errorName}: ${message}`, ...frames.slice().reverse().map(frameLine)].join('\n') : undefined);
  const level = text(properties.$exception_level)?.toLowerCase();
  const handled = typeof mechanism.handled === 'boolean' ? mechanism.handled : properties.$exception_handled === true;
  const lineno = finite(top?.lineno) ?? finite(properties.$exception_lineno);
  const colno = finite(top?.colno) ?? finite(properties.$exception_colno);
  return {
    message,
    name: errorName,
    stack: stack?.slice(0, 12000),
    source: text(top?.filename, 1000) ?? text(top?.abs_path, 1000) ?? text(properties.$exception_source, 1000),
    lineno: lineno != null ? Math.max(0, Math.round(lineno)) : undefined,
    colno: colno != null ? Math.max(0, Math.round(colno)) : undefined,
    severity: level && SEVERITIES.has(level) ? level : 'error',
    handled,
    release: text(properties.release, 200) ?? text(properties.$app_version, 200),
    environment: text(properties.environment, 100),
  };
}

/** Exception properties folded into the error payload instead of stored twice. */
export const EXCEPTION_PROPERTIES = new Set([
  '$exception_message',
  '$exception_type',
  '$exception_source',
  '$exception_lineno',
  '$exception_colno',
  '$exception_level',
  '$exception_handled',
  '$exception_stack_trace_raw',
  'message',
  'release',
  'environment',
]);

/** Core Web Vitals from posthog-js `$web_vitals`, or null when none are present. */
export function webVitals(properties: Json) {
  const pick = (name: string, max: number) => {
    const value = finite(properties[`$web_vitals_${name}_value`]);
    return value != null && value >= 0 && value <= max ? value : null;
  };
  const vitals = { lcp: pick('LCP', 60000), inp: pick('INP', 60000), cls: pick('CLS', 100), fcp: pick('FCP', 60000), ttfb: null };
  return vitals.lcp != null || vitals.inp != null || vitals.cls != null || vitals.fcp != null ? vitals : null;
}

/** Group type -> key from `$groups`. */
export function eventGroups(properties: Json): Array<[type: string, key: string]> {
  if (!isRecord(properties.$groups)) return [];
  const out: Array<[string, string]> = [];
  for (const [type, key] of Object.entries(properties.$groups)) {
    const groupType = text(type, 80);
    const groupKey = typeof key === 'number' && Number.isFinite(key) ? String(key) : text(key, 200);
    if (groupType && groupKey && !groupType.includes('/')) out.push([groupType, groupKey]);
  }
  return out.slice(0, 10);
}

/** Session-recording and other payloads Flareboard does not ingest through this path. */
export function ignoredEvent(name: string) {
  return name.startsWith('$$') || name === '$snapshot' || name === '$snapshot_items' || name === '$performance_event';
}
