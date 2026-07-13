import { DateRangePicker } from './DateRangePicker';
import { ExportMenu } from './ExportMenu';
import { type DateRangePreset } from '../lib/dateRange';

/** Date range + export — used on tabs without segment filtering. */
export function WebsiteDateExportControls({
  range,
  onRangeChange,
  onExport,
  showExport = false,
  timezone = 'UTC',
}: {
  range: { preset: DateRangePreset; startAt: number; endAt: number };
  onRangeChange: (next: { preset: DateRangePreset; startAt: number; endAt: number }) => void;
  onExport?: (type: 'pageviews' | 'events') => void;
  showExport?: boolean;
  timezone?: string;
}) {
  return (
    <div className="stats-header-controls">
      <DateRangePicker value={range} onChange={onRangeChange} popover timezone={timezone} />
      {showExport && onExport ? <ExportMenu onExport={onExport} /> : null}
    </div>
  );
}
