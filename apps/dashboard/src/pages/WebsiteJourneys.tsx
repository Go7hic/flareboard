import { useQuery } from '@tanstack/react-query';
import { useMemo, useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { JourneyFlowPanel } from '../components/JourneyFlowPanel';
import { SegmentTabs } from '../components/SegmentTabs';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
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

export default function WebsiteJourneysPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone } =
    useWebsiteReportContext('30d');
  const [displayDepth, setDisplayDepth] = useState(DEFAULT_JOURNEY_DEPTH);
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
    queryKey: ['reports-journey-flow', websiteId, range, segmentId],
    enabled: Boolean(websiteId),
    queryFn: () => api<JourneyFlowResponse>(reportUrl('journey', journeyFlowQuery([], 50))),
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
    <div className="page page-journeys">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
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

      <section className="section-gap">
        {showSkeleton ? (
          <div className="panel">
            <div className="skeleton skeleton-block" aria-busy />
          </div>
        ) : !hasData ? (
          <div className="panel">
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
    </div>
  );
}
