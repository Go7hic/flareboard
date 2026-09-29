/**
 * Server side of the replay privacy rules for one recorded chunk (rrweb events from
 * recorder.js), applied before anything reaches R2:
 * - console (`$console`) and network (`$network`) custom events are dropped unless the website
 *   opted in to that capture, and otherwise rebuilt from an allowlist of fields: a console entry
 *   is a level and a truncated message, a network entry is method, URL without query string or
 *   fragment, status, duration, size and a failed flag. Headers and bodies never survive, even
 *   from an outdated or modified recorder;
 * - activity counters for the replay list (clicks, input changes, console messages by level,
 *   failed requests) are taken from the same events.
 */

export const CONSOLE_TAG = '$console';
export const NETWORK_TAG = '$network';

const MAX_MESSAGE = 1000;
const MAX_URL = 500;
const CONSOLE_LEVELS = new Set(['log', 'info', 'warn', 'error', 'debug']);

/** rrweb EventType / IncrementalSource / MouseInteractions values used below. */
const INCREMENTAL = 3;
const CUSTOM = 5;
const SOURCE_MOUSE_INTERACTION = 2;
const SOURCE_INPUT = 5;
const MOUSE_CLICK = 2;

export type ReplayCaptureSettings = { console: boolean; network: boolean };

export type ReplayChunkCounts = {
  clickCount: number;
  inputCount: number;
  consoleLogCount: number;
  consoleWarnCount: number;
  consoleErrorCount: number;
  networkErrorCount: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function finiteOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

/** Drops the query string and fragment of a URL (absolute or relative). */
export function stripUrl(raw: string) {
  const cut = raw.search(/[?#]/);
  return clip(cut === -1 ? raw : raw.slice(0, cut), MAX_URL);
}

function consolePayload(payload: Record<string, unknown>) {
  const level = typeof payload.level === 'string' && CONSOLE_LEVELS.has(payload.level) ? payload.level : 'log';
  const message = typeof payload.message === 'string' ? clip(payload.message, MAX_MESSAGE) : '';
  return { level, message };
}

function networkPayload(payload: Record<string, unknown>) {
  const method = typeof payload.method === 'string' ? payload.method.toUpperCase().slice(0, 10) : 'GET';
  const url = typeof payload.url === 'string' ? stripUrl(payload.url) : '';
  const status = finiteOrNull(payload.status) ?? 0;
  return {
    method,
    url,
    status,
    duration: finiteOrNull(payload.duration),
    size: finiteOrNull(payload.size),
    failed: payload.failed === true,
  };
}

export function sanitizeReplayChunk(events: unknown[], settings: ReplayCaptureSettings) {
  const counts: ReplayChunkCounts = {
    clickCount: 0,
    inputCount: 0,
    consoleLogCount: 0,
    consoleWarnCount: 0,
    consoleErrorCount: 0,
    networkErrorCount: 0,
  };
  const kept: unknown[] = [];
  for (const event of events) {
    const e = record(event);
    const data = e ? record(e.data) : null;
    if (e && data && e.type === CUSTOM && (data.tag === CONSOLE_TAG || data.tag === NETWORK_TAG)) {
      const payload = record(data.payload) ?? {};
      if (data.tag === CONSOLE_TAG) {
        if (!settings.console) continue;
        const entry = consolePayload(payload);
        if (entry.level === 'error') counts.consoleErrorCount++;
        else if (entry.level === 'warn') counts.consoleWarnCount++;
        else counts.consoleLogCount++;
        kept.push({ ...e, data: { tag: CONSOLE_TAG, payload: entry } });
      } else {
        if (!settings.network) continue;
        const entry = networkPayload(payload);
        if (entry.failed || entry.status >= 400) counts.networkErrorCount++;
        kept.push({ ...e, data: { tag: NETWORK_TAG, payload: entry } });
      }
      continue;
    }
    if (e && data && e.type === INCREMENTAL) {
      if (data.source === SOURCE_MOUSE_INTERACTION && data.type === MOUSE_CLICK) counts.clickCount++;
      else if (data.source === SOURCE_INPUT) counts.inputCount++;
    }
    kept.push(event);
  }
  return { events: kept, counts };
}
