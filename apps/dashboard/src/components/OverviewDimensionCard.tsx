import type { MetricRow } from '../lib/api';
import { t } from '../lib/i18n';
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
  primaryMetric = 'views',
  onMoreClick,
}: {
  title: string;
  tabs: OverviewDimensionTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  rows: MetricRow[];
  loading?: boolean;
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
      <MetricsTable
        embedded
        hideTitle
        maxRows={5}
        rows={rows}
        loading={loading}
        primaryMetric={primaryMetric}
        title=""
      />
      <div className="overview-dimension-card-footer">
        <button type="button" className="overview-dimension-more" onClick={onMoreClick}>
          {t('overviewMore')}
        </button>
      </div>
    </section>
  );
}
