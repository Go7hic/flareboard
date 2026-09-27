import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, type Website } from './api';
import { type DateRangePreset, rangeQueryString } from './dateRange';
import {
  defaultRange,
  loadWebsiteRange,
  resolveRange,
  saveWebsiteRange,
  type StoredRange,
} from './websiteRangeStorage';

/** Default `24h`: overview / realtime pulse. Report pages pass `30d` via useWebsiteReportContext. */
export function useWebsiteRange(websiteId: string | undefined, fallbackPreset: DateRangePreset = '24h') {
  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Website>(`/api/websites/${websiteId}`),
    staleTime: 60_000,
  });
  const timezone = websiteQuery.data?.timezone ?? 'UTC';

  // Keep the user's choice; derive bounds from it. Storing computed bounds (and
  // re-setting them from effects) refetched every query 2-3 times per mount.
  const [selection, setSelection] = useState<StoredRange>(
    () => (websiteId ? loadWebsiteRange(websiteId) : null) ?? defaultRange(fallbackPreset),
  );
  const range = useMemo(() => resolveRange(selection, timezone), [selection, timezone]);

  function setRange(next: StoredRange) {
    setSelection(next);
    if (websiteId) saveWebsiteRange(websiteId, next);
  }

  return {
    range,
    setRange,
    rangeQs: rangeQueryString(range.startAt, range.endAt),
    timezone,
  };
}
