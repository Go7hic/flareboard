export type MetricsSeries = {
  pageviews: { x: string; y: number }[];
  visitors: { x: string; y: number }[];
};

export function isHourlyChartRange(startAt: number, endAt: number): boolean {
  return endAt - startAt <= 48 * 60 * 60 * 1000;
}

/** Match API compare/overview chart bucketing. */
export function chartUnitForRange(startAt: number, endAt: number): 'hour' | 'day' | 'month' {
  const periodMs = endAt - startAt;
  if (periodMs <= 48 * 60 * 60 * 1000) return 'hour';
  if (periodMs <= 90 * 24 * 60 * 60 * 1000) return 'day';
  return 'month';
}

export function formatChartTimeLabel(x: string, hourly: boolean): string {
  if (hourly && x.includes(' ')) {
    const [, time] = x.split(' ');
    return time?.slice(0, 5) ?? x;
  }
  const parts = x.split('-');
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  return x;
}

export function mergePageviewsVisitors(
  series: MetricsSeries | undefined,
  hourly: boolean,
): Array<{ x: string; pageviews: number; visitors: number }> {
  if (!series) return [];

  const byKey = new Map<string, { rawX: string; pageviews: number; visitors: number }>();

  for (const point of series.pageviews) {
    const row = byKey.get(point.x) ?? { rawX: point.x, pageviews: 0, visitors: 0 };
    row.pageviews = point.y;
    byKey.set(point.x, row);
  }
  for (const point of series.visitors) {
    const row = byKey.get(point.x) ?? { rawX: point.x, pageviews: 0, visitors: 0 };
    row.visitors = point.y;
    byKey.set(point.x, row);
  }

  return Array.from(byKey.values())
    .sort((a, b) => a.rawX.localeCompare(b.rawX))
    .map(({ rawX, pageviews, visitors }) => ({
      x: formatChartTimeLabel(rawX, hourly),
      pageviews,
      visitors,
    }));
}
