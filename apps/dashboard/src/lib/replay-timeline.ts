/**
 * Pure helpers behind the replay player: turn rrweb events (plus the visit's analytics events)
 * into timeline entries and scrubber markers, find inactive stretches, and build links.
 * The recorder's custom events are `$console` { level, message } and `$network`
 * { method, url, status, duration, size, failed } (apps/ingest/src/tracker/recorder.ts).
 */

export type TimelineKind = 'console' | 'network' | 'page' | 'event';
export type TimelineSeverity = 'error' | 'warn' | 'info';

export type TimelineItem = {
  id: string;
  kind: TimelineKind;
  /** Milliseconds from the start of the recording. */
  offsetMs: number;
  severity: TimelineSeverity;
  label: string;
  detail?: string;
};

export type AnalyticsEvent = {
  id: string;
  visitId?: string;
  urlPath?: string | null;
  eventType: number;
  eventName?: string | null;
  createdAt: number;
};

type RrwebEvent = { type?: number; timestamp?: number; data?: Record<string, unknown> };

/** rrweb EventType / IncrementalSource values used here. */
const META = 4;
const INCREMENTAL = 3;
const CUSTOM = 5;
/** MouseMove … Input count as user activity (same rule as rrweb-player). */
const ACTIVE_SOURCES = new Set([1, 2, 3, 4, 5, 6]);

/** Website event types shown on the timeline (EVENT_TYPE in @flareboard/shared). */
const CUSTOM_EVENT = 2;
const ERROR = 8;
const LOG = 9;
const AI = 10;
const TIMELINE_EVENT_TYPES = new Set([CUSTOM_EVENT, ERROR, LOG, AI]);

export const INACTIVITY_THRESHOLD_MS = 5000;

function asEvents(events: unknown[]): RrwebEvent[] {
  return events.filter((event): event is RrwebEvent => Boolean(event) && typeof event === 'object');
}

export function replayBounds(events: unknown[]) {
  let start = Infinity;
  let end = -Infinity;
  for (const event of asEvents(events)) {
    if (typeof event.timestamp !== 'number') continue;
    start = Math.min(start, event.timestamp);
    end = Math.max(end, event.timestamp);
  }
  if (!Number.isFinite(start)) return { startTime: 0, endTime: 0, totalMs: 0 };
  return { startTime: start, endTime: end, totalMs: end - start };
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} kB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function pathOf(href: string) {
  try {
    const url = new URL(href);
    return url.pathname + url.search;
  } catch {
    return href;
  }
}

/** Timeline entries in time order: console, network, page loads and analytics events. */
export function buildTimeline(events: unknown[], analytics: AnalyticsEvent[] = []): TimelineItem[] {
  const { startTime, endTime } = replayBounds(events);
  const items: TimelineItem[] = [];
  asEvents(events).forEach((event, index) => {
    if (typeof event.timestamp !== 'number') return;
    const offsetMs = event.timestamp - startTime;
    const data = event.data ?? {};
    if (event.type === META && typeof data.href === 'string') {
      items.push({ id: `page-${index}`, kind: 'page', offsetMs, severity: 'info', label: pathOf(data.href) });
      return;
    }
    if (event.type !== CUSTOM) return;
    const payload = (data.payload ?? {}) as Record<string, unknown>;
    if (data.tag === '$console') {
      const level = typeof payload.level === 'string' ? payload.level : 'log';
      items.push({
        id: `console-${index}`,
        kind: 'console',
        offsetMs,
        severity: level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info',
        label: typeof payload.message === 'string' ? payload.message : '',
        detail: level,
      });
    } else if (data.tag === '$network') {
      const status = typeof payload.status === 'number' ? payload.status : 0;
      const failed = payload.failed === true || status >= 400;
      const parts = [status ? String(status) : failed ? 'failed' : ''];
      if (typeof payload.duration === 'number') parts.push(`${payload.duration} ms`);
      if (typeof payload.size === 'number' && payload.size > 0) parts.push(formatBytes(payload.size));
      items.push({
        id: `network-${index}`,
        kind: 'network',
        offsetMs,
        severity: failed ? 'error' : 'info',
        label: `${typeof payload.method === 'string' ? payload.method : 'GET'} ${typeof payload.url === 'string' ? payload.url : ''}`,
        detail: parts.filter(Boolean).join(' · '),
      });
    }
  });
  for (const event of analytics) {
    // Page loads come from the recording itself; heatmap and performance rows are noise here.
    if (!TIMELINE_EVENT_TYPES.has(event.eventType)) continue;
    if (event.createdAt < startTime - 1000 || event.createdAt > endTime + 1000) continue;
    items.push({
      id: `event-${event.id}`,
      kind: 'event',
      offsetMs: Math.max(0, event.createdAt - startTime),
      severity: event.eventType === ERROR ? 'error' : event.eventType === LOG ? 'warn' : 'info',
      label: event.eventName || event.urlPath || '',
      detail: event.urlPath ?? undefined,
    });
  }
  return items.sort((a, b) => a.offsetMs - b.offsetMs);
}

/** Stretches without user activity longer than the threshold, as [startMs, endMs] offsets. */
export function inactivePeriods(events: unknown[], thresholdMs = INACTIVITY_THRESHOLD_MS): Array<[number, number]> {
  const { startTime, endTime } = replayBounds(events);
  const active = asEvents(events)
    .filter(
      (event) =>
        typeof event.timestamp === 'number' &&
        (event.type !== INCREMENTAL || ACTIVE_SOURCES.has(Number(event.data?.source))) &&
        event.type !== CUSTOM,
    )
    .map((event) => event.timestamp! - startTime)
    .sort((a, b) => a - b);
  const periods: Array<[number, number]> = [];
  let last = 0;
  for (const at of [...active, endTime - startTime]) {
    if (at - last > thresholdMs) periods.push([last, at]);
    last = Math.max(last, at);
  }
  return periods;
}

/** Scrubber markers: errors and warnings everywhere, page loads and analytics events too. */
export function timelineMarkers(items: TimelineItem[]) {
  return items.filter((item) => item.severity !== 'info' || item.kind === 'page' || item.kind === 'event');
}

/** The last entry at or before the playhead (the one to highlight), or -1. */
export function activeItemIndex(items: TimelineItem[], currentMs: number) {
  let found = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.offsetMs <= currentMs) found = i;
    else break;
  }
  return found;
}

/** `m:ss` (or `h:mm:ss`) for a millisecond offset. */
export function formatPlayerTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** Adds `t=<seconds>` to a link (whole seconds; omitted at the very start). */
export function linkAtTime(href: string, ms: number) {
  const url = new URL(href);
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds > 0) url.searchParams.set('t', String(seconds));
  else url.searchParams.delete('t');
  return url.toString();
}

/** Start offset in ms from a `t` query value (seconds), or 0. */
export function parseStartParam(value: string | null) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) * 1000 : 0;
}

export const PLAYER_SPEEDS = [0.5, 1, 2, 4, 8] as const;
