import { WebsiteAnalyticsControls } from './WebsiteAnalyticsControls';
import { type CompareMode } from '../lib/compare-utils';
import { type DateRangePreset } from '../lib/dateRange';

interface Segment {
  id: string;
  name: string;
}

export function CompareReportControls({
  range,
  onRangeChange,
  compareMode,
  onCompareModeChange,
  segmentId,
  onSegmentChange,
  segments,
  timezone = 'UTC',
}: {
  range: { preset: DateRangePreset; startAt: number; endAt: number };
  onRangeChange: (next: { preset: DateRangePreset; startAt: number; endAt: number }) => void;
  compareMode: CompareMode;
  onCompareModeChange: (mode: CompareMode) => void;
  segmentId?: string;
  onSegmentChange?: (id: string) => void;
  segments?: Segment[];
  timezone?: string;
}) {
  return (
    <WebsiteAnalyticsControls
      range={range}
      onRangeChange={onRangeChange}
      timezone={timezone}
      showSegment={Boolean(onSegmentChange && segments)}
      segmentId={segmentId}
      onSegmentChange={onSegmentChange}
      segments={segments}
      showCompareMode
      compareMode={compareMode}
      onCompareModeChange={onCompareModeChange}
    />
  );
}
