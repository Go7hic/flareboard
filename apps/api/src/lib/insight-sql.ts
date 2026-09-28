/**
 * Building blocks shared by the insight engines (trends, funnels, retention, lifecycle,
 * stickiness): event matchers, counting units, site-timezone buckets.
 */
import { EVENT_TYPE, type InsightEvent, type InsightInterval, type PropertyFilter } from '@flareboard/shared';
import { siteUtcOffsetMs } from '@flareboard/shared/timezone';
import { compilePropertyFilters, InsightQueryError, likeContainsPattern, SqlParams } from './property-filters';
import { regexToGlob } from '@flareboard/shared';
import { siteLocalMsSql } from './site-time';

export type CountBy = 'person' | 'session';

/** Everything an engine needs besides the query itself. */
export type InsightContext = {
  db: D1Database;
  websiteId: string;
  startAt: number;
  endAt: number;
  timezone: string;
};

/** Counting unit: the identified distinct id, else the session. */
export function unitSql(countBy: CountBy): { sql: string; needsSession: boolean } {
  if (countBy === 'session') return { sql: 'e.session_id', needsSession: false };
  return { sql: "COALESCE(NULLIF(s.distinct_id, ''), e.session_id)", needsSession: true };
}

export function sessionJoinSql(needed: boolean): string {
  return needed ? ' LEFT JOIN session s ON s.session_id = e.session_id' : '';
}

/** Condition for "this row is the series / step event", including its own property filters. */
export function eventMatcherSql(event: InsightEvent, params: SqlParams): { sql: string; needsSession: boolean } {
  const parts: string[] = [];
  if (event.kind === 'pageview') {
    parts.push(`e.event_type = ${EVENT_TYPE.pageView}`);
    if (event.url) {
      if (event.url.match === 'exact') parts.push(`e.url_path = ${params.add(event.url.value)}`);
      else if (event.url.match === 'contains') {
        parts.push(`e.url_path LIKE ${params.add(likeContainsPattern(event.url.value))} ESCAPE '\\'`);
      } else {
        const compiled = regexToGlob(event.url.value);
        if (!compiled.ok) throw new InsightQueryError(compiled.reason);
        const globs = compiled.globs.map((glob) => `e.url_path GLOB ${params.add(glob)}`);
        parts.push(globs.length === 1 ? globs[0]! : `(${globs.join(' OR ')})`);
      }
    }
  } else if (event.kind === 'all') {
    parts.push(`e.event_type IN (${EVENT_TYPE.pageView}, ${EVENT_TYPE.customEvent})`);
  } else {
    parts.push(`e.event_type = ${EVENT_TYPE.customEvent}`);
    if (event.event) parts.push(`e.event_name = ${params.add(event.event)}`);
  }
  const filters = compilePropertyFilters(event.filters, params);
  if (filters.sql) parts.push(filters.sql);
  return { sql: parts.join(' AND '), needsSession: filters.needsSession };
}

/** `AND <global filters>` (or '') plus whether they need the session join. */
export function globalFiltersSql(filters: readonly PropertyFilter[] | undefined, params: SqlParams) {
  const compiled = compilePropertyFilters(filters, params);
  return { sql: compiled.sql ? ` AND ${compiled.sql}` : '', needsSession: compiled.needsSession };
}

/** Human-readable default label of an event matcher. */
export function eventLabel(event: InsightEvent): string {
  if (event.label) return event.label;
  if (event.kind === 'pageview') return event.url ? `Pageview ${event.url.value}` : 'Pageview';
  if (event.kind === 'all') return 'All activity';
  return event.event || 'All events';
}

// ---------------------------------------------------------------------------------------------
// Site-timezone buckets. SQL and JS produce identical labels:
//   hour 'YYYY-MM-DD HH:00', day 'YYYY-MM-DD', week 'YYYY-MM-DD' (Sunday), month 'YYYY-MM'.
// ---------------------------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 86_400_000;
export const MAX_INSIGHT_BUCKETS = 750;

/** Site wall-clock time of an instant, as if it were UTC. */
export function toLocalMs(utcMs: number, timezone: string): number {
  return utcMs + siteUtcOffsetMs(utcMs, timezone);
}

/** Instant of a site wall-clock time (inverse of toLocalMs; DST gaps resolve forward). */
export function fromLocalMs(localMs: number, timezone: string): number {
  let guess = localMs - siteUtcOffsetMs(localMs, timezone);
  guess = localMs - siteUtcOffsetMs(guess, timezone);
  return guess;
}

export function floorLocal(localMs: number, interval: InsightInterval): number {
  const d = new Date(localMs);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  switch (interval) {
    case 'hour':
      return Math.floor(localMs / HOUR) * HOUR;
    case 'day':
      return day;
    case 'week':
      return day - d.getUTCDay() * DAY;
    case 'month':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
}

export function stepLocal(localMs: number, interval: InsightInterval, steps = 1): number {
  switch (interval) {
    case 'hour':
      return localMs + steps * HOUR;
    case 'day':
      return localMs + steps * DAY;
    case 'week':
      return localMs + steps * 7 * DAY;
    case 'month': {
      const d = new Date(localMs);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + steps, 1);
    }
  }
}

export function localLabel(localMs: number, interval: InsightInterval): string {
  const iso = new Date(localMs).toISOString();
  if (interval === 'hour') return `${iso.slice(0, 10)} ${iso.slice(11, 13)}:00`;
  if (interval === 'month') return iso.slice(0, 7);
  return iso.slice(0, 10);
}

/** Every bucket label from startAt to endAt (inclusive) in the site's calendar. */
export function bucketLabels(startAt: number, endAt: number, interval: InsightInterval, timezone: string): string[] {
  const labels: string[] = [];
  const last = toLocalMs(endAt, timezone);
  for (let cur = floorLocal(toLocalMs(startAt, timezone), interval); cur <= last; cur = stepLocal(cur, interval)) {
    labels.push(localLabel(cur, interval));
    if (labels.length > MAX_INSIGHT_BUCKETS * 40) break;
  }
  return labels;
}

const COARSER: Record<InsightInterval, InsightInterval | null> = {
  hour: 'day',
  day: 'week',
  week: 'month',
  month: null,
};

/** The requested interval, coarsened until the range fits MAX_INSIGHT_BUCKETS buckets. */
export function resolveInterval(
  requested: InsightInterval,
  startAt: number,
  endAt: number,
  timezone: string,
): InsightInterval {
  let interval = requested;
  while (COARSER[interval] && bucketLabels(startAt, endAt, interval, timezone).length > MAX_INSIGHT_BUCKETS) {
    interval = COARSER[interval]!;
  }
  return interval;
}

/** SQL bucket label of `e.created_at` (offsets for [startAt, endAt] are inlined, no binds). */
export function bucketSql(interval: InsightInterval, startAt: number, endAt: number, timezone: string): string {
  const seconds = `(${siteLocalMsSql('e.created_at', startAt, endAt, timezone)}) / 1000`;
  switch (interval) {
    case 'hour':
      return `strftime('%Y-%m-%d %H:00', ${seconds}, 'unixepoch')`;
    case 'day':
      return `strftime('%Y-%m-%d', ${seconds}, 'unixepoch')`;
    case 'week':
      return `date(${seconds}, 'unixepoch', '-6 days', 'weekday 0')`;
    case 'month':
      return `strftime('%Y-%m', ${seconds}, 'unixepoch')`;
  }
}

/**
 * Integer period index of `column` (epoch ms) relative to `originLocal`, the site-local start of
 * period 0. Rows must satisfy `column >= fromLocalMs(originLocal)` (integer division truncates
 * toward zero, so earlier rows would land in period 0).
 */
export function periodIndexSql(
  column: string,
  interval: InsightInterval,
  originLocal: number,
  startAt: number,
  endAt: number,
  timezone: string,
): string {
  const local = siteLocalMsSql(column, startAt, endAt, timezone);
  if (interval === 'month') {
    const origin = new Date(originLocal);
    const originIndex = origin.getUTCFullYear() * 12 + origin.getUTCMonth();
    const seconds = `(${local}) / 1000`;
    return `(CAST(strftime('%Y', ${seconds}, 'unixepoch') AS INTEGER) * 12 + CAST(strftime('%m', ${seconds}, 'unixepoch') AS INTEGER) - 1 - ${originIndex})`;
  }
  const length = interval === 'hour' ? HOUR : interval === 'day' ? DAY : 7 * DAY;
  return `((${local} - ${originLocal}) / ${length})`;
}

/** Run one statement after checking D1's bound-parameter limit. */
export async function allRows<T>(db: D1Database, sql: string, params: SqlParams): Promise<T[]> {
  params.assertWithinLimit();
  const result = await db
    .prepare(sql)
    .bind(...params.values)
    .all<T>();
  return result.results ?? [];
}

/** SQL value mapped from `char(1)` (property not set) and `char(2)` (Other) sentinels. */
export const NONE_SENTINEL = '\u0001';
export const OTHER_SENTINEL = '\u0002';

export function decodeBreakdownValue(raw: string | null): { value: string | null; isOther: boolean } {
  if (raw === OTHER_SENTINEL) return { value: null, isOther: true };
  if (raw === NONE_SENTINEL || raw === null) return { value: null, isOther: false };
  return { value: raw, isOther: false };
}
