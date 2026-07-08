import { DateRangePicker } from './DateRangePicker';
import { ExportMenu } from './ExportMenu';
import { RealtimeOnlineKpi } from './RealtimeOnlineKpi';
import { SegmentFilterMenu } from './SegmentFilterMenu';
import { type DateRangePreset } from '../lib/dateRange';
import { t } from '../lib/i18n';

interface Segment {
  id: string;
  name: string;
}

/** Overview only — live count + segment filter + date range + export. */
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
}) {
  return (
    <div className="stats-header-row">
      <RealtimeOnlineKpi websiteId={websiteId} />
      <div className="stats-header-controls">
        <SegmentFilterMenu
          segmentId={segmentId}
          onSegmentChange={onSegmentChange}
          segments={segments}
          compareEnabled={compareEnabled}
          onCompareChange={onCompareChange}
        />
        <DateRangePicker value={range} onChange={onRangeChange} popover />
        <ExportMenu
          onExport={onExport}
          disabled={!exportAllowed}
          disabledReason={t('dataPortabilityRequiresUpgrade')}
        />
      </div>
    </div>
  );
}
