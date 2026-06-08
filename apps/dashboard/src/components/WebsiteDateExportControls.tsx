import { DateRangePicker } from './DateRangePicker';
import { ExportMenu } from './ExportMenu';
import { type DateRangePreset } from '../lib/dateRange';

/** Date range + export — used on tabs without segment filtering. */
export function WebsiteDateExportControls({
  range,
  onRangeChange,
  onExport,
  showExport = false,
}: {
  range: { preset: DateRangePreset; startAt: number; endAt: number };
  onRangeChange: (next: { preset: DateRangePreset; startAt: number; endAt: number }) => void;
  onExport?: (type: 'pageviews' | 'events') => void;
  showExport?: boolean;
}) {
  return (
    <div className="stats-header-controls">
      <DateRangePicker value={range} onChange={onRangeChange} popover />
      {showExport && onExport ? <ExportMenu onExport={onExport} /> : null}
    </div>
  );
}
