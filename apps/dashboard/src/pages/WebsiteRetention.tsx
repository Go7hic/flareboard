import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { PropertyFilterBuilder } from '../components/PropertyFilterBuilder';
import { RetentionHeatmap, RetentionLegend, type RetentionDisplay } from '../components/RetentionHeatmap';
import { SectionCard } from '../components/SectionCard';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { QueryCard, QueryRow, Segmented } from '../components/behavior/QueryCard';
import { formatRate } from '../components/behavior/format';
import { buildRetentionMatrix, type RetentionApiRow, type RetentionMatrix } from '../components/behavior/retention-matrix';
import { Skeleton } from '../components/ui/skeleton';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { reportFiltersParam } from '../lib/websiteReportApi';

/** KPI weeks: the first return and the one-month mark. */
const KPI_WEEKS = [1, 2, 4] as const;

export default function WebsiteRetentionPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone, rangeQs } =
    useWebsiteReportContext('30d');
  const [filters, setFilters] = useState<PropertyFilter[]>([]);
  const [display, setDisplay] = useState<RetentionDisplay>('percent');
  const filtersQs = reportFiltersParam(filters);

  const retentionQuery = useQuery({
    queryKey: ['reports-retention', websiteId, range, segmentId, filtersQs],
    enabled: Boolean(websiteId),
    queryFn: () => api<{ cohorts: RetentionApiRow[] }>(reportUrl('retention', filtersQs)),
    placeholderData: keepPreviousData,
  });

  const matrix = useMemo(
    () => buildRetentionMatrix(retentionQuery.data?.cohorts ?? [], Date.now()),
    [retentionQuery.data?.cohorts],
  );

  return (
    <Page className="page-retention">
      <PageHeader
        title={t('retention')}
        lead={t('behaviorRetentionLead')}
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
          <QueryRow label={t('insightFilters')}>
            <PropertyFilterBuilder websiteId={websiteId} rangeQs={rangeQs} value={filters} onChange={setFilters} />
          </QueryRow>
          <p className="behavior-query-note">{t('retentionReportInsightHint')}</p>
        </QueryCard>

        <DataViewState
          loading={retentionQuery.isLoading && !retentionQuery.data}
          error={retentionQuery.isError ? retentionQuery.error : null}
          onRetry={() => retentionQuery.refetch()}
          loadingFallback={<RetentionSkeleton />}
        >
          {matrix.cohorts.length ? (
            <div className={cn('stack', retentionQuery.isPlaceholderData && 'behavior-refetching')}>
              <RetentionKpis matrix={matrix} />
              <SectionCard
                flush
                title={t('behaviorRetentionCohorts')}
                description={t('behaviorRetentionCohortsLead')}
                actions={
                  <Segmented
                    value={display}
                    onChange={setDisplay}
                    label={t('behaviorRetentionShow')}
                    options={[
                      { value: 'percent', label: t('percentage') },
                      { value: 'count', label: t('behaviorRetentionCounts') },
                    ]}
                  />
                }
                footer={<RetentionLegend maxPct={matrix.maxPct} />}
              >
                <RetentionHeatmap matrix={matrix} display={display} />
              </SectionCard>
            </div>
          ) : (
            <EmptyState
              variant="rich"
              icon={<Repeat strokeWidth={2} />}
              title={t('noDataInPeriod')}
              description={t('behaviorRetentionEmptyBody')}
            />
          )}
        </DataViewState>
      </PageBody>
    </Page>
  );
}

function RetentionKpis({ matrix }: { matrix: RetentionMatrix }) {
  return (
    <KpiStrip columns={4}>
      <KpiCell
        label={t('users')}
        value={formatNumber(matrix.totalUsers)}
        hint={t('behaviorRetentionCohortsN').replace('{n}', formatNumber(matrix.cohorts.length))}
      />
      {KPI_WEEKS.map((week) => {
        const average = matrix.averages[week - 1];
        const label = t('behaviorRetentionWeekN').replace('{n}', String(week));
        if (!average || average.pct == null) {
          return (
            <KpiCell
              key={week}
              label={label}
              value="—"
              hint={t('behaviorRetentionNeedsWeeks').replace('{n}', String(week + 1))}
            />
          );
        }
        return (
          <KpiCell
            key={week}
            label={label}
            value={formatRate(average.pct)}
            hint={t('behaviorRetentionReturned')
              .replace('{users}', formatNumber(average.users))
              .replace('{size}', formatNumber(average.size))}
          />
        );
      })}
    </KpiStrip>
  );
}

function RetentionSkeleton() {
  return (
    <div className="stack" aria-hidden>
      <KpiStripSkeleton cells={4} />
      <SectionCard flush title={t('behaviorRetentionCohorts')}>
        <div className="behavior-table-skeleton">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
