import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MetricsExplorerModal } from './MetricsExplorerModal';
import { OverviewDimensionCard } from './OverviewDimensionCard';
import { useDimensionMetrics } from '../hooks/useDimensionMetrics';
import { isMetricTab } from '../lib/breakdown-dimensions';
import { formatMetricLabel } from '../lib/metric-labels';
import { t } from '../lib/i18n';

const CARD_LIMIT = 5;

type CardConfig = {
  titleKey: string;
  tabs: Array<{ id: string; labelKey: string }>;
  defaultTab: string;
  primaryMetric?: 'views' | 'visitors';
};

const OVERVIEW_CARDS: CardConfig[] = [
  {
    titleKey: 'overviewCardPages',
    tabs: [
      { id: 'path', labelKey: 'segmentField_path' },
      { id: 'entry', labelKey: 'overviewTabEntry' },
      { id: 'exit', labelKey: 'overviewTabExit' },
    ],
    defaultTab: 'path',
    primaryMetric: 'visitors' as const,
  },
  {
    titleKey: 'overviewCardSources',
    tabs: [
      { id: 'referrer', labelKey: 'segmentField_referrer' },
      { id: 'channel', labelKey: 'overviewTabChannel' },
    ],
    defaultTab: 'referrer',
  },
  {
    titleKey: 'overviewCardEnvironment',
    tabs: [
      { id: 'browser', labelKey: 'browser' },
      { id: 'os', labelKey: 'os' },
      { id: 'device', labelKey: 'device' },
    ],
    defaultTab: 'browser',
  },
  {
    titleKey: 'overviewCardLocation',
    tabs: [
      { id: 'country', labelKey: 'country' },
      { id: 'region', labelKey: 'segmentField_region' },
      { id: 'city', labelKey: 'segmentField_city' },
    ],
    defaultTab: 'country',
  },
];

export function OverviewDimensions({
  websiteId,
  qs,
  rangeQs,
  segmentQs = '',
  metricsPathPrefix,
  hideExplorer = false,
}: {
  websiteId: string;
  qs: string;
  rangeQs: string;
  segmentQs?: string;
  metricsPathPrefix?: string;
  hideExplorer?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pagesTab, setPagesTab] = useState('path');
  const [sourcesTab, setSourcesTab] = useState('referrer');
  const [environmentTab, setEnvironmentTab] = useState('browser');
  const [locationTab, setLocationTab] = useState('country');
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerType, setExplorerType] = useState('path');

  const tabState: Record<string, { active: string; set: (id: string) => void }> = {
    overviewCardPages: { active: pagesTab, set: setPagesTab },
    overviewCardSources: { active: sourcesTab, set: setSourcesTab },
    overviewCardEnvironment: { active: environmentTab, set: setEnvironmentTab },
    overviewCardLocation: { active: locationTab, set: setLocationTab },
  };

  const openExplorer = useCallback((type: string) => {
    setExplorerType(type);
    setExplorerOpen(true);
  }, []);

  const closeExplorer = useCallback(() => {
    setExplorerOpen(false);
    if (searchParams.has('explorer')) {
      const next = new URLSearchParams(searchParams);
      next.delete('explorer');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (hideExplorer) return;
    const explorerParam = searchParams.get('explorer');
    if (explorerParam && isMetricTab(explorerParam)) {
      setExplorerType(explorerParam);
      setExplorerOpen(true);
    }
  }, [searchParams, hideExplorer]);

  return (
    <section className="overview-dimensions section-gap" aria-labelledby="overview-dimensions-heading">
      <header className="overview-dimensions-head">
        <h2 id="overview-dimensions-heading" className="section-title">
          {t('breakdownMetrics')}
        </h2>
      </header>
      <div className="overview-dimensions-grid">
        {OVERVIEW_CARDS.map((card) => (
          <OverviewDimensionCardSection
            key={card.titleKey}
            websiteId={websiteId}
            qs={qs}
            metricsPathPrefix={metricsPathPrefix}
            card={card}
            activeTab={tabState[card.titleKey].active}
            onTabChange={tabState[card.titleKey].set}
            onMoreClick={hideExplorer ? undefined : openExplorer}
          />
        ))}
      </div>

      {hideExplorer ? null : (
        <MetricsExplorerModal
          open={explorerOpen}
          onClose={closeExplorer}
          websiteId={websiteId}
          rangeQs={rangeQs}
          segmentQs={segmentQs}
          initialType={explorerType}
        />
      )}
    </section>
  );
}

function OverviewDimensionCardSection({
  websiteId,
  qs,
  metricsPathPrefix,
  card,
  activeTab,
  onTabChange,
  onMoreClick,
}: {
  websiteId: string;
  qs: string;
  metricsPathPrefix?: string;
  card: CardConfig;
  activeTab: string;
  onTabChange: (tabId: string) => void;
  onMoreClick?: (type: string) => void;
}) {
  const metricsQuery = useDimensionMetrics({
    websiteId,
    type: activeTab,
    qs,
    limit: CARD_LIMIT,
    pathSortBy: activeTab === 'path' ? 'visitors' : undefined,
    metricsPathPrefix,
  });

  const tabs = card.tabs.map((tab) => ({ id: tab.id, label: t(tab.labelKey) }));
  const rows = (metricsQuery.data ?? []).map((row) => ({
    ...row,
    x: formatMetricLabel(activeTab, row.x),
  }));

  return (
    <OverviewDimensionCard
      title={t(card.titleKey)}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      rows={rows}
      loading={metricsQuery.isLoading}
      error={metricsQuery.isError ? metricsQuery.error : null}
      onRetry={() => metricsQuery.refetch()}
      primaryMetric={card.primaryMetric}
      onMoreClick={onMoreClick ? () => onMoreClick(activeTab) : undefined}
    />
  );
}
