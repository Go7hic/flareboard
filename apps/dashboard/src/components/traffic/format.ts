import { formatNumber, formatPercent, formatRelativeTime } from '../../lib/format';
import { getLocale, t } from '../../lib/i18n';

/**
 * A `{count}` message with plural forms: `${key}_one` / `${key}_other` (CLDR rule of the
 * current locale, so French "0 page" and English "0 pages" both come out right).
 */
export function countLabel(key: string, count: number): string {
  const rule = new Intl.PluralRules(getLocale()).select(count);
  const message = t(rule === 'one' ? `${key}_one` : `${key}_other`);
  return message.replace('{count}', formatNumber(count));
}

/** A share (0..1) as a percent with one decimal under 10% ("4.2%", "38%"). */
export function formatShare(share: number | null | undefined): string {
  if (share == null || !Number.isFinite(share)) return '-';
  const pct = share * 100;
  return formatPercent(pct, { digits: pct > 0 && pct < 10 ? 1 : 0 });
}

/** Percent change from `previous` to `current`; undefined when there is no base to compare. */
export function percentChange(current: number, previous: number | null | undefined): number | undefined {
  if (previous == null || !Number.isFinite(previous) || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

/** Clock time with seconds for timelines ("23:00:12"). */
export function formatClockTime(value: number, timeZone?: string): string {
  return new Date(value).toLocaleTimeString(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
}

/** Counts in tight spots: exact up to a million, then compact ("1.2M"); the full value goes in a title. */
export function formatCount(value: number): string {
  return formatNumber(value, { compact: Math.abs(value) >= 1_000_000, maximumFractionDigits: 1 });
}

/**
 * "3 min ago" for a past moment. A timestamp ahead of this browser's clock (clock skew, or
 * demo data stamped later in the day) reads "just now" instead of "in 6 hours".
 */
export function relativeLabel(value: number | string | Date): string {
  const ms = new Date(value).getTime();
  return formatRelativeTime(Number.isNaN(ms) ? value : Math.min(ms, Date.now()));
}
