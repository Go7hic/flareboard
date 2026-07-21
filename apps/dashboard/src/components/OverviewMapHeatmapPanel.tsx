import { lazy, Suspense } from 'react';
import { TrafficHeatmap } from './TrafficHeatmap';
import { Skeleton } from './ui/skeleton';
import { useDimensionMetrics } from '../hooks/useDimensionMetrics';
import { useTrafficHeatmap } from '../hooks/useTrafficHeatmap';
import { t } from '../lib/i18n';

const CountryMap = lazy(() =>
  import('./CountryMap').then((m) => ({ default: m.CountryMap })),
);

const MAP_LIMIT = 50;

export function OverviewMapHeatmapPanel({
  websiteId,
  qs,
}: {
  websiteId: string;
  qs: string;
}) {
  const countryMapQuery = useDimensionMetrics({
    websiteId,
    type: 'country',
    qs,
    limit: MAP_LIMIT,
  });

  const heatmapQuery = useTrafficHeatmap({ websiteId, qs });

  return (
    <section className="panel overview-map-heatmap" aria-label={t('overviewMapHeatmap')}>
      <div className="overview-map-heatmap-grid">
        <div className="overview-map-heatmap-col">
          <h2 className="section-title">{t('countryMap')}</h2>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <CountryMap rows={countryMapQuery.data ?? []} loading={countryMapQuery.isLoading} />
          </Suspense>
        </div>
        <div className="overview-map-heatmap-col">
          <h2 className="section-title">{t('navGroupTraffic')}</h2>
          <p className="section-lead overview-map-heatmap-lead">{t('trafficHeatmapLead')}</p>
          <TrafficHeatmap
            cells={heatmapQuery.data?.cells ?? []}
            max={heatmapQuery.data?.max ?? 0}
            loading={heatmapQuery.isLoading}
          />
        </div>
      </div>
    </section>
  );
}
