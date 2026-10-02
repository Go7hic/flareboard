import { Fragment, useMemo, type CSSProperties } from 'react';
import type { TrafficHeatmapCell } from '../hooks/useTrafficHeatmap';
import { formatNumber } from '../lib/format';
import { getLocale, t } from '../lib/i18n';
import { EmptyState } from './EmptyState';
import { Skeleton } from './ui/skeleton';

const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** Steps of the sequential ramp (one hue, light → dark), also drawn as the scale legend. */
const RAMP = [0.12, 0.3, 0.5, 0.72, 1];

function dowLabel(dow: number): string {
  return t(`trafficHeatmapDow_${dow}`);
}

function formatHourLabel(hour: number): string {
  if (getLocale() === 'zh-CN') {
    return t('trafficHeatmapHour24').replace('{hour}', String(hour));
  }
  if (hour === 0) return t('trafficHeatmapHour12am');
  if (hour < 12) return t('trafficHeatmapHourAm').replace('{hour}', String(hour));
  if (hour === 12) return t('trafficHeatmapHour12pm');
  return t('trafficHeatmapHourPm').replace('{hour}', String(hour - 12));
}

/** Sequential slot-1 ramp mixed into the subtle surface, so it works on both themes. */
function cellStyle(intensity: number, count: number): CSSProperties {
  if (count <= 0) return {};
  const step = RAMP.find((value) => intensity <= value) ?? 1;
  return { background: `color-mix(in srgb, var(--chart-1) ${Math.round(step * 100)}%, var(--bg-subtle))` };
}

/**
 * Weekday × hour heatmap (console v2): 7 rows of 24 cells, one-hue sequential ramp, hour ticks
 * every 3 hours, exact counts on hover. Replaces the tall 24-row punch card.
 */
export function TrafficHeatmap({
  cells,
  max,
  loading,
}: {
  cells: TrafficHeatmapCell[];
  max: number;
  loading?: boolean;
}) {
  const matrix = useMemo(() => {
    const lookup = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c.count]));
    return DOW_ORDER.map((dow) => HOURS.map((hour) => lookup.get(`${dow}:${hour}`) ?? 0));
  }, [cells]);

  const peak = Math.max(max, 1);

  if (loading) {
    return <Skeleton className="traffic-heatmap-skeleton h-44 w-full" />;
  }

  if (!cells.length) {
    return <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />;
  }

  return (
    <div className="traffic-heatmap">
      <div className="traffic-heatmap-grid" role="grid" aria-label={t('trafficHeatmap')}>
        <span aria-hidden />
        {HOURS.map((hour) => (
          <span key={hour} className="traffic-heatmap-hour" role="columnheader" aria-label={formatHourLabel(hour)}>
            {hour % 3 === 0 ? formatHourLabel(hour) : ''}
          </span>
        ))}
        {DOW_ORDER.map((dow, rowIndex) => (
          <Fragment key={dow}>
            <span className="traffic-heatmap-dow" role="rowheader">
              {dowLabel(dow)}
            </span>
            {HOURS.map((hour) => {
              const count = matrix[rowIndex]?.[hour] ?? 0;
              return (
                <span
                  key={hour}
                  role="gridcell"
                  className="traffic-heatmap-cell"
                  style={cellStyle(count / peak, count)}
                  title={`${dowLabel(dow)} ${formatHourLabel(hour)} · ${formatNumber(count)} ${t('pageviews')}`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="traffic-heatmap-legend">
        <span>{t('heatmapLegendLow')}</span>
        {RAMP.map((step) => (
          <span key={step} className="traffic-heatmap-cell" style={cellStyle(step, 1)} aria-hidden />
        ))}
        <span>{t('heatmapLegendHigh')}</span>
      </div>
    </div>
  );
}
