import { WebsiteAnalyticsControls } from './WebsiteAnalyticsControls';
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
    <WebsiteAnalyticsControls
      range={range}
      onRangeChange={onRangeChange}
      timezone={timezone}
      showExport={showExport}
      onExport={onExport}
    />
  );
}
