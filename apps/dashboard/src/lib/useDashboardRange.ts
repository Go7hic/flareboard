import { useEffect, useState } from 'react';
import { type DateRangePreset, rangeQueryString } from './dateRange';
import { defaultRange, type StoredRange } from './websiteRangeStorage';

const STORAGE_KEY = 'flareboard_dashboard_range';

function loadDashboardRange(): StoredRange | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
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

function saveDashboardRange(range: StoredRange) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(range));
  } catch {
    /* ignore quota */
  }
}

export function useDashboardRange(fallbackPreset: DateRangePreset = '24h') {
  const [range, setRangeState] = useState<StoredRange>(() => {
    return loadDashboardRange() ?? defaultRange(fallbackPreset);
  });

  useEffect(() => {
    const stored = loadDashboardRange();
    if (stored) setRangeState(stored);
    else setRangeState(defaultRange(fallbackPreset));
  }, [fallbackPreset]);

  function setRange(next: StoredRange) {
    setRangeState(next);
    saveDashboardRange(next);
  }

  return {
    range,
    setRange,
    rangeQs: rangeQueryString(range.startAt, range.endAt),
  };
}
