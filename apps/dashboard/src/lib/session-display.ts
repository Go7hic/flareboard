import { getCountryLabel } from './map-format';
import { getLocale, t } from './i18n';

export function countryFlagEmoji(code: string | null | undefined): string {
  if (!code) return '';
  const cc = code.toUpperCase();
  if (cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function formatSessionLocation(country: string | null, city: string | null): string {
  const countryLabel = country ? getCountryLabel(country) : t('unknown');
  if (city?.trim()) return `${city.trim()}, ${countryLabel}`;
  return countryLabel;
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diffSec = Math.round((timestamp - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return rtf.format(diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  const diffHour = Math.round(diffSec / 3600);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hour');
  const diffDay = Math.round(diffSec / 86400);
  if (Math.abs(diffDay) < 30) return rtf.format(diffDay, 'day');
  const diffMonth = Math.round(diffSec / (86400 * 30));
  if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, 'month');
  return rtf.format(Math.round(diffSec / (86400 * 365)), 'year');
}

export function formatDeviceLabel(device: string | null | undefined): string {
  const key = device?.toLowerCase();
  if (key === 'mobile') return t('deviceMobile');
  if (key === 'tablet') return t('deviceTablet');
  if (key === 'desktop') return t('deviceDesktop');
  return device?.trim() || t('unknown');
}

export function browserIconSlug(browser: string | null | undefined): string | null {
  const name = browser?.toLowerCase() ?? '';
  if (name.includes('chrome')) return 'googlechrome';
  if (name.includes('firefox')) return 'firefox';
  if (name.includes('safari')) return 'safari';
  if (name.includes('edge')) return 'microsoftedge';
  if (name.includes('opera')) return 'opera';
  if (name.includes('brave')) return 'brave';
  return null;
}

export function osIconSlug(os: string | null | undefined): string | null {
  const name = os?.toLowerCase() ?? '';
  if (name.includes('windows')) return 'windows';
  if (name.includes('mac')) return 'apple';
  if (name.includes('ios') || name.includes('iphone') || name.includes('ipad')) return 'apple';
  if (name.includes('android')) return 'android';
  if (name.includes('linux')) return 'linux';
  return null;
}

export type DeviceIconKind = 'mobile' | 'tablet' | 'desktop' | 'unknown';

export function deviceIconKind(device: string | null | undefined): DeviceIconKind {
  const key = device?.toLowerCase();
  if (key === 'mobile') return 'mobile';
  if (key === 'tablet') return 'tablet';
  if (key === 'desktop') return 'desktop';
  return 'unknown';
}
