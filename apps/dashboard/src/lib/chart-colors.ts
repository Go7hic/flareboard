/**
 * Shared chart data-series palette.
 *
 * CSS vars in geist-tokens.css are the source of truth. Series strokes/fills
 * and legend swatches must use the same tokens so colors never diverge.
 *
 * Never use --text, --accent, --bg, --foreground, or gray-1000 for series —
 * those resolve to near-black / near-white after the Geist chrome redesign.
 */

export const CHART_METRIC_VARS = {
  pageviews: '--chart-pageviews',
  visitors: '--chart-visitors',
  visits: '--chart-visits',
} as const;

export type ChartMetricKey = keyof typeof CHART_METRIC_VARS;

/** Indexed multi-series hues (ranking, widgets, etc.). No neutrals. */
export const CHART_SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const;

/** Tokens banned as data-series strokes/fills (chrome/axis only). */
export const CHART_SERIES_FORBIDDEN_VARS = [
  '--text',
  '--text-muted',
  '--accent',
  '--primary',
  '--foreground',
  '--bg',
  '--background',
  '--chart-axis',
  '--geist-gray-1000',
  '--geist-gray-900',
  '--geist-gray-700',
] as const;

export function chartSeriesColor(index: number): string {
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]!;
}

export function cssVarValue(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export type MetricSeriesColors = Record<ChartMetricKey, string>;

/** Resolved hex/rgb for Recharts (CSS var strings are unreliable in SVG attrs). */
export function getMetricSeriesColors(): MetricSeriesColors {
  return {
    pageviews: cssVarValue(CHART_METRIC_VARS.pageviews) || cssVarValue('--chart-1'),
    visitors: cssVarValue(CHART_METRIC_VARS.visitors) || cssVarValue('--chart-2'),
    visits: cssVarValue(CHART_METRIC_VARS.visits) || cssVarValue('--chart-3'),
  };
}

/** Primary single-series stroke/fill (blue). Never falls back to --accent. */
export function getChartSeriesPrimary(): string {
  return cssVarValue('--chart-1') || cssVarValue('--chart-line') || '#006bff';
}
