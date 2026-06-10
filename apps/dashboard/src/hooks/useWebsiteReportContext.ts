import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type Segment } from '../lib/api';
import { type DateRangePreset } from '../lib/dateRange';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { websiteReportUrl } from '../lib/websiteReportApi';

export function useWebsiteReportContext(fallbackPreset: DateRangePreset = '30d') {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { range, setRange, rangeQs } = useWebsiteRange(websiteId, fallbackPreset);
  const [segmentId, setSegmentId] = useState('');

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
  };
}
