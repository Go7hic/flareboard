import type { ReactNode } from 'react';
import { DateRangePicker } from './DateRangePicker';
import { ExportMenu } from './ExportMenu';
import { RealtimeOnlineKpi } from './RealtimeOnlineKpi';
import { SegmentFilterMenu } from './SegmentFilterMenu';
import { type CompareMode } from '../lib/compare-utils';
import { type DateRangePreset } from '../lib/dateRange';
import { t } from '../lib/i18n';

export interface WebsiteAnalyticsSegment {
  id: string;
  name: string;
}

export type WebsiteAnalyticsRange = {
  preset: DateRangePreset;
  startAt: number;
  endAt: number;
};

/**
 * Shared website analytics chrome.
 * Order: leading → live KPI → segment → date → compare mode → export.
 */
export function WebsiteAnalyticsControls({
  websiteId,
  range,
  onRangeChange,
  timezone = 'UTC',
  leading,
  showRealtime = false,
  showSegment = false,
  segmentId = '',
  onSegmentChange,
  segments = [],
  showCompareToggle = false,
  compareEnabled = false,
  onCompareChange,
  showCompareMode = false,
  compareMode = 'previous',
  onCompareModeChange,
  showExport = false,
  onExport,
  exportAllowed = true,
  layout = 'controls',
}: {
  websiteId?: string;
  range: WebsiteAnalyticsRange;
  onRangeChange: (next: WebsiteAnalyticsRange) => void;
  timezone?: string;
  leading?: ReactNode;
  showRealtime?: boolean;
  showSegment?: boolean;
  segmentId?: string;
  onSegmentChange?: (id: string) => void;
  segments?: WebsiteAnalyticsSegment[];
  showCompareToggle?: boolean;
  compareEnabled?: boolean;
  onCompareChange?: (enabled: boolean) => void;
  showCompareMode?: boolean;
  compareMode?: CompareMode;
  onCompareModeChange?: (mode: CompareMode) => void;
  showExport?: boolean;
  onExport?: (type: 'pageviews' | 'events') => void;
  exportAllowed?: boolean;
  /** `row` wraps live KPI + controls (overview). `controls` is the filter strip only. */
  layout?: 'row' | 'controls';
}) {
  const controls = (
    <div className={`stats-header-controls${showCompareMode ? ' compare-report-controls' : ''}`}>
      {leading}
      {showSegment && onSegmentChange ? (
        <SegmentFilterMenu
          segmentId={segmentId}
          onSegmentChange={onSegmentChange}
          segments={segments}
          compareEnabled={showCompareToggle ? compareEnabled : false}
          onCompareChange={showCompareToggle && onCompareChange ? onCompareChange : () => {}}
        />
      ) : null}
      <DateRangePicker value={range} onChange={onRangeChange} popover timezone={timezone} />
      {showCompareMode && onCompareModeChange ? (
        <>
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
        </>
      ) : null}
      {showExport && onExport ? (
        <ExportMenu
          onExport={onExport}
          disabled={!exportAllowed}
          disabledReason={t('dataPortabilityRequiresUpgrade')}
        />
      ) : null}
    </div>
  );

  if (layout === 'row' && showRealtime && websiteId) {
    return (
      <div className="stats-header-row">
        <RealtimeOnlineKpi websiteId={websiteId} />
        {controls}
      </div>
    );
  }

  return controls;
}
