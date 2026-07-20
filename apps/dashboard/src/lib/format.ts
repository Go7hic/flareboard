import { getLocale } from './i18n';

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
