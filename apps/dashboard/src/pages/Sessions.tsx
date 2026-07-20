import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { SessionAvatar } from '../components/SessionAvatar';
import { SessionTechCell } from '../components/SessionTechCell';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import {
  countryFlagEmoji,
  formatRelativeTime,
  formatSessionLocation,
} from '../lib/session-display';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsiteRange } from '../lib/useWebsiteRange';

interface SessionRow {
  id: string;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  city: string | null;
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
const DEVICE_FILTERS = ['', 'desktop', 'mobile', 'tablet'] as const;

export default function SessionsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
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
    debouncedPath || debouncedCountry || deviceFilter || debouncedBrowser || debouncedReferrer,
  );

  const sessionsQuery = useInfiniteQuery({
    queryKey: [
      'sessions',
      websiteId,
      range,
      debouncedPath,
      debouncedCountry,
      deviceFilter,
      debouncedBrowser,
      debouncedReferrer,
    ],
    enabled: Boolean(websiteId),
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

  const clearFilters = () => {
    setPathFilter('');
    setCountryFilter('');
    setDeviceFilter('');
    setBrowserFilter('');
    setReferrerFilter('');
  };

  return (
    <div className="page page-sessions">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />
        }
      />

      <DataViewState
        loading={sessionsQuery.isLoading}
        error={sessionsQuery.isError ? sessionsQuery.error : null}
        onRetry={() => sessionsQuery.refetch()}
        loadingFallback={<div className="skeleton section-gap" style={{ height: '4rem' }} />}
      >
        <section className="panel sessions-panel section-gap">
          <div className="sessions-filter-row">
            <Input
              className="sessions-filter-input"
              value={pathFilter}
              onChange={(event) => setPathFilter(event.target.value)}
              placeholder={t('sessionFilterPathPlaceholder')}
              aria-label={t('sessionFilterPath')}
            />
            <Input
              className="sessions-filter-input sessions-filter-input--narrow"
              value={countryFilter}
              onChange={(event) => setCountryFilter(event.target.value)}
              placeholder={t('sessionFilterCountryPlaceholder')}
              aria-label={t('sessionFilterCountry')}
            />
            <select
              className="select sessions-filter-select"
              value={deviceFilter}
              onChange={(event) => setDeviceFilter(event.target.value)}
              aria-label={t('sessionFilterDevice')}
            >
              <option value="">{t('allDevices')}</option>
              {DEVICE_FILTERS.filter(Boolean).map((device) => (
                <option key={device} value={device}>
                  {device === 'desktop'
                    ? t('deviceDesktop')
                    : device === 'mobile'
                      ? t('deviceMobile')
                      : t('deviceTablet')}
                </option>
              ))}
            </select>
            <Input
              className="sessions-filter-input"
              value={browserFilter}
              onChange={(event) => setBrowserFilter(event.target.value)}
              placeholder={t('sessionFilterBrowserPlaceholder')}
              aria-label={t('sessionFilterBrowser')}
            />
            <Input
              className="sessions-filter-input"
              value={referrerFilter}
              onChange={(event) => setReferrerFilter(event.target.value)}
              placeholder={t('sessionFilterReferrerPlaceholder')}
              aria-label={t('sessionFilterReferrer')}
            />
            {hasFilters ? (
              <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>
                {t('reset')}
              </Button>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <EmptyState
              title={hasFilters ? t('noSessionsMatchFilters') : t('noSessionsInRange')}
              description={
                hasFilters ? t('noSessionsMatchFiltersHint') : t('noDataInPeriodHint')
              }
            />
          ) : (
            <>
          <div className="sessions-table-scroll">
            <table className="data-table sessions-data-table">
              <thead>
                <tr>
                  <th className="sessions-col-session">{t('session')}</th>
                  <th className="num">{t('visits')}</th>
                  <th className="num">{t('pageviews')}</th>
                  <th className="num">{t('customEvents')}</th>
                  <th>{t('location')}</th>
                  <th>{t('browser')}</th>
                  <th>{t('os')}</th>
                  <th>{t('device')}</th>
                  <th className="sessions-col-last">{t('lastSeen')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const flag = countryFlagEmoji(s.country);
                  const location = formatSessionLocation(s.country, s.city);
                  return (
                    <tr key={s.id}>
                      <td>
                        <Link
                          to={`/websites/${websiteId}/sessions/${s.id}`}
                          className="sessions-row-link"
                        >
                          <SessionAvatar seed={s.id} size={32} className="sessions-table-avatar" />
                        </Link>
                      </td>
                      <td className="num">{formatNumber(s.visits)}</td>
                      <td className="num">{formatNumber(s.pageviews)}</td>
                      <td className="num">{formatNumber(s.events)}</td>
                      <td>
                        <Link
                          to={`/websites/${websiteId}/sessions/${s.id}`}
                          className="sessions-row-link sessions-location-cell"
                        >
                          {flag ? (
                            <span className="sessions-flag" aria-hidden>
                              {flag}
                            </span>
                          ) : null}
                          <span>{location}</span>
                        </Link>
                      </td>
                      <td>
                        <Link to={`/websites/${websiteId}/sessions/${s.id}`} className="sessions-row-link">
                          <SessionTechCell kind="browser" value={s.browser} />
                        </Link>
                      </td>
                      <td>
                        <Link to={`/websites/${websiteId}/sessions/${s.id}`} className="sessions-row-link">
                          <SessionTechCell kind="os" value={s.os} />
                        </Link>
                      </td>
                      <td>
                        <Link to={`/websites/${websiteId}/sessions/${s.id}`} className="sessions-row-link">
                          <SessionTechCell kind="device" value={s.device} />
                        </Link>
                      </td>
                      <td className="sessions-col-last">
                        <Link
                          to={`/websites/${websiteId}/sessions/${s.id}`}
                          className="sessions-row-link sessions-last-cell"
                          title={formatDateTime(s.lastAt)}
                        >
                          {formatRelativeTime(s.lastAt)}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="sessions-footer">
            <p>
              {t('showingSessionsOf')
                .replace('{shown}', String(rows.length))
                .replace('{total}', String(total))}
            </p>
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
          </footer>
            </>
          )}
        </section>
      </DataViewState>
    </div>
  );
}
