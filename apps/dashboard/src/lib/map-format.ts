import { getLocale } from './i18n';

const countryNames = new Intl.DisplayNames([getLocale()], { type: 'region' });

export function getCountryLabel(code: string): string {
  try {
    return countryNames.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** Compact metric for map tooltips, e.g. 30940 → "30.94k". */
export function formatMapMetricValue(value: number): string {
  return new Intl.NumberFormat(getLocale(), {
    notation: 'compact',
    maximumFractionDigits: value >= 10_000 ? 2 : value >= 1_000 ? 1 : 0,
  }).format(value);
}
