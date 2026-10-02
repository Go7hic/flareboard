import { formatChartTimeLabel } from '../../lib/chartTimeseries';
import { getLocale } from '../../lib/i18n';

/**
 * Time-bucket helpers for the traffic charts. The API returns sparse buckets (only buckets
 * with data): hour keys are UTC `YYYY-MM-DD HH:00`, day keys are site-local `YYYY-MM-DD`,
 * month keys are site-local `YYYY-MM`. Charts need every bucket in the range so the x axis
 * keeps real time spacing, and comparison periods must line up bucket by bucket.
 */

export type SeriesUnit = 'hour' | 'day' | 'month';
export type SeriesPoint = { x: string; y: number };

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function seriesUnitForRange(startAt: number, endAt: number): SeriesUnit {
  const span = endAt - startAt;
  if (span <= 48 * HOUR_MS) return 'hour';
  if (span <= 90 * DAY_MS) return 'day';
  return 'month';
}

function utcHourKey(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 13).replace('T', ' ')}:00`;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function localDayKey(ms: number, timeZone: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    dayFormatters.set(timeZone, formatter);
  }
  return formatter.format(new Date(ms));
}

/** Every bucket key from `startAt` to `endAt` in the API's format for `unit`. */
export function bucketKeys(startAt: number, endAt: number, unit: SeriesUnit, timeZone = 'UTC'): string[] {
  if (!(endAt >= startAt)) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  if (unit === 'hour') {
    for (let ms = Math.floor(startAt / HOUR_MS) * HOUR_MS; ms <= endAt; ms += HOUR_MS) push(utcHourKey(ms));
    return keys;
  }
  // Six-hour steps catch every local date across DST changes; the end is always included.
  for (let ms = startAt; ms <= endAt; ms += 6 * HOUR_MS) {
    const day = localDayKey(ms, timeZone);
    push(unit === 'month' ? day.slice(0, 7) : day);
  }
  const last = localDayKey(endAt, timeZone);
  push(unit === 'month' ? last.slice(0, 7) : last);
  return keys;
}

/** Moves a bucket key by whole units (calendar arithmetic, timezone-free). */
export function shiftBucketKey(key: string, unit: SeriesUnit, steps: number): string {
  if (!steps) return key;
  if (unit === 'hour') {
    const ms = Date.parse(`${key.replace(' ', 'T')}:00.000Z`);
    return Number.isNaN(ms) ? key : utcHourKey(ms + steps * HOUR_MS);
  }
  if (unit === 'day') {
    const ms = Date.parse(`${key}T00:00:00.000Z`);
    return Number.isNaN(ms) ? key : new Date(ms + steps * DAY_MS).toISOString().slice(0, 10);
  }
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  const date = new Date(Date.UTC(year, month - 1 + steps, 1));
  return date.toISOString().slice(0, 7);
}

/** Zero-filled series over `keys` (buckets the API left out had no events). */
export function fillSeries(points: SeriesPoint[] | undefined, keys: string[]): SeriesPoint[] {
  const byKey = new Map((points ?? []).map((point) => [point.x, point.y]));
  return keys.map((key) => ({ x: key, y: byKey.get(key) ?? 0 }));
}

/** Axis / tooltip label for a bucket key. */
export function bucketLabel(key: string, unit: SeriesUnit, timeZone = 'UTC'): string {
  if (unit === 'month') {
    const [year, month] = key.split('-').map(Number);
    if (!year || !month) return key;
    return new Intl.DateTimeFormat(getLocale(), { timeZone: 'UTC', year: 'numeric', month: 'short' }).format(
      new Date(Date.UTC(year, month - 1, 15)),
    );
  }
  return formatChartTimeLabel(key, unit === 'hour', timeZone);
}

export type ComparePoint = {
  key: string;
  /** Bucket of the comparison period that lines up with `key`. */
  previousKey: string;
  current: number;
  /** Null before the comparison period has any data (no line instead of a false zero). */
  previous: number | null;
};

/**
 * Lines the comparison period up with the current one bucket by bucket: each comparison
 * bucket moves forward by the gap between the two period starts. The API returns sparse
 * buckets, so pairing by array index (the old behaviour) drifted whenever either period
 * had empty buckets.
 */
export function alignCompareSeries({
  current,
  previous,
  unit,
  startAt,
  endAt,
  previousStartAt,
  timeZone,
}: {
  current: SeriesPoint[] | undefined;
  previous: SeriesPoint[] | undefined;
  unit: SeriesUnit;
  startAt: number;
  endAt: number;
  previousStartAt: number;
  timeZone: string;
}): ComparePoint[] {
  const gap = startAt - previousStartAt;
  const steps =
    unit === 'hour' ? Math.round(gap / HOUR_MS) : unit === 'day' ? Math.round(gap / DAY_MS) : Math.round(gap / (30.436875 * DAY_MS));
  const keys = bucketKeys(startAt, endAt, unit, timeZone);
  const currentByKey = new Map((current ?? []).map((point) => [point.x, point.y]));
  const previousByKey = new Map<string, number>();
  let firstPrevious: string | null = null;
  for (const point of previous ?? []) {
    const shifted = shiftBucketKey(point.x, unit, steps);
    previousByKey.set(shifted, (previousByKey.get(shifted) ?? 0) + point.y);
    if (firstPrevious === null || shifted < firstPrevious) firstPrevious = shifted;
  }
  return keys.map((key) => ({
    key,
    previousKey: shiftBucketKey(key, unit, -steps),
    current: currentByKey.get(key) ?? 0,
    previous: previousByKey.get(key) ?? (firstPrevious !== null && key > firstPrevious ? 0 : null),
  }));
}
