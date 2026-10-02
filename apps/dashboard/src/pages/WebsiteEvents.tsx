import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MousePointerClick, SearchX } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { EventDataPanel } from '../components/EventDataPanel';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  ResourceSearchField,
} from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { EventDetail } from '../components/traffic/EventDetail';
import { countLabel, formatCount } from '../components/traffic/format';
import { RelativeTime } from '../components/traffic/RelativeTime';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { Skeleton } from '../components/ui/skeleton';
import { api, type EventCatalogResponse, type EventCatalogRow, type WebsiteStats } from '../lib/api';
import { eventDisplayName } from '../lib/autocapture';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsiteRange } from '../lib/useWebsiteRange';

type SortMode = 'recent' | 'volume';

function MasterDetailSkeleton() {
  return (
    <div className="master-detail-layout" aria-hidden>
      <div className="master-detail-list">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="traffic-list-skeleton">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </div>
        ))}
      </div>
      <div className="master-detail-pane">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="mt-3 h-4 w-1/2" />
        <Skeleton className="mt-6 h-[72px] w-full" />
        <Skeleton className="mt-6 h-[180px] w-full" />
      </div>
    </div>
  );
}

export default function WebsiteEventsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search.trim(), 250);
  const [sort, setSort] = useState<SortMode>('recent');
  const selectedName = searchParams.get('event');

  const catalogQuery = useQuery({
    queryKey: ['event-catalog', websiteId, query, rangeQs],
    enabled: Boolean(websiteId),
    // Typing in the search or changing the range keeps the list on screen.
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<EventCatalogResponse>(
        `/api/websites/${websiteId}/events/catalog?${rangeQs}${query ? `&q=${encodeURIComponent(query)}` : ''}`,
      ),
  });

  // Total visits in the range, for each event's share of visits.
  const statsQuery = useQuery({
    queryKey: ['website-stats', websiteId, rangeQs],
    enabled: Boolean(websiteId),
    queryFn: () => api<WebsiteStats>(`/api/websites/${websiteId}/stats?${rangeQs}`),
  });

  const catalog = useMemo(() => {
    const events = catalogQuery.data?.events ?? [];
    if (sort === 'recent') return events;
    return [...events].sort((a, b) => b.events - a.events || a.eventName.localeCompare(b.eventName));
  }, [catalogQuery.data, sort]);

  const selected: EventCatalogRow | null =
    catalog.find((event) => event.eventName === selectedName) ?? catalog[0] ?? null;

  const select = useCallback(
    (eventName: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('event', eventName);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const totalEvents = catalog.reduce((sum, event) => sum + event.events, 0);
  const initialLoading = catalogQuery.isLoading && !catalogQuery.data;
  const noEventsAtAll = !initialLoading && !catalog.length && !query;

  return (
    <Page className="page-events">
      <PageHeader
        title={t('navEvents')}
        lead={t('eventCatalogLead')}
        actions={<WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />}
      />

      <PageBody className="stack">
        <DataViewState
          loading={initialLoading}
          error={catalogQuery.isError && !catalogQuery.data ? catalogQuery.error : null}
          onRetry={() => catalogQuery.refetch()}
          loadingFallback={<MasterDetailSkeleton />}
        >
          {noEventsAtAll ? (
            <EmptyState
              variant="rich"
              icon={<MousePointerClick />}
              title={t('eventCatalogEmptyTitle')}
              description={t('eventCatalogEmptyBody')}
            >
              <pre className="traffic-snippet">
                <code>{"flareboard.track('signup', { plan: 'pro' })"}</code>
              </pre>
            </EmptyState>
          ) : (
            <MasterDetailLayout
              listHeader={
                <>
                  <ResourceSearchField
                    value={search}
                    onChange={setSearch}
                    placeholder={t('eventCatalogSearchPlaceholder')}
                    aria-label={t('eventCatalogSearchPlaceholder')}
                    className="traffic-list-search"
                  />
                  <div className="traffic-list-toolbar">
                    <span className="master-detail-list-count">
                      {countLabel('trafficEventTypes', catalog.length)} · {countLabel('trafficEventsTotal', totalEvents)}
                    </span>
                    <div className="segmented" role="group" aria-label={t('trafficSortBy')}>
                      <button type="button" aria-pressed={sort === 'recent'} onClick={() => setSort('recent')}>
                        {t('trafficSortRecent')}
                      </button>
                      <button type="button" aria-pressed={sort === 'volume'} onClick={() => setSort('volume')}>
                        {t('trafficSortVolume')}
                      </button>
                    </div>
                  </div>
                </>
              }
              list={
                catalog.length ? (
                  catalog.map((event) => {
                    const builtin = eventDisplayName(event.eventName) !== event.eventName;
                    return (
                      <MasterDetailListItem
                        key={event.eventName}
                        selected={event.eventName === selected?.eventName}
                        onSelect={() => select(event.eventName)}
                        title={
                          <span className={builtin ? undefined : 'mono'} title={event.eventName}>
                            {eventDisplayName(event.eventName)}
                          </span>
                        }
                        subtitle={`${countLabel('trafficPages', event.paths)} · ${countLabel('trafficProperties', event.propertyCount)}`}
                        meta={
                          <>
                            <span className="traffic-list-metric" title={formatNumber(event.events)}>
                              {formatCount(event.events)}
                            </span>
                            <RelativeTime value={event.lastSeenAt} />
                          </>
                        }
                      />
                    );
                  })
                ) : (
                  <EmptyState
                    icon={<SearchX />}
                    title={t('trafficNoMatchTitle')}
                    description={t('trafficNoMatchBody').replace('{query}', query)}
                  />
                )
              }
              detail={
                selected && websiteId ? (
                  <EventDetail
                    key={selected.eventName}
                    websiteId={websiteId}
                    event={selected}
                    rangeQs={rangeQs}
                    startAt={range.startAt}
                    endAt={range.endAt}
                    timezone={timezone}
                    totalVisits={statsQuery.data?.visits.value}
                  />
                ) : (
                  <div className="master-detail-pane">
                    <EmptyState icon={<MousePointerClick />} title={t('trafficSelectEvent')} />
                  </div>
                )
              }
            />
          )}
        </DataViewState>

        {websiteId ? <EventDataPanel websiteId={websiteId} rangeQs={rangeQs} /> : null}
      </PageBody>
    </Page>
  );
}
