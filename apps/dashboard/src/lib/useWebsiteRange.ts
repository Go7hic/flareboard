import { useEffect, useState } from 'react';
import { type DateRangePreset, rangeQueryString } from './dateRange';
import { defaultRange, loadWebsiteRange, saveWebsiteRange, type StoredRange } from './websiteRangeStorage';

export function useWebsiteRange(websiteId: string | undefined, fallbackPreset: DateRangePreset = '24h') {
  const [range, setRangeState] = useState<StoredRange>(() => {
    if (websiteId) {
      const stored = loadWebsiteRange(websiteId);
      if (stored) return stored;
    }
    return defaultRange(fallbackPreset);
  });

  useEffect(() => {
    if (!websiteId) return;
    const stored = loadWebsiteRange(websiteId);
    if (stored) setRangeState(stored);
    else setRangeState(defaultRange(fallbackPreset));
  }, [websiteId, fallbackPreset]);

  function setRange(next: StoredRange) {
    setRangeState(next);
    if (websiteId) saveWebsiteRange(websiteId, next);
  }

  return {
    range,
    setRange,
    rangeQs: rangeQueryString(range.startAt, range.endAt),
  };
}
