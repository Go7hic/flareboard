import { DateRangePicker } from './DateRangePicker';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { type DateRangePreset } from '../lib/dateRange';
import { t } from '../lib/i18n';

interface Segment {
  id: string;
  name: string;
}

export function StatsToolbar({
  range,
  onRangeChange,
  segmentId,
  onSegmentChange,
  segments,
  compareEnabled,
  onCompareChange,
  onExportPageviews,
  onExportEvents,
}: {
  range: { preset: DateRangePreset; startAt: number; endAt: number };
  onRangeChange: (next: { preset: DateRangePreset; startAt: number; endAt: number }) => void;
  segmentId: string;
  onSegmentChange: (id: string) => void;
  segments: Segment[];
  compareEnabled: boolean;
  onCompareChange: (enabled: boolean) => void;
  onExportPageviews: () => void;
  onExportEvents: () => void;
}) {
  return (
    <div className="stats-toolbar">
      <DateRangePicker value={range} onChange={onRangeChange} compact />
      <div className="stats-toolbar-row">
        <div className="stats-toolbar-field">
          <Label htmlFor="segment-filter">{t('filterBySegment')}</Label>
          <select
            id="segment-filter"
            className="select"
            value={segmentId}
            onChange={(e) => onSegmentChange(e.target.value)}
          >
            <option value="">{t('allVisitors')}</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <label className="stats-toolbar-compare">
          <input
            type="checkbox"
            checked={compareEnabled}
            onChange={(e) => onCompareChange(e.target.checked)}
          />
          {t('compareMode')}
        </label>
        <div className="stats-toolbar-exports">
          <Button type="button" variant="secondary" size="sm" onClick={onExportPageviews}>
            {t('exportPageviews')}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onExportEvents}>
            {t('exportEventsCsv')}
          </Button>
        </div>
      </div>
    </div>
  );
}
