import { DateRangePicker } from './DateRangePicker';
import { SegmentFilterMenu } from './SegmentFilterMenu';
import { type CompareMode } from '../lib/compare-utils';
import { type DateRangePreset } from '../lib/dateRange';
import { t } from '../lib/i18n';

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
}: {
  range: { preset: DateRangePreset; startAt: number; endAt: number };
  onRangeChange: (next: { preset: DateRangePreset; startAt: number; endAt: number }) => void;
  compareMode: CompareMode;
  onCompareModeChange: (mode: CompareMode) => void;
  segmentId?: string;
  onSegmentChange?: (id: string) => void;
  segments?: Segment[];
}) {
  return (
    <div className="stats-header-controls compare-report-controls">
      {onSegmentChange && segments ? (
        <SegmentFilterMenu
          segmentId={segmentId ?? ''}
          onSegmentChange={onSegmentChange}
          segments={segments}
          compareEnabled={false}
          onCompareChange={() => {}}
        />
      ) : null}
      <DateRangePicker value={range} onChange={onRangeChange} popover />
      <span className="compare-vs-label" aria-hidden>
        {t('compareVs')}
      </span>
      <label className="compare-mode-select-wrap">
        <span className="visually-hidden">{t('compareMode')}</span>
        <select
          className="compare-mode-select"
          value={compareMode}
          onChange={(e) => onCompareModeChange(e.target.value as CompareMode)}
        >
          <option value="previous">{t('compareModePrevious')}</option>
          <option value="year">{t('compareModeYear')}</option>
        </select>
      </label>
    </div>
  );
}
