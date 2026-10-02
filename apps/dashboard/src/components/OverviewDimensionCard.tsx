import { ArrowRight } from 'lucide-react';
import type { MetricRow } from '../lib/api';
import { t } from '../lib/i18n';
import { DataViewState } from './DataViewState';
import { MetricsTable } from './MetricsTable';
import { SectionCard } from './SectionCard';
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
  onMoreClick?: () => void;
}) {
  return (
    <SectionCard
      className="overview-dimension-card"
      title={title}
      actions={<SegmentTabs tabs={tabs} value={activeTab} onChange={onTabChange} aria-label={title} />}
      footer={
        onMoreClick ? (
          <button type="button" className="card-footer-link" onClick={onMoreClick}>
            {t('overviewMore')}
            <ArrowRight aria-hidden />
          </button>
        ) : undefined
      }
    >
      <DataViewState error={error} onRetry={onRetry}>
        <MetricsTable
          embedded
          hideTitle
          maxRows={8}
          rows={rows}
          loading={loading}
          primaryMetric={primaryMetric}
          title=""
        />
      </DataViewState>
    </SectionCard>
  );
}
