export type DateRangePreset = '24h' | '7d' | '30d' | '90d' | 'custom';

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

export function presetToRange(preset: DateRangePreset, customStart?: string, customEnd?: string) {
  const endAt = Date.now();
  if (preset === 'custom' && customStart && customEnd) {
    return { startAt: new Date(customStart).getTime(), endAt: new Date(customEnd).getTime() };
  }
  const offsets: Record<Exclude<DateRangePreset, 'custom'>, number> = {
    '24h': MS_DAY,
    '7d': 7 * MS_DAY,
    '30d': 30 * MS_DAY,
    '90d': 90 * MS_DAY,
  };
  const span = preset === 'custom' ? MS_DAY : offsets[preset];
  return { startAt: endAt - span, endAt };
}

export function rangeQueryString(startAt: number, endAt: number) {
  return `startAt=${startAt}&endAt=${endAt}`;
}
