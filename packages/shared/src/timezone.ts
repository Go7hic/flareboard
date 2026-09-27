export type SiteTimezone = string;

export const DEFAULT_SITE_TIMEZONE: SiteTimezone = 'UTC';

export const SITE_TIMEZONE_OPTIONS: readonly SiteTimezone[] = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
] as const;

export function isValidSiteTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function calendarParts(ms: number, timezone: SiteTimezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('hour') === 24 ? 0 : get('second'),
  };
}

function siteLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timezone: SiteTimezone,
): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  for (let i = 0; i < 4; i += 1) {
    const actual = calendarParts(guess, timezone);
    const target = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    const current = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      0,
    );
    const diff = target - current;
    guess += diff;
    if (diff === 0) break;
  }
  return guess;
}

function addLocalCalendarDays(ms: number, deltaDays: number, timezone: SiteTimezone): number {
  const { year, month, day } = calendarParts(ms, timezone);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return siteLocalToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
    0,
    0,
    timezone,
  );
}

export function siteStartOfDay(ms: number, timezone: SiteTimezone): number {
  const { year, month, day } = calendarParts(ms, timezone);
  return siteLocalToUtc(year, month, day, 0, 0, 0, 0, timezone);
}

export function siteEndOfDay(ms: number, timezone: SiteTimezone): number {
  const nextDayStart = addLocalCalendarDays(siteStartOfDay(ms, timezone), 1, timezone);
  return nextDayStart - 1;
}

export function siteCalendarDaysRange(
  dayCount: number,
  timezone: SiteTimezone,
  now = Date.now(),
): { startAt: number; endAt: number } {
  const endAt = siteEndOfDay(now, timezone);
  const startAt = addLocalCalendarDays(now, -(dayCount - 1), timezone);
  return { startAt, endAt };
}

export function siteCustomRange(
  startLocal: string,
  endLocal: string,
  timezone: SiteTimezone,
): { startAt: number; endAt: number } {
  const parse = (value: string) => {
    const [datePart, timePart = '00:00'] = value.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    return siteLocalToUtc(year, month, day, hour, minute, 0, 0, timezone);
  };
  return { startAt: parse(startLocal), endAt: parse(endLocal) };
}

export function formatHourBucketLabel(utcBucket: string, timezone: SiteTimezone): string {
  const trimmed = utcBucket.trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(trimmed)) return utcBucket;
  const ms = Date.parse(`${trimmed.replace(' ', 'T')}:00.000Z`);
  if (Number.isNaN(ms)) return utcBucket;
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

/**
 * Day buckets are already calendar dates in the site's timezone (the API buckets by
 * site-local day), so format the date as-is. Re-projecting it into the timezone
 * shifted labels by a day for zones beyond ±12h.
 */
export function formatDayBucketLabel(day: string, _timezone?: SiteTimezone): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const ms = Date.parse(`${day}T12:00:00.000Z`);
  if (Number.isNaN(ms)) return day;
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(ms));
}

/** Milliseconds to add to a UTC instant to get the site's wall-clock time. */
export function siteUtcOffsetMs(ms: number, timezone: SiteTimezone): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const p = calendarParts(whole, timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}

/**
 * The site's UTC offset across [startAt, endAt], split at DST transitions: each
 * segment applies until `until` (exclusive); the last one has `until: Infinity`.
 * Lets SQL bucket events by local day with a CASE over a handful of boundaries.
 */
export function siteOffsetSegments(
  startAt: number,
  endAt: number,
  timezone: SiteTimezone,
): { until: number; offsetMs: number }[] {
  const HOUR = 3_600_000;
  const segments: { until: number; offsetMs: number }[] = [];
  let current = siteUtcOffsetMs(startAt, timezone);
  for (let t = startAt + HOUR; t <= endAt + HOUR; t += HOUR) {
    const next = siteUtcOffsetMs(t, timezone);
    if (next === current) continue;
    // Narrow the transition inside the last hour to the second.
    let lo = t - HOUR;
    let hi = t;
    while (hi - lo > 1000) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (siteUtcOffsetMs(mid, timezone) === current) lo = mid;
      else hi = mid;
    }
    segments.push({ until: Math.floor(hi / 1000) * 1000, offsetMs: current });
    current = next;
  }
  segments.push({ until: Infinity, offsetMs: current });
  return segments;
}
