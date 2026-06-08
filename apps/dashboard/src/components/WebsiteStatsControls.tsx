import { DateRangePicker } from './DateRangePicker';
import { ExportMenu } from './ExportMenu';
import { SegmentFilterMenu } from './SegmentFilterMenu';
import { type DateRangePreset } from '../lib/dateRange';

interface Segment {
  id: string;
  name: string;
}

/** Overview only — segment filter + date range + export. */
export function WebsiteStatsControls({
  range,
  onRangeChange,
  onExport,
  segmentId,
  onSegmentChange,
  segments,
  compareEnabled,
  onCompareChange,
}: {
  range: { preset: DateRangePreset; startAt: number; endAt: number };
  onRangeChange: (next: { preset: DateRangePreset; startAt: number; endAt: number }) => void;
  onExport: (type: 'pageviews' | 'events') => void;
  segmentId: string;
  onSegmentChange: (id: string) => void;
  segments: Segment[];
  compareEnabled: boolean;
  onCompareChange: (enabled: boolean) => void;
}) {
  return (
    <div className="stats-header-controls">
      <SegmentFilterMenu
        segmentId={segmentId}
        onSegmentChange={onSegmentChange}
        segments={segments}
        compareEnabled={compareEnabled}
        onCompareChange={onCompareChange}
      />
      <DateRangePicker value={range} onChange={onRangeChange} popover />
      <ExportMenu onExport={onExport} />
    </div>
  );
}
