import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, type Segment } from '../lib/api';
import { type DateRangePreset } from '../lib/dateRange';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { websiteReportUrl } from '../lib/websiteReportApi';

/** Default `30d`: funnel/retention/UTM trend windows. Overview keeps `24h` via useWebsiteRange. */
export function useWebsiteReportContext(fallbackPreset: DateRangePreset = '30d') {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, fallbackPreset);
  // Segment lives in the URL so saved reports (`?segmentId=`) and shared links restore it.
  const [searchParams, setSearchParams] = useSearchParams();
  const segmentId = searchParams.get('segmentId') ?? '';
  const setSegmentId = useCallback(
    (next: string) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next) params.set('segmentId', next);
          else params.delete('segmentId');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const segmentsQuery = useQuery({
    queryKey: ['segments', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Segment[]>(`/api/websites/${websiteId}/segments`),
  });

  const segmentQs = segmentId ? `&segmentId=${encodeURIComponent(segmentId)}` : '';

  function reportUrl(path: string, extra = '') {
    if (!websiteId) return '';
    return websiteReportUrl(path, websiteId, rangeQs, segmentId, extra);
  }

  return {
    websiteId,
    range,
    setRange,
    rangeQs,
    segmentId,
    setSegmentId,
    segmentQs,
    segments: segmentsQuery.data ?? [],
    reportUrl,
    timezone,
  };
}
