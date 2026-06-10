import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MetricsTable } from './MetricsTable';
import { SegmentTabs } from './SegmentTabs';
import { Skeleton } from './ui/skeleton';
import { isMetricTab, METRIC_TABS, metricTabLabel, metricTabTableTitle, type MetricTab } from '../lib/breakdown-dimensions';
import { useBreakdownMetrics, type PathSortBy } from '../hooks/useBreakdownMetrics';
import { t } from '../lib/i18n';

const CountryMap = lazy(() =>
  import('./CountryMap').then((m) => ({ default: m.CountryMap })),
);

export function WebsiteBreakdownPanel({
  websiteId,
  rangeQs,
  segmentQs = '',
}: {
  websiteId: string;
  rangeQs: string;
  segmentQs?: string;
}) {
  const [searchParams] = useSearchParams();
  const typeParam = searchParams.get('type');
  const initialTab = typeParam && isMetricTab(typeParam) ? typeParam : 'path';
  const [metricTab, setMetricTab] = useState<MetricTab>(initialTab);
  const [pathSortBy, setPathSortBy] = useState<PathSortBy>('views');

  const { rows: metricsRows, isLoading: metricsLoading } = useBreakdownMetrics({
    websiteId,
    rangeQs,
    segmentQs,
    metricTab,
    pathSortBy,
  });

  return (
    <section className="panel breakdown-panel section-gap-lg">
      <div className="breakdown-panel-head">
        <SegmentTabs
          tabs={METRIC_TABS.map((tab) => ({ id: tab, label: metricTabLabel(tab) }))}
          value={metricTab}
          onChange={(id) => setMetricTab(id as MetricTab)}
          aria-label={t('topMetric')}
        />
      </div>
      {metricTab === 'path' ? (
        <div className="path-sort-toolbar" role="group" aria-label={t('pagesSortBy')}>
          <span className="path-sort-toolbar-label">{t('pagesSortBy')}:</span>
          <SegmentTabs
            tabs={(['views', 'visitors', 'time'] as PathSortBy[]).map((sort) => ({
              id: sort,
              label: t(`pagesSort_${sort}`),
            }))}
            value={pathSortBy}
            onChange={(id) => setPathSortBy(id as PathSortBy)}
            aria-label={t('pagesSortBy')}
          />
        </div>
      ) : null}
      {metricTab === 'country' ? (
        <div className="breakdown-map">
          <h3 className="section-title">{t('countryMap')}</h3>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <CountryMap rows={metricsRows} />
          </Suspense>
        </div>
      ) : null}
      <MetricsTable
        embedded
        title={metricTabTableTitle(metricTab)}
        rows={metricsRows}
        loading={metricsLoading}
        showPageStats={metricTab === 'path'}
      />
    </section>
  );
}
