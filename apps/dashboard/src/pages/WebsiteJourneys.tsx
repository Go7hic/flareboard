import { useQuery } from '@tanstack/react-query';
import { useMemo, useEffect, useState } from 'react';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { EmptyState } from '../components/EmptyState';
import { JourneyFlowPanel } from '../components/JourneyFlowPanel';
import { PropertyFilterBuilder } from '../components/PropertyFilterBuilder';
import { Label } from '../components/ui/label';
import { SegmentTabs } from '../components/SegmentTabs';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { reportFiltersParam } from '../lib/websiteReportApi';
import {
  DEFAULT_JOURNEY_DEPTH,
  JOURNEY_DEPTH_OPTIONS,
  emptyJourneySelection,
  journeyFlowQuery,
  type JourneyColumnSelection,
  type JourneyFlowResponse,
} from '../lib/journey-utils';

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
  });

  const hasData =
    (journeyQuery.data?.next ?? []).length > 0 || (journeyQuery.data?.paths ?? []).length > 0;
  const showSkeleton = journeyQuery.isLoading && !journeyQuery.data;
  const depthTabs = useMemo(
    () => JOURNEY_DEPTH_OPTIONS.map((depth) => ({ id: String(depth), label: String(depth) })),
    [],
  );

  return (
    <Page className="page-journeys">
      <PageHeader
        title={t('navJourneys')}
        lead={t('journeyLead')}
        actions={
          <div className="journey-page-bar">
            {hasData ? (
              <p className="journey-page-hint">{t('journeySelectStep')}</p>
            ) : null}
            <WebsiteReportControls
              range={range}
              onRangeChange={setRange}
              segmentId={segmentId}
              onSegmentChange={setSegmentId}
              segments={segments}
              timezone={timezone}
              leading={
                hasData ? (
                  <SegmentTabs
                    tabs={depthTabs}
                    value={String(displayDepth)}
                    onChange={(id) => setDisplayDepth(Number(id))}
                    aria-label={t('journeyDepth')}
                    className="journey-depth-tabs"
                  />
                ) : null
              }
            />
          </div>
        }
      />

      <PageBody>
      <section className="panel section-gap">
        <div className="field">
          <Label>{t('insightFilters')}</Label>
          <PropertyFilterBuilder websiteId={websiteId} rangeQs={rangeQs} value={filters} onChange={setFilters} />
        </div>
      </section>
      <section className="section-gap">
        {showSkeleton ? (
          <div className="panel">
            <div className="skeleton skeleton-block" aria-busy />
          </div>
        ) : !hasData ? (
          <div className="section-gap">
            <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />
          </div>
        ) : journeyQuery.data ? (
          <JourneyFlowPanel
            data={journeyQuery.data}
            selectedColumns={selectedColumns}
            displayDepth={displayDepth}
            onSelectColumns={setSelectedColumns}
            onClear={() => setSelectedColumns(emptyJourneySelection(displayDepth))}
          />
        ) : null}
      </section>
      </PageBody>
    </Page>
  );
}
