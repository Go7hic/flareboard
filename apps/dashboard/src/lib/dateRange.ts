export type DateRangePreset = '24h' | '7d' | '30d' | '90d' | 'custom';

import {
  rolling24hRange,
  type UtcCalendarPreset,
} from '@flareboard/shared/date-range';
import {
  DEFAULT_SITE_TIMEZONE,
  siteCalendarDaysRange,
  siteCustomRange,
  type SiteTimezone,
} from '@flareboard/shared/timezone';

const CALENDAR_PRESETS: Record<UtcCalendarPreset, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export function presetToRange(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
  timezone: SiteTimezone = DEFAULT_SITE_TIMEZONE,
) {
  if (preset === 'custom' && customStart && customEnd) {
    return siteCustomRange(customStart, customEnd, timezone);
  }
  if (preset === '24h') return rolling24hRange();
  if (preset in CALENDAR_PRESETS) {
    return siteCalendarDaysRange(CALENDAR_PRESETS[preset as UtcCalendarPreset], timezone);
  }
  return rolling24hRange();
}

export function rangeQueryString(startAt: number, endAt: number) {
  return `startAt=${startAt}&endAt=${endAt}`;
}
