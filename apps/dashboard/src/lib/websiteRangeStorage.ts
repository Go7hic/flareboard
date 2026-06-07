import { type DateRangePreset, presetToRange } from './dateRange';

const PREFIX = 'flareboard_range_';

export type StoredRange = {
  preset: DateRangePreset;
  startAt: number;
  endAt: number;
};

export function loadWebsiteRange(websiteId: string): StoredRange | null {
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${websiteId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRange;
    if (!parsed.preset || typeof parsed.startAt !== 'number' || typeof parsed.endAt !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveWebsiteRange(websiteId: string, range: StoredRange) {
  try {
    sessionStorage.setItem(`${PREFIX}${websiteId}`, JSON.stringify(range));
  } catch {
    /* ignore quota */
  }
}

export function defaultRange(preset: DateRangePreset = '7d'): StoredRange {
  const { startAt, endAt } = presetToRange(preset);
  return { preset, startAt, endAt };
}
