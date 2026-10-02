import { lazy, Suspense } from 'react';
import { SectionCard } from './SectionCard';
import { TrafficHeatmap } from './TrafficHeatmap';
import { Skeleton } from './ui/skeleton';
import { useDimensionMetrics } from '../hooks/useDimensionMetrics';
import { useTrafficHeatmap } from '../hooks/useTrafficHeatmap';
import { t } from '../lib/i18n';

const CountryMap = lazy(() =>
  import('./CountryMap').then((m) => ({ default: m.CountryMap })),
);

const MAP_LIMIT = 50;

/** Visitors by country on a map (overview). */
export function OverviewCountryMapCard({
  websiteId,
  qs,
  className,
}: {
  websiteId: string;
  qs: string;
  className?: string;
}) {
  const countryMapQuery = useDimensionMetrics({
    websiteId,
    type: 'country',
    qs,
    limit: MAP_LIMIT,
  });

  return (
    <SectionCard className={className} title={t('countryMap')}>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <CountryMap rows={countryMapQuery.data ?? []} loading={countryMapQuery.isLoading} />
      </Suspense>
    </SectionCard>
  );
}

/** Weekday × hour traffic heatmap (overview). */
export function OverviewTrafficHeatmapCard({
  websiteId,
  qs,
  className,
}: {
  websiteId: string;
  qs: string;
  className?: string;
}) {
  const heatmapQuery = useTrafficHeatmap({ websiteId, qs });

  return (
    <SectionCard className={className} title={t('navGroupTraffic')} description={t('trafficHeatmapLead')}>
      <TrafficHeatmap
        cells={heatmapQuery.data?.cells ?? []}
        max={heatmapQuery.data?.max ?? 0}
        loading={heatmapQuery.isLoading}
      />
    </SectionCard>
  );
}
