import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { SessionAvatar } from '../components/SessionAvatar';
import { SessionTechCell } from '../components/SessionTechCell';
import { countLabel } from '../components/traffic/format';
import { RelativeTime } from '../components/traffic/RelativeTime';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { api } from '../lib/api';
import { formatDurationSeconds, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { countryFlagEmoji, formatSessionLocation } from '../lib/session-display';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { cn } from '../lib/utils';

interface SessionRow {
  id: string;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  city: string | null;
  /** First event of the session (may be before the range). */
  createdAt?: number;
  visits: number;
  pageviews: number;
  events: number;
  lastAt: number;
}

interface SessionsPage {
  data: SessionRow[];
  count: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 50;
const ALL_DEVICES = 'all';
const DEVICES = ['desktop', 'mobile', 'tablet'] as const;

function deviceLabel(device: string) {
  if (device === 'desktop') return t('deviceDesktop');
  if (device === 'mobile') return t('deviceMobile');
  if (device === 'tablet') return t('deviceTablet');
  return t('allDevices');
}

/**
 * Time on site for a single-visit session that started inside the range. A session id
 * spans a visitor's visits for the month, so first-to-last event across several visits
 * would count the gaps between them; those rows show a dash instead.
 */
function sessionDuration(row: SessionRow, rangeStart: number): number | null {
  if (row.visits !== 1 || row.createdAt == null || row.createdAt < rangeStart) return null;
  return Math.max(0, (row.lastAt - row.createdAt) / 1000);
}

function TableSkeleton() {
  return (
    <div className="traffic-table-skeleton" aria-hidden>
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="traffic-table-skeleton-row">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="ml-auto h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

export default function SessionsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const navigate = useNavigate();
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const [pathFilter, setPathFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [browserFilter, setBrowserFilter] = useState('');
  const [referrerFilter, setReferrerFilter] = useState('');

  const debouncedPath = useDebouncedValue(pathFilter.trim(), 300);
  const debouncedCountry = useDebouncedValue(countryFilter.trim(), 300);
  const debouncedBrowser = useDebouncedValue(browserFilter.trim(), 300);
  const debouncedReferrer = useDebouncedValue(referrerFilter.trim(), 300);

  const filterQs = useMemo(() => {
    const params = new URLSearchParams(rangeQs);
    params.set('pageSize', String(PAGE_SIZE));
    if (debouncedPath) params.set('path', debouncedPath);
    if (debouncedCountry) params.set('country', debouncedCountry);
    if (deviceFilter) params.set('device', deviceFilter);
    if (debouncedBrowser) params.set('browser', debouncedBrowser);
    if (debouncedReferrer) params.set('referrer', debouncedReferrer);
    return params.toString();
  }, [debouncedBrowser, debouncedCountry, debouncedPath, debouncedReferrer, deviceFilter, rangeQs]);

  const hasFilters = Boolean(
    pathFilter.trim() || countryFilter.trim() || deviceFilter || browserFilter.trim() || referrerFilter.trim(),
  );

  const sessionsQuery = useInfiniteQuery({
    queryKey: ['sessions', websiteId, filterQs],
    enabled: Boolean(websiteId),
    // Keep the current rows on screen while a new filter loads instead of a skeleton per keystroke.
    placeholderData: keepPreviousData,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api<SessionsPage>(`/api/websites/${websiteId}/sessions?${filterQs}&page=${pageParam}`),
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.data.length, 0);
      if (loadedCount >= lastPage.count) return undefined;
      return lastPage.page + 1;
    },
  });

  const rows = sessionsQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const total = sessionsQuery.data?.pages[0]?.count ?? rows.length;
  const hasMore = rows.length < total;
  const refreshing = sessionsQuery.isFetching && !sessionsQuery.isFetchingNextPage && !sessionsQuery.isLoading;

  const clearFilters = () => {
    setPathFilter('');
    setCountryFilter('');
    setDeviceFilter('');
    setBrowserFilter('');
    setReferrerFilter('');
  };

  const sessionHref = (id: string) => `/websites/${websiteId}/sessions/${id}`;

  const toolbar = (
    <>
      <div className="traffic-filter traffic-filter--search">
        <Search className="traffic-filter-icon" size={14} strokeWidth={2} aria-hidden />
        <Input
          className="h-8"
          value={pathFilter}
          onChange={(event) => setPathFilter(event.target.value)}
          placeholder={t('sessionFilterPathPlaceholder')}
          aria-label={t('sessionFilterPath')}
        />
      </div>
      <Input
        className="traffic-filter h-8"
        value={countryFilter}
        onChange={(event) => setCountryFilter(event.target.value)}
        placeholder={t('trafficFilterCountryPlaceholder')}
        aria-label={t('sessionFilterCountry')}
      />
      <Select
        value={deviceFilter || ALL_DEVICES}
        onValueChange={(next) => setDeviceFilter(next === ALL_DEVICES || typeof next !== 'string' ? '' : next)}
        items={[ALL_DEVICES, ...DEVICES].map((device) => ({ value: device, label: deviceLabel(device) }))}
      >
        <SelectTrigger className="traffic-filter traffic-filter--select" aria-label={t('sessionFilterDevice')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[ALL_DEVICES, ...DEVICES].map((device) => (
            <SelectItem key={device} value={device}>
              {deviceLabel(device)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        className="traffic-filter h-8"
        value={browserFilter}
        onChange={(event) => setBrowserFilter(event.target.value)}
        placeholder={t('sessionFilterBrowserPlaceholder')}
        aria-label={t('sessionFilterBrowser')}
      />
      <Input
        className="traffic-filter h-8"
        value={referrerFilter}
        onChange={(event) => setReferrerFilter(event.target.value)}
        placeholder={t('sessionFilterReferrerPlaceholder')}
        aria-label={t('sessionFilterReferrer')}
      />
      {hasFilters ? (
        <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
          {t('reset')}
        </Button>
      ) : null}
      <span className="toolbar-spacer" />
      {sessionsQuery.data ? (
        <span className="toolbar-meta traffic-toolbar-count">{countLabel('trafficSessionsTotal', total)}</span>
      ) : null}
    </>
  );

  return (
    <Page className="page-sessions">
      <PageHeader
        title={t('sessions')}
        lead={t('sessionsPageLead')}
        actions={<WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />}
        toolbar={toolbar}
      />

      <PageBody>
        <SectionCard
          flush
          className={cn('traffic-sessions-card', refreshing && 'is-refreshing')}
          footer={
            rows.length ? (
              <>
                <span>
                  {t('showingSessionsOf')
                    .replace('{shown}', formatNumber(rows.length))
                    .replace('{total}', formatNumber(total))}
                </span>
                {hasMore ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={sessionsQuery.isFetchingNextPage}
                    onClick={() => sessionsQuery.fetchNextPage()}
                  >
                    {sessionsQuery.isFetchingNextPage ? t('loading') : t('sessionsLoadMore')}
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
        >
          {/* Filters stay outside the loading/error state so typing never unmounts them. */}
          <DataViewState
            loading={sessionsQuery.isLoading}
            error={sessionsQuery.isError && !sessionsQuery.data ? sessionsQuery.error : null}
            onRetry={() => sessionsQuery.refetch()}
            loadingFallback={<TableSkeleton />}
          >
            {rows.length === 0 ? (
              <EmptyState
                icon={<Users />}
                title={hasFilters ? t('noSessionsMatchFilters') : t('noSessionsInRange')}
                description={hasFilters ? t('noSessionsMatchFiltersHint') : t('noDataInPeriodHint')}
                action={
                  hasFilters ? (
                    <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                      {t('reset')}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="table-scroll" aria-busy={refreshing || undefined}>
                <table className="data-table data-table--interactive traffic-sessions-table">
                  <thead>
                    <tr>
                      <th>{t('trafficVisitor')}</th>
                      <th>{t('location')}</th>
                      <th>{t('device')}</th>
                      <th className="num">{t('trafficPagesColumn')}</th>
                      <th className="num">{t('events')}</th>
                      <th className="num">{t('trafficDuration')}</th>
                      <th className="num">{t('lastSeen')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const flag = countryFlagEmoji(row.country);
                      const duration = sessionDuration(row, range.startAt);
                      return (
                        <tr key={row.id} onClick={() => navigate(sessionHref(row.id))}>
                          <td>
                            <Link
                              to={sessionHref(row.id)}
                              className="traffic-visitor-cell"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <SessionAvatar seed={row.id} size={24} />
                              <span className="mono">{row.id.slice(0, 8)}</span>
                              {row.visits > 1 ? (
                                <span className="traffic-visits-badge">{countLabel('trafficVisits', row.visits)}</span>
                              ) : null}
                            </Link>
                          </td>
                          <td>
                            <span className="traffic-location-cell">
                              {flag ? (
                                <span className="traffic-flag" aria-hidden>
                                  {flag}
                                </span>
                              ) : null}
                              <span className="traffic-cell-truncate">{formatSessionLocation(row.country, row.city)}</span>
                            </span>
                          </td>
                          <td>
                            <SessionTechCell browser={row.browser} os={row.os} device={row.device} />
                          </td>
                          <td className="num">{formatNumber(row.pageviews)}</td>
                          <td className="num">{formatNumber(row.events)}</td>
                          <td
                            className={cn('num', duration === null && 'text-muted')}
                            title={duration === null ? t('trafficDurationUnknown') : undefined}
                          >
                            {duration === null ? '-' : formatDurationSeconds(duration)}
                          </td>
                          <td className="num">
                            <RelativeTime value={row.lastAt} className="text-muted" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </DataViewState>
        </SectionCard>
      </PageBody>
    </Page>
  );
}
