import type { WebsiteStats } from './api';
import { formatChartTimeLabel } from './chartTimeseries';

export type CompareMode = 'previous' | 'year';

const MS_YEAR = 365 * 24 * 60 * 60 * 1000;

export function computeCompareRange(startAt: number, endAt: number, mode: CompareMode) {
  const periodMs = endAt - startAt;
  if (mode === 'year') {
    return { compareStartAt: startAt - MS_YEAR, compareEndAt: endAt - MS_YEAR };
  }
  return { compareStartAt: startAt - periodMs, compareEndAt: startAt };
}

export function chartUnitForRange(startAt: number, endAt: number): 'hour' | 'day' | 'month' {
  const periodMs = endAt - startAt;
  if (periodMs <= 48 * 60 * 60 * 1000) return 'hour';
  if (periodMs <= 90 * 24 * 60 * 60 * 1000) return 'day';
  return 'month';
}

export function pctChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export function bounceRateFromStats(stats: WebsiteStats) {
  const visits = stats.visits.value;
  return visits > 0 ? Math.round((stats.bounces.value / visits) * 100) : 0;
}

export function avgDurationSecFromStats(stats: WebsiteStats) {
  const visits = stats.visits.value;
  return visits > 0 ? Math.round(stats.totaltime.value / visits) : 0;
}

export function formatDuration(seconds: number) {
  if (seconds <= 0) return '0s';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  if (secs <= 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

export function formatCompareRangeLabel(startAt: number, endAt: number) {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const start = new Date(startAt).toLocaleDateString(undefined, opts);
  const end = new Date(endAt).toLocaleDateString(undefined, opts);
  return `${start} — ${end}`;
}

export type MetricsSeriesPoint = { x: string; y: number };

export type MetricsSeries = {
  pageviews: MetricsSeriesPoint[];
  visitors: MetricsSeriesPoint[];
};

export function mergeCompareChartData(
  primary: MetricsSeries,
  compare: MetricsSeries,
  unit: 'hour' | 'day' | 'month' | 'year' | string,
  timezone = 'UTC',
) {
  const len = Math.max(primary.pageviews.length, compare.pageviews.length, 1);
  const rows = [];
  for (let i = 0; i < len; i += 1) {
    const currentPv = primary.pageviews[i];
    const label = currentPv?.x ?? compare.pageviews[i]?.x ?? String(i);
    rows.push({
      x: formatChartBucketLabel(label, unit, timezone),
      pageviews: currentPv?.y ?? 0,
      visitors: primary.visitors[i]?.y ?? 0,
      pageviewsPrev: compare.pageviews[i]?.y ?? 0,
      visitorsPrev: compare.visitors[i]?.y ?? 0,
    });
  }
  return rows;
}

function formatChartBucketLabel(raw: string, unit: string, timezone: string) {
  if (unit === 'hour') return formatChartTimeLabel(raw, true, timezone);
  if (unit === 'day') return formatChartTimeLabel(raw, false, timezone);
  if (unit === 'month') return raw;
  return raw;
}
