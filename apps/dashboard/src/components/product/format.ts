import { formatNumber, formatPercent } from '../../lib/format';
import { getLocale, t } from '../../lib/i18n';

/** Dates arrive as epoch ms, numeric strings or ISO strings depending on the endpoint. */
export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = typeof value === 'string' && /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A UTC calendar day ("2026-10-02") as a Date at UTC midnight, for short axis labels. */
export function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function unit(value: number, name: 'day' | 'hour' | 'minute') {
  return new Intl.NumberFormat(getLocale(), { style: 'unit', unit: name, unitDisplay: 'long' }).format(value);
}

/** 60 → "1 hour", 1440 → "1 day", 90 → "1 hour 30 minutes" (localized unit names). */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total >= 1440 && total % 1440 === 0) return unit(total / 1440, 'day');
  if (total >= 60) {
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest ? `${unit(hours, 'hour')} ${unit(rest, 'minute')}` : unit(hours, 'hour');
  }
  return unit(total, 'minute');
}

/** Share in percent with one decimal under 10%, none above ("4.2%", "38%"). */
export function formatShare(percent: number | null | undefined): string {
  if (percent == null || Number.isNaN(percent)) return '–';
  const digits = percent !== 0 && Math.abs(percent) < 10 && percent % 1 !== 0 ? 1 : 0;
  return formatPercent(percent, { digits });
}

/** Count with a unit word from a "{count} …" template; compact past 10k (title keeps the full value). */
export function countLabel(template: string, count: number) {
  return template.replace('{count}', formatNumber(count, { compact: count >= 10_000 }));
}

/** "1,150 runs" style list meta with the exact value for a tooltip. */
export function countMeta(template: string, count: number) {
  return { text: countLabel(template, count), title: template.replace('{count}', formatNumber(count)) };
}

/** "{name} vs control" style templates: replaces every `{key}` with its value. */
export function fill(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

export function tf(key: string, values: Record<string, string | number>) {
  return fill(t(key), values);
}
