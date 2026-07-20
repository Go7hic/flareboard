import { Fragment, useMemo, type CSSProperties } from 'react';
import type { TrafficHeatmapCell } from '../hooks/useTrafficHeatmap';
import { formatNumber } from '../lib/format';
import { getLocale, t } from '../lib/i18n';
import { EmptyState } from './EmptyState';
import { Skeleton } from './ui/skeleton';

const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

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

function circleStyle(intensity: number, count: number): CSSProperties {
  if (count <= 0) {
    return {
      width: '6px',
      height: '6px',
      background: 'var(--border)',
      opacity: 0.35,
    };
  }
  const size = 6 + intensity * 14;
  const pct = Math.round(20 + intensity * 80);
  return {
    width: `${size}px`,
    height: `${size}px`,
    background: `color-mix(in srgb, var(--accent) ${pct}%, var(--bg-subtle))`,
  };
}

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
    return HOURS.map((hour) =>
      DOW_ORDER.map((dow) => lookup.get(`${dow}:${hour}`) ?? 0),
    );
  }, [cells]);

  const peak = Math.max(max, 1);

  if (loading) {
    return <Skeleton className="traffic-heatmap-skeleton h-56 w-full" />;
  }

  if (!cells.length) {
    return (
      <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />
    );
  }

  return (
    <div className="traffic-heatmap-wrap">
      <div className="traffic-heatmap-punch" role="grid" aria-label={t('trafficHeatmap')}>
        <div className="traffic-heatmap-punch-corner" aria-hidden />
        {DOW_ORDER.map((dow) => (
          <div key={dow} className="traffic-heatmap-punch-dow" role="columnheader">
            {dowLabel(dow)}
          </div>
        ))}
        {HOURS.map((hour, rowIndex) => (
          <Fragment key={hour}>
            <div className="traffic-heatmap-punch-hour" role="rowheader">
              {formatHourLabel(hour)}
            </div>
            {DOW_ORDER.map((dow, colIndex) => {
              const count = matrix[rowIndex]?.[colIndex] ?? 0;
              const intensity = count / peak;
              return (
                <div key={`${hour}-${dow}`} className="traffic-heatmap-punch-cell" role="gridcell">
                  <span
                    className="traffic-heatmap-punch-dot"
                    style={circleStyle(intensity, count)}
                    title={`${dowLabel(dow)} ${formatHourLabel(hour)} — ${formatNumber(count)} ${t('pageviews')}`}
                  />
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="heatmap-legend traffic-heatmap-legend">
        <span>{t('heatmapLegendLow')}</span>
        <div className="traffic-heatmap-legend-dots" aria-hidden>
          {[0.15, 0.4, 0.7, 1].map((intensity) => (
            <span
              key={intensity}
              className="traffic-heatmap-punch-dot"
              style={circleStyle(intensity, 1)}
            />
          ))}
        </div>
        <span>{t('heatmapLegendHigh')}</span>
      </div>
    </div>
  );
}
