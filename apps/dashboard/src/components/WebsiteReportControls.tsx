import type { ReactNode } from 'react';
import { WebsiteAnalyticsControls } from './WebsiteAnalyticsControls';
import { type DateRangePreset } from '../lib/dateRange';

interface Segment {
  id: string;
  name: string;
}

/** Date range + optional segment filter for website report pages. */
export function WebsiteReportControls({
  range,
  onRangeChange,
  segmentId,
  onSegmentChange,
  segments,
  showSegment = true,
  leading,
  timezone = 'UTC',
}: {
  range: { preset: DateRangePreset; startAt: number; endAt: number };
  onRangeChange: (next: { preset: DateRangePreset; startAt: number; endAt: number }) => void;
  segmentId?: string;
  onSegmentChange?: (id: string) => void;
  segments?: Segment[];
  showSegment?: boolean;
  /** Controls rendered before segment / date filters (e.g. journey depth). */
  leading?: ReactNode;
  timezone?: string;
}) {
  return (
    <WebsiteAnalyticsControls
      range={range}
      onRangeChange={onRangeChange}
      timezone={timezone}
      leading={leading}
      showSegment={showSegment && Boolean(onSegmentChange && segments)}
      segmentId={segmentId}
      onSegmentChange={onSegmentChange}
      segments={segments}
    />
  );
}
