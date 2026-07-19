import type { CSSProperties } from 'react';
import type { ChartColors } from './useChartColors';

/** Geist `--radius-sm` (6px) for Recharts tooltips and chart chrome. */
export const CHART_RADIUS_SM = 6;

/** Distinct multi-series colors from Geist tokens (theme-aware via CSS vars). */
export const CHART_SERIES_COLORS = [
  'var(--chart-line)',
  'var(--geist-green-700)',
  'var(--geist-purple-700)',
  'var(--geist-pink-700)',
  'var(--geist-amber-700)',
  'var(--geist-teal-700)',
  'var(--geist-gray-700)',
  'var(--cf-orange)',
] as const;

export function chartSeriesColor(index: number): string {
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]!;
}

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
