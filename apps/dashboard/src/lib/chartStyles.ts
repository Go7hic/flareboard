import type { CSSProperties } from 'react';
import {
  CHART_SERIES_COLORS,
  chartSeriesColor,
  type MetricSeriesColors,
} from './chart-colors';
import type { ChartColors } from './useChartColors';

export { CHART_SERIES_COLORS, chartSeriesColor };
export type { MetricSeriesColors };

/** Geist `--radius-sm` (6px) for Recharts tooltips and chart chrome. */
export const CHART_RADIUS_SM = 6;

export function chartTooltipStyle(
  chartColors: ChartColors,
  extra?: CSSProperties,
): CSSProperties {
  return {
    background: chartColors.panel,
    border: `1px solid ${chartColors.border}`,
    borderRadius: CHART_RADIUS_SM,
    color: chartColors.text,
    ...extra,
  };
}
