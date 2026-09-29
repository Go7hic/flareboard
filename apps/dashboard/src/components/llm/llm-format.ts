import { formatNumber, formatTimeOfDay } from '../../lib/format';
import { getLocale, t } from '../../lib/i18n';

/** USD with enough digits for sub-cent LLM costs. */
export function formatUsd(value: number | null | undefined) {
  if (value == null) return '—';
  const digits = value === 0 ? 2 : value < 0.01 ? 5 : value < 1 ? 4 : 2;
  return `$${value.toFixed(digits)}`;
}

export function formatMs(value: number | null | undefined) {
  if (value == null) return '—';
  if (value >= 10_000) return `${formatNumber(value / 1000, { maximumFractionDigits: 1 })}s`;
  return `${formatNumber(Math.round(value))}ms`;
}

/** Trend bucket label: hours are ISO UTC timestamps (shown in local time), days are site-local dates. */
export function formatBucket(bucket: string, unit: 'hour' | 'day') {
  if (unit === 'hour') return formatTimeOfDay(bucket);
  // A calendar date: format it as-is, without shifting through the browser's timezone.
  return new Date(`${bucket}T00:00:00Z`).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function aiKindLabel(kind: string) {
  const key = `aiSpanKind_${kind}`;
  const label = t(key);
  return label === key ? kind : label;
}
