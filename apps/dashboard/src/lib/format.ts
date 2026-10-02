import { getLocale, t } from './i18n';

const EMPTY = '-';

function isEmptyNumber(value: number | null | undefined): value is null | undefined {
  return value == null || Number.isNaN(value);
}

export function formatNumber(
  value: number | null | undefined,
  opts?: { compact?: boolean; maximumFractionDigits?: number },
): string {
  if (isEmptyNumber(value)) return EMPTY;
  return new Intl.NumberFormat(getLocale(), {
    notation: opts?.compact ? 'compact' : 'standard',
    maximumFractionDigits: opts?.maximumFractionDigits,
  }).format(value);
}

export function formatPercent(
  value: number | null | undefined,
  opts?: { digits?: number; signed?: boolean },
): string {
  if (isEmptyNumber(value)) return EMPTY;
  const digits = opts?.digits ?? 0;
  const rounded = digits > 0 ? Number(value.toFixed(digits)) : Math.round(value);
  const abs = Math.abs(rounded);
  const body = new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(abs);
  if (opts?.signed) {
    if (rounded > 0) return `+${body}%`;
    if (rounded < 0) return `-${body}%`;
  }
  return `${body}%`;
}

export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (isEmptyNumber(seconds)) return EMPTY;
  const s = Math.max(0, Math.round(seconds));
  if (s <= 0) return '0s';
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  if (mins <= 0) return `${secs}s`;
  if (secs <= 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (isEmptyNumber(ms)) return EMPTY;
  return formatDurationSeconds(Math.max(0, Math.round(ms / 1000)));
}

export function formatDateTime(
  value: string | number | null | undefined,
  opts?: { timeZone?: string; includeYear?: boolean },
): string {
  if (value == null) return EMPTY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleString(getLocale(), {
    ...(opts?.includeYear === false ? {} : { year: 'numeric' as const }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: opts?.timeZone,
  });
}

/**
 * Compact date-time for tables, lists and detail fields: "Oct 2, 23:32" / "10月2日 23:32",
 * with the year only when it is not the current one. Put the full timestamp in a `title`.
 */
export function formatShortDateTime(
  value: string | number | Date | null | undefined,
  opts?: { timeZone?: string; now?: Date },
): string {
  if (value == null) return EMPTY;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  const now = opts?.now ?? new Date();
  return date.toLocaleString(getLocale(), {
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: opts?.timeZone,
  });
}

/** Compact date without time: "Oct 2" / "10月2日", with the year only when not the current one. */
export function formatShortDate(
  value: string | number | Date | null | undefined,
  opts?: { timeZone?: string; now?: Date },
): string {
  if (value == null) return EMPTY;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  const now = opts?.now ?? new Date();
  return date.toLocaleDateString(getLocale(), {
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
    month: 'short',
    day: 'numeric',
    timeZone: opts?.timeZone,
  });
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.34524],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

/**
 * "just now", "3 min ago", "2 天前": for lists where recency matters more than the exact time.
 * Beyond ~a week it falls back to formatShortDate, which reads better than "5 weeks ago".
 */
export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  opts?: { now?: number; maxDays?: number; allowFuture?: boolean },
): string {
  if (value == null) return EMPTY;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  const now = opts?.now ?? Date.now();
  // A past event a little "ahead" of this clock (client skew, sample data) reads as just now.
  const diffSeconds = opts?.allowFuture ? (date.getTime() - now) / 1000 : Math.min(0, (date.getTime() - now) / 1000);
  if (Math.abs(diffSeconds) >= (opts?.maxDays ?? 7) * 86_400) return formatShortDate(date);
  if (Math.abs(diffSeconds) < 45) return t('timeJustNow');
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto', style: 'short' });
  let amount = diffSeconds;
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(amount) < size) return rtf.format(Math.round(amount), unit);
    amount /= size;
  }
  return formatShortDate(date);
}

export function formatDateOnly(value: string | number | null | undefined): string {
  if (value == null) return EMPTY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleDateString(getLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTimeOfDay(
  value: string | number | Date | null | undefined,
  opts?: { timeZone?: string },
): string {
  if (value == null) return EMPTY;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleTimeString(getLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: opts?.timeZone,
  });
}

/** Short mono label for long ids; never equals the full id when truncated. */
/** A retention period in days, as years when it is a whole number of them ("3 years", "90 days"). */
export function formatRetentionPeriod(days: number): string {
  if (days >= 365 && days % 365 === 0) {
    const years = days / 365;
    return years === 1 ? t('retentionPeriodOneYear') : t('retentionPeriodYears').replace('{count}', formatNumber(years));
  }
  return days === 1 ? t('retentionPeriodOneDay') : t('retentionPeriodDays').replace('{count}', formatNumber(days));
}

/** First day of the next UTC month, when monthly allowances reset, as a localized date. */
export function formatNextMonthStart(now = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return new Intl.DateTimeFormat(getLocale(), {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(next);
}

export function shortId(id: string, len = 8): string {
  const trimmed = id.trim();
  if (trimmed.length <= len) return trimmed;
  return `${trimmed.slice(0, len)}…`;
}

/**
 * Prefer a human label; fall back to a short id.
 * Skips candidates that equal the full id so title/subtitle never duplicate.
 */
export function identityPrimary(
  candidates: Array<string | null | undefined>,
  id: string,
): string {
  for (const value of candidates) {
    if (value && value !== id) return value;
  }
  return shortId(id);
}
