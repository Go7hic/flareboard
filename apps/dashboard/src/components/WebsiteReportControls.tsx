import type { ReactNode } from 'react';
import { DateRangePicker } from './DateRangePicker';
import { SegmentFilterMenu } from './SegmentFilterMenu';
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
}: {
  range: { preset: DateRangePreset; startAt: number; endAt: number };
  onRangeChange: (next: { preset: DateRangePreset; startAt: number; endAt: number }) => void;
  segmentId?: string;
  onSegmentChange?: (id: string) => void;
  segments?: Segment[];
  showSegment?: boolean;
  /** Controls rendered before segment / date filters (e.g. journey depth). */
  leading?: ReactNode;
}) {
  return (
    <div className="stats-header-controls">
      {leading}
      {showSegment && onSegmentChange && segments ? (
        <SegmentFilterMenu
          segmentId={segmentId ?? ''}
          onSegmentChange={onSegmentChange}
          segments={segments}
          compareEnabled={false}
          onCompareChange={() => {}}
        />
      ) : null}
      <DateRangePicker value={range} onChange={onRangeChange} popover />
    </div>
  );
}
