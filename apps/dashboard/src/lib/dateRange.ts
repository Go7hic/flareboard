export type DateRangePreset = '24h' | '7d' | '30d' | '90d' | 'custom';

import {
  rolling24hRange,
  utcCalendarDaysRange,
  type UtcCalendarPreset,
} from '@flareboard/shared/date-range';

const CALENDAR_PRESETS: Record<UtcCalendarPreset, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export function presetToRange(preset: DateRangePreset, customStart?: string, customEnd?: string) {
  if (preset === 'custom' && customStart && customEnd) {
    return { startAt: new Date(customStart).getTime(), endAt: new Date(customEnd).getTime() };
  }
  if (preset === '24h') return rolling24hRange();
  if (preset in CALENDAR_PRESETS) {
    return utcCalendarDaysRange(CALENDAR_PRESETS[preset as UtcCalendarPreset]);
  }
  return rolling24hRange();
}

export function rangeQueryString(startAt: number, endAt: number) {
  return `startAt=${startAt}&endAt=${endAt}`;
}
