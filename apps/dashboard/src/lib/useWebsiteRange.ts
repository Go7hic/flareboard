import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Website } from './api';
import { type DateRangePreset, presetToRange, rangeQueryString } from './dateRange';
import { defaultRange, loadWebsiteRange, saveWebsiteRange, type StoredRange } from './websiteRangeStorage';

/** Default `24h`: overview / realtime pulse. Report pages pass `30d` via useWebsiteReportContext. */
export function useWebsiteRange(websiteId: string | undefined, fallbackPreset: DateRangePreset = '24h') {
  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Website>(`/api/websites/${websiteId}`),
    staleTime: 60_000,
  });
  const timezone = websiteQuery.data?.timezone ?? 'UTC';

  const [range, setRangeState] = useState<StoredRange>(() => {
    if (websiteId) {
      const stored = loadWebsiteRange(websiteId);
      if (stored) return stored;
    }
    return defaultRange(fallbackPreset, timezone);
  });

  useEffect(() => {
    if (!websiteId) return;
    const stored = loadWebsiteRange(websiteId);
    if (stored) setRangeState(stored);
    else setRangeState(defaultRange(fallbackPreset, timezone));
  }, [websiteId, fallbackPreset, timezone]);

  useEffect(() => {
    if (!websiteId) return;
    setRangeState((prev) => {
      if (prev.preset === 'custom') return prev;
      const { startAt, endAt } = presetToRange(prev.preset, undefined, undefined, timezone);
      const next = { preset: prev.preset, startAt, endAt };
      saveWebsiteRange(websiteId, next);
      return next;
    });
  }, [websiteId, timezone]);

  function setRange(next: StoredRange) {
    setRangeState(next);
    if (websiteId) saveWebsiteRange(websiteId, next);
  }

  return {
    range,
    setRange,
    rangeQs: rangeQueryString(range.startAt, range.endAt),
    timezone,
  };
}
