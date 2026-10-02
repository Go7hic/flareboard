import { formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import type { StatusTone } from '../StatusBadge';

export type VitalMetric = 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb';

export const VITAL_METRICS: VitalMetric[] = ['lcp', 'inp', 'cls', 'fcp', 'ttfb'];

export type VitalDistribution = {
  good: number;
  needsImprovement: number;
  poor: number;
  total: number;
};

/** Good / poor boundaries (web.dev); the same buckets the API counts. */
export const VITAL_THRESHOLDS: Record<VitalMetric, { good: number; poor: number }> = {
  lcp: { good: 2500, poor: 4000 },
  inp: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
  fcp: { good: 1800, poor: 3000 },
  ttfb: { good: 800, poor: 1800 },
};

export const VITAL_NAME_KEYS: Record<VitalMetric, string> = {
  lcp: 'trafficVitalLcp',
  inp: 'trafficVitalInp',
  cls: 'trafficVitalCls',
  fcp: 'trafficVitalFcp',
  ttfb: 'trafficVitalTtfb',
};

export type VitalRating = 'good' | 'needsImprovement' | 'poor';

export const RATING_TONE: Record<VitalRating, StatusTone> = {
  good: 'success',
  needsImprovement: 'warning',
  poor: 'danger',
};

export function ratingLabel(rating: VitalRating): string {
  if (rating === 'good') return t('cwvGood');
  if (rating === 'needsImprovement') return t('cwvNeedsImprovement');
  return t('cwvPoor');
}

/**
 * The rating of the 75th percentile, read from the bucket counts: good when at least 75% of
 * page loads were good, poor when more than 25% were poor (how Core Web Vitals are assessed).
 */
export function p75Rating(dist: VitalDistribution | null | undefined): VitalRating | null {
  if (!dist || !dist.total) return null;
  if (dist.good / dist.total >= 0.75) return 'good';
  if ((dist.good + dist.needsImprovement) / dist.total >= 0.75) return 'needsImprovement';
  return 'poor';
}

export function goodShare(dist: VitalDistribution | null | undefined): number | null {
  if (!dist || !dist.total) return null;
  return dist.good / dist.total;
}

/** Value and unit for display: "2.24" + "s", "162" + "ms", "0.072" (CLS has no unit). */
export function vitalParts(metric: VitalMetric, value: number | null | undefined): { value: string; unit: string } {
  if (value == null || !Number.isFinite(value)) return { value: '-', unit: '' };
  if (metric === 'cls') return { value: formatNumber(value, { maximumFractionDigits: 3 }), unit: '' };
  if (value >= 1000) return { value: formatNumber(value / 1000, { maximumFractionDigits: 2 }), unit: 's' };
  return { value: formatNumber(Math.round(value)), unit: 'ms' };
}

export function formatVital(metric: VitalMetric, value: number | null | undefined): string {
  const parts = vitalParts(metric, value);
  return parts.unit ? `${parts.value} ${parts.unit}` : parts.value;
}

/** Axis ticks: "0", "500 ms", "1 s", "2.5 s"; CLS keeps its decimals. */
export function vitalTick(metric: VitalMetric, value: number): string {
  if (metric === 'cls') return formatNumber(value, { maximumFractionDigits: 2 });
  if (value === 0) return '0';
  if (value >= 1000) return `${formatNumber(value / 1000, { maximumFractionDigits: 1 })} s`;
  return `${formatNumber(value)} ms`;
}
