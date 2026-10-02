import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Filter } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { EventCatalogPicker } from '../components/EventCatalogPicker';
import { formatDurationShort } from '../components/InsightResultView';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { PropertyFilterBuilder } from '../components/PropertyFilterBuilder';
import { SectionCard } from '../components/SectionCard';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { FunnelSteps } from '../components/behavior/FunnelSteps';
import { InlineSelect, QueryCard, QueryRow } from '../components/behavior/QueryCard';
import { formatRate } from '../components/behavior/format';
import { Skeleton } from '../components/ui/skeleton';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api, type EventCatalogResponse } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { reportFiltersParam } from '../lib/websiteReportApi';

type FunnelResponse = {
  steps: Array<{
    step: string;
    count: number;
    rate: number;
    avgTimeToConvertMs?: number | null;
    medianTimeToConvertMs?: number | null;
  }>;
  conversion: number;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Conversion windows offered on the report page (the insight builder takes any value). */
const WINDOW_OPTIONS = [HOUR, DAY, 7 * DAY, 14 * DAY, 30 * DAY, 90 * DAY];

function windowLabel(ms: number) {
  return ms < DAY ? t('funnelWindowHours').replace('{n}', String(ms / HOUR)) : t('funnelWindowDays').replace('{n}', String(ms / DAY));
}

/**
 * Opening steps when the URL names none: `signup` → `purchase` when the website sends both,
 * otherwise its three custom events reached by the most sessions (busiest first, which is
 * usually the order of a funnel).
 */
function defaultFunnelSteps(events: EventCatalogResponse['events'] | undefined): string[] {
  if (!events) return [];
  const custom = events.filter((event) => !event.eventName.startsWith('$'));
  const names = new Set(custom.map((event) => event.eventName));
  if (names.has('signup') && names.has('purchase')) return ['signup', 'purchase'];
  return [...custom].sort((a, b) => b.sessions - a.sessions).slice(0, 3).map((event) => event.eventName);
}

export default function WebsiteFunnelPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone, rangeQs } =
    useWebsiteReportContext('30d');
  const [searchParams] = useSearchParams();
  // Saved funnel reports open with `?steps=a,b,c`; otherwise start from the website's own events.
  const [editedSteps, setFunnelSteps] = useState<string[] | null>(() => {
    const fromUrl = (searchParams.get('steps') ?? '')
      .split(',')
      .map((step) => step.trim())
      .filter(Boolean);
    return fromUrl.length ? fromUrl : null;
  });
  // Same query key as EventCatalogPicker, so the picker reuses this response.
  const catalogQuery = useQuery({
    queryKey: ['event-catalog', websiteId, ''],
    enabled: Boolean(websiteId) && editedSteps === null,
    queryFn: () => api<EventCatalogResponse>(`/api/websites/${websiteId}/events/catalog`),
  });
  const funnelSteps = editedSteps ?? defaultFunnelSteps(catalogQuery.data?.events);
  const [countBy, setCountBy] = useState<'session' | 'person'>('session');
  const [order, setOrder] = useState<'strict' | 'any'>('strict');
  const [windowMs, setWindowMs] = useState(90 * DAY);
  const [filters, setFilters] = useState<PropertyFilter[]>([]);

  const funnelStepsParam = funnelSteps.join(',');
  const filtersQs = reportFiltersParam(filters);
  const optionsQs = `&countBy=${countBy}&order=${order}&windowMs=${windowMs}`;

  const funnelQuery = useQuery({
    queryKey: ['reports-funnel', websiteId, funnelStepsParam, range, segmentId, optionsQs, filtersQs],
    enabled: Boolean(websiteId) && funnelSteps.length > 0,
    queryFn: () =>
      api<FunnelResponse>(reportUrl('funnel', `&steps=${encodeURIComponent(funnelStepsParam)}${optionsQs}${filtersQs}`)),
    // Editing a step or an option keeps the last result on screen (dimmed) until the new one lands.
    placeholderData: keepPreviousData,
  });

  const steps = funnelQuery.data?.steps ?? [];
  const funnelHasData = steps.some((step) => step.count > 0);
  const unitLabel = countBy === 'person' ? t('insightCountPeople') : t('insightCountSessions');
  const waitingForDefaults = editedSteps === null && catalogQuery.isLoading;
  const first = steps[0];
  const last = steps[steps.length - 1];
  const overall = first && last && first.count > 0 ? (last.count / first.count) * 100 : null;

  const resultDescription = `${t(order === 'strict' ? 'behaviorFunnelSummaryStrict' : 'behaviorFunnelSummaryAny').replace(
    '{unit}',
    unitLabel,
  )} · ${windowLabel(windowMs)}`;

  return (
    <Page className="page-funnel">
      <PageHeader
        title={t('funnel')}
        lead={t('behaviorFunnelLead')}
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
        <QueryCard className="behavior-funnel-query" label={t('insightSteps')}>
          <QueryRow label={t('insightSteps')} htmlFor="funnel-steps">
            <EventCatalogPicker
              mode="multi"
              id="funnel-steps"
              websiteId={websiteId}
              value={funnelSteps}
              onChange={setFunnelSteps}
              placeholder={t('funnelStepsPlaceholder')}
              aria-label={t('funnel')}
            />
          </QueryRow>
          <QueryRow label={t('behaviorQueryOptions')}>
            <InlineSelect
              label={t('insightCountBy')}
              value={countBy}
              onChange={(value) => setCountBy(value as 'session' | 'person')}
              options={[
                { value: 'session', label: t('insightCountSessions') },
                { value: 'person', label: t('insightCountPeople') },
              ]}
            />
            <InlineSelect
              label={t('insightStepOrder')}
              value={order}
              onChange={(value) => setOrder(value as 'strict' | 'any')}
              options={[
                { value: 'strict', label: t('insightOrderStrict') },
                { value: 'any', label: t('insightOrderAny') },
              ]}
            />
            <InlineSelect
              label={t('insightConversionWindow')}
              value={String(windowMs)}
              onChange={(value) => setWindowMs(Number(value))}
              options={WINDOW_OPTIONS.map((ms) => ({ value: String(ms), label: windowLabel(ms) }))}
            />
          </QueryRow>
          <QueryRow label={t('insightFilters')}>
            <PropertyFilterBuilder websiteId={websiteId} rangeQs={rangeQs} value={filters} onChange={setFilters} />
          </QueryRow>
        </QueryCard>

        {funnelSteps.length === 0 && !waitingForDefaults ? (
          <EmptyState
            variant="rich"
            icon={<Filter strokeWidth={2} />}
            title={t('funnelNoStepsTitle')}
            description={t('funnelNoStepsHint')}
          />
        ) : (
          <SectionCard
            title={t('behaviorFunnelResultTitle')}
            description={resultDescription}
            className={cn('behavior-funnel-card', funnelQuery.isPlaceholderData && 'behavior-refetching')}
          >
            <DataViewState
              loading={(funnelQuery.isLoading && !funnelQuery.data) || waitingForDefaults}
              error={funnelQuery.isError ? funnelQuery.error : null}
              onRetry={() => funnelQuery.refetch()}
              loadingFallback={<FunnelSkeleton />}
              isEmpty={!funnelHasData}
              emptyTitle={t('noDataInPeriod')}
              emptyDescription={steps.length > 0 ? t('funnelNoDataHint') : t('noDataInPeriodHint')}
            >
              <div className="stack">
                <KpiStrip inline columns={4}>
                  <KpiCell
                    label={t('overallConversion')}
                    value={formatRate(overall)}
                    hint={steps.length > 1 ? t('behaviorFunnelStepsN').replace('{n}', String(steps.length)) : undefined}
                  />
                  <KpiCell
                    label={t('behaviorFunnelEntered')}
                    value={formatNumber(first?.count)}
                    hint={unitLabel}
                  />
                  <KpiCell
                    label={t('behaviorFunnelCompleted')}
                    value={formatNumber(last?.count)}
                    hint={unitLabel}
                  />
                  <KpiCell
                    label={t('insightMedianTimeToConvert')}
                    value={steps.length > 1 && last?.medianTimeToConvertMs != null ? formatDurationShort(last.medianTimeToConvertMs) : '—'}
                    hint={
                      steps.length > 1 && last?.avgTimeToConvertMs != null
                        ? `${t('behaviorFunnelAverage')} ${formatDurationShort(last.avgTimeToConvertMs)}`
                        : undefined
                    }
                  />
                </KpiStrip>
                <FunnelSteps steps={steps} unitLabel={unitLabel} />
              </div>
            </DataViewState>
          </SectionCard>
        )}
      </PageBody>
    </Page>
  );
}

function FunnelSkeleton() {
  return (
    <div className="stack" aria-hidden>
      <KpiStripSkeleton cells={4} inline />
      <div className="behavior-funnel-skeleton">
        {[100, 62, 38].map((width) => (
          <div key={width} className="behavior-funnel-skeleton-row">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
