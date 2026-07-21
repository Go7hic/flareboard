import type { MetricRow } from '../lib/api';
import { t } from '../lib/i18n';
import { DataViewState } from './DataViewState';
import { MetricsTable } from './MetricsTable';
import { SegmentTabs } from './SegmentTabs';

export type OverviewDimensionTab = {
  id: string;
  label: string;
};

export function OverviewDimensionCard({
  title,
  tabs,
  activeTab,
  onTabChange,
  rows,
  loading,
  error = null,
  onRetry,
  primaryMetric = 'views',
  onMoreClick,
}: {
  title: string;
  tabs: OverviewDimensionTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  rows: MetricRow[];
  loading?: boolean;
  error?: Error | string | null;
  onRetry?: () => void;
  primaryMetric?: 'views' | 'visitors';
  onMoreClick: () => void;
}) {
  return (
    <section className="panel overview-dimension-card">
      <div className="overview-dimension-card-head">
        <h2 className="overview-dimension-card-title">{title}</h2>
        <SegmentTabs
          tabs={tabs}
          value={activeTab}
          onChange={onTabChange}
          aria-label={title}
        />
      </div>
      <DataViewState error={error} onRetry={onRetry}>
        <MetricsTable
          embedded
          hideTitle
          maxRows={5}
          rows={rows}
          loading={loading}
          primaryMetric={primaryMetric}
          title=""
        />
      </DataViewState>
      <div className="overview-dimension-card-footer">
        <button type="button" className="overview-dimension-more" onClick={onMoreClick}>
          {t('overviewMore')}
        </button>
      </div>
    </section>
  );
}
