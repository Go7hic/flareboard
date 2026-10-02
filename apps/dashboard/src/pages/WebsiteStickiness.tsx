import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { Bar, BarChart } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { EventCatalogPicker } from '../components/EventCatalogPicker';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { PropertyFilterBuilder } from '../components/PropertyFilterBuilder';
import { SectionCard } from '../components/SectionCard';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { QueryCard, QueryRow, Segmented } from '../components/behavior/QueryCard';
import { formatRate } from '../components/behavior/format';
import { Skeleton } from '../components/ui/skeleton';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { BAR_MARK } from '../lib/chartMarks';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { cn } from '../lib/utils';
import { reportFiltersParam } from '../lib/websiteReportApi';

type StickinessResponse = {
  event: string | null;
  actor: 'person' | 'session';
  startAt: number;
  endAt: number;
  totalActors: number;
  actorDays: number;
  averageActiveDays: number;
  distribution: Array<{
    activeDays: number;
    actors: number;
    events: number;
    percentage: number;
  }>;
};

function daysLabel(days: number) {
  return days === 1 ? t('behaviorStickinessOneDay') : t('behaviorStickinessDays').replace('{n}', formatNumber(days));
}

export default function WebsiteStickinessPage() {
  const chartColors = useChartColors();
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone, rangeQs } =
    useWebsiteReportContext('30d');
  const [eventName, setEventName] = useState('');
  const [actor, setActor] = useState<'person' | 'session'>('person');
  const debouncedEventName = useDebouncedValue(eventName, 300);
  const [filters, setFilters] = useState<PropertyFilter[]>([]);
  const filtersQs = reportFiltersParam(filters);

  const stickinessQuery = useQuery({
    queryKey: ['reports-stickiness', websiteId, debouncedEventName, actor, range, segmentId, filtersQs],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<StickinessResponse>(
        reportUrl(
          'stickiness',
          `&actor=${actor}${debouncedEventName.trim() ? `&event=${encodeURIComponent(debouncedEventName.trim())}` : ''}${filtersQs}`,
        ),
      ),
    placeholderData: keepPreviousData,
  });

  const data = stickinessQuery.data;
  const distribution = useMemo(() => data?.distribution ?? [], [data?.distribution]);
  const chartData = useMemo(
    () =>
      distribution.map((row) => ({
        name: daysLabel(row.activeDays),
        actors: row.actors,
      })),
    [distribution],
  );
  // Actor type of the result on screen (the selector may already point at the next one).
  const shownActor = data?.actor ?? actor;
  const actorLabel = shownActor === 'session' ? t('stickinessActorSession') : t('stickinessActorPerson');
  const returning = distribution.filter((row) => row.activeDays >= 2).reduce((sum, row) => sum + row.actors, 0);
  const returningShare = data && data.totalActors > 0 ? (returning / data.totalActors) * 100 : null;
  const eventLabel = data?.event ? data.event : t('behaviorStickinessAllActivity');

  return (
    <Page className="page-stickiness">
      <PageHeader
        title={t('stickiness')}
        lead={t('behaviorStickinessLead')}
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
        <QueryCard label={t('stickinessEvent')}>
          <QueryRow label={t('stickinessEvent')} htmlFor="stickiness-event">
            <EventCatalogPicker
              mode="single"
              websiteId={websiteId}
              id="stickiness-event"
              value={eventName}
              onChange={setEventName}
              placeholder={t('stickinessEventPlaceholder')}
              allowEmpty
              className="behavior-query-picker"
            />
          </QueryRow>
          <QueryRow label={t('behaviorStickinessCount')}>
            <Segmented
              value={actor}
              onChange={setActor}
              label={t('stickinessActor')}
              options={[
                { value: 'person', label: t('stickinessActorPerson') },
                { value: 'session', label: t('stickinessActorSession') },
              ]}
            />
          </QueryRow>
          <QueryRow label={t('insightFilters')}>
            <PropertyFilterBuilder websiteId={websiteId} rangeQs={rangeQs} value={filters} onChange={setFilters} />
          </QueryRow>
        </QueryCard>

        <DataViewState
          loading={stickinessQuery.isLoading && !data}
          error={stickinessQuery.isError ? stickinessQuery.error : null}
          onRetry={() => stickinessQuery.refetch()}
          loadingFallback={<StickinessSkeleton />}
        >
          {data && distribution.length ? (
            <div className={cn('stack', stickinessQuery.isPlaceholderData && 'behavior-refetching')}>
              <KpiStrip columns={4}>
                <KpiCell label={actorLabel} value={formatNumber(data.totalActors)} hint={eventLabel} />
                <KpiCell
                  label={t('stickinessAverageDays')}
                  value={formatNumber(data.averageActiveDays, { maximumFractionDigits: 2 })}
                  hint={t('behaviorStickinessAvgHint')}
                />
                <KpiCell
                  label={t('behaviorStickinessReturning')}
                  value={formatRate(returningShare)}
                  hint={t('behaviorStickinessReturningHint').replace('{n}', formatNumber(returning))}
                />
                <KpiCell
                  label={t('stickinessActorDays')}
                  value={formatNumber(data.actorDays)}
                  hint={t('behaviorStickinessActorDaysHint')}
                />
              </KpiStrip>

              <div className="layout-grid">
                <SectionCard
                  className="span-7"
                  title={t('behaviorStickinessChartTitle').replace('{actor}', actorLabel)}
                  description={
                    <>
                      {t('behaviorStickinessChartLead')} ·{' '}
                      <span className={data.event ? 'mono' : undefined}>{eventLabel}</span>
                    </>
                  }
                >
                  <AnalyticsChart
                    Chart={BarChart}
                    data={chartData}
                    margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    xAxis={{ dataKey: 'name', interval: 0, minTickGap: 4 }}
                    responsive={{ height: 260 }}
                  >
                    <Bar dataKey="actors" name={actorLabel} fill={chartColors.accent} {...BAR_MARK} />
                  </AnalyticsChart>
                </SectionCard>

                <SectionCard className="span-5" flush title={t('behaviorStickinessTableTitle')}>
                  <div className="table-scroll">
                    <table className="data-table behavior-stickiness-table">
                      <thead>
                        <tr>
                          <th scope="col">{t('stickinessActiveDays')}</th>
                          <th scope="col" className="num">{actorLabel}</th>
                          <th scope="col" className="num">{t('events')}</th>
                          <th scope="col" className="num">{t('behaviorShare')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {distribution.map((row) => (
                          <tr key={row.activeDays}>
                            <td>{daysLabel(row.activeDays)}</td>
                            <td className="num">{formatNumber(row.actors)}</td>
                            <td className="num">{formatNumber(row.events)}</td>
                            <td className="num">{formatRate(row.percentage)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              </div>
            </div>
          ) : (
            <EmptyState
              variant="rich"
              icon={<CalendarDays strokeWidth={2} />}
              title={t('noDataInPeriod')}
              description={t('stickinessNoDataHint')}
            />
          )}
        </DataViewState>
      </PageBody>
    </Page>
  );
}

function StickinessSkeleton() {
  return (
    <div className="stack" aria-hidden>
      <KpiStripSkeleton cells={4} />
      <div className="layout-grid">
        <SectionCard className="span-7" title={t('stickinessActiveDays')}>
          <Skeleton className="h-[260px] w-full" />
        </SectionCard>
        <SectionCard className="span-5" flush title={t('behaviorStickinessTableTitle')}>
          <div className="behavior-table-skeleton">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-7 w-full" />
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
