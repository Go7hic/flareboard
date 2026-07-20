import { WebsiteAnalyticsControls } from './WebsiteAnalyticsControls';
import { type CompareMode } from '../lib/compare-utils';
import { type DateRangePreset } from '../lib/dateRange';

interface Segment {
  id: string;
  name: string;
}

/** Overview — live count + segment filter + date range + export. */
export function WebsiteStatsControls({
  websiteId,
  range,
  onRangeChange,
  onExport,
  exportAllowed = true,
  segmentId,
  onSegmentChange,
  segments,
  compareEnabled,
  onCompareChange,
  compareMode,
  onCompareModeChange,
  timezone = 'UTC',
}: {
  websiteId: string;
  range: { preset: DateRangePreset; startAt: number; endAt: number };
  onRangeChange: (next: { preset: DateRangePreset; startAt: number; endAt: number }) => void;
  onExport: (type: 'pageviews' | 'events') => void;
  exportAllowed?: boolean;
  segmentId: string;
  onSegmentChange: (id: string) => void;
  segments: Segment[];
  compareEnabled: boolean;
  onCompareChange: (enabled: boolean) => void;
  compareMode: CompareMode;
  onCompareModeChange: (mode: CompareMode) => void;
  timezone?: string;
}) {
  return (
    <WebsiteAnalyticsControls
      websiteId={websiteId}
      range={range}
      onRangeChange={onRangeChange}
      timezone={timezone}
      layout="row"
      showRealtime
      showSegment
      segmentId={segmentId}
      onSegmentChange={onSegmentChange}
      segments={segments}
      showCompareToggle
      compareEnabled={compareEnabled}
      onCompareChange={onCompareChange}
      showCompareMode={compareEnabled}
      compareMode={compareMode}
      onCompareModeChange={onCompareModeChange}
      showExport
      onExport={onExport}
      exportAllowed={exportAllowed}
    />
  );
}
