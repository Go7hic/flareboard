import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Route } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { JourneyFlowPanel } from '../components/JourneyFlowPanel';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { PropertyFilterBuilder } from '../components/PropertyFilterBuilder';
import { SectionCard } from '../components/SectionCard';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { QueryCard, QueryRow, Segmented } from '../components/behavior/QueryCard';
import { Skeleton } from '../components/ui/skeleton';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import {
  DEFAULT_JOURNEY_DEPTH,
  JOURNEY_DEPTH_OPTIONS,
  emptyJourneySelection,
  journeyFlowQuery,
  type JourneyColumnSelection,
  type JourneyFlowResponse,
} from '../lib/journey-utils';
import { reportFiltersParam } from '../lib/websiteReportApi';

export default function WebsiteJourneysPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone, rangeQs } =
    useWebsiteReportContext('30d');
  const [displayDepth, setDisplayDepth] = useState(DEFAULT_JOURNEY_DEPTH);
  const [filters, setFilters] = useState<PropertyFilter[]>([]);
  const filtersQs = reportFiltersParam(filters);
  const [selectedColumns, setSelectedColumns] = useState<JourneyColumnSelection>(() =>
    emptyJourneySelection(DEFAULT_JOURNEY_DEPTH),
  );

  useEffect(() => {
    setSelectedColumns((prev) => {
      const next = emptyJourneySelection(displayDepth);
      for (let i = 0; i < Math.min(prev.length, displayDepth); i++) {
        next[i] = prev[i];
      }
      return next;
    });
  }, [displayDepth]);

  const journeyQuery = useQuery({
    queryKey: ['reports-journey-flow', websiteId, range, segmentId, filtersQs],
    enabled: Boolean(websiteId),
    queryFn: () => api<JourneyFlowResponse>(reportUrl('journey', `${journeyFlowQuery([], 50)}${filtersQs}`)),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const data = journeyQuery.data;
  const hasData = (data?.next ?? []).length > 0 || (data?.paths ?? []).length > 0;

  return (
    <Page className="page-journeys">
      <PageHeader
        title={t('navJourneys')}
        lead={t('behaviorJourneysLead')}
        actions={
          <WebsiteReportControls
            range={range}
            onRangeChange={setRange}
            segmentId={segmentId}
            onSegmentChange={setSegmentId}
            segments={segments}
            timezone={timezone}
          />
        }
      />

      <PageBody className="stack">
        <QueryCard label={t('insightFilters')}>
          <QueryRow label={t('journeyDepth')}>
            <Segmented
              value={String(displayDepth)}
              onChange={(value) => setDisplayDepth(Number(value))}
              label={t('journeyDepth')}
              options={JOURNEY_DEPTH_OPTIONS.map((depth) => ({ value: String(depth), label: String(depth) }))}
            />
          </QueryRow>
          <QueryRow label={t('insightFilters')}>
            <PropertyFilterBuilder websiteId={websiteId} rangeQs={rangeQs} value={filters} onChange={setFilters} />
          </QueryRow>
        </QueryCard>

        <DataViewState
          loading={journeyQuery.isLoading && !data}
          error={journeyQuery.isError ? journeyQuery.error : null}
          onRetry={() => journeyQuery.refetch()}
          loadingFallback={<JourneySkeleton depth={displayDepth} />}
        >
          {data && hasData ? (
            <JourneyFlowPanel
              data={data}
              selectedColumns={selectedColumns}
              displayDepth={displayDepth}
              onSelectColumns={setSelectedColumns}
              onClear={() => setSelectedColumns(emptyJourneySelection(displayDepth))}
              refetching={journeyQuery.isPlaceholderData}
            />
          ) : (
            <EmptyState
              variant="rich"
              icon={<Route strokeWidth={2} />}
              title={t('noDataInPeriod')}
              description={t('behaviorJourneysEmptyBody')}
            />
          )}
        </DataViewState>
      </PageBody>
    </Page>
  );
}

function JourneySkeleton({ depth }: { depth: number }) {
  return (
    <SectionCard title={t('behaviorJourneyFlowTitle')}>
      <div className="behavior-journey-columns behavior-journey-columns--skeleton" aria-hidden>
        {Array.from({ length: Math.min(depth, 4) }, (_, column) => (
          <div key={column} className="behavior-journey-col">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-4 w-24" />
            <div className="behavior-journey-nodes">
              {Array.from({ length: Math.max(2, 6 - column * 2) }, (_, row) => (
                <Skeleton key={row} className="h-8 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
