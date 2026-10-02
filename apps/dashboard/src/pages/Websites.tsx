import { useQuery } from '@tanstack/react-query';
import { Activity, Globe, Pencil, Plus, Settings } from 'lucide-react';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { ResourceSearchField } from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { PlanUpgradeBanner } from '../components/PlanUpgradeBanner';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { WebsiteFormDialog } from '../components/WebsiteFormDialog';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { SiteIdentity } from '../components/workspace/SiteIdentity';
import { Sparkline } from '../components/workspace/Sparkline';
import { displayDomain } from '../components/workspace/workspace-format';
import { api, type Website } from '../lib/api';
import { presetToRange, rangeQueryString } from '../lib/dateRange';
import { formatDateOnly, formatNumber, formatShortDate } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { useDemoSession } from '../lib/useDemoSession';

/** One site in `/api/dashboard` (the same numbers the dashboard home shows). */
interface ActivitySite {
  id: string;
  pageviews: number;
  visitors: number;
  visits?: number;
  series: Array<{ x: string; y: number }>;
}

interface DashboardActivity {
  websites: ActivitySite[];
  siteCount: number;
  cardsLimit: number;
}

type TrackingState = 'active' | 'quiet' | 'idle' | 'unknown';

const TRACKING_BADGE: Record<Exclude<TrackingState, 'unknown'>, { tone: 'success' | 'warning' | 'neutral'; key: string }> = {
  active: { tone: 'success', key: 'workspaceStatusActive' },
  quiet: { tone: 'warning', key: 'workspaceStatusQuiet' },
  idle: { tone: 'neutral', key: 'workspaceStatusIdle' },
};

function useActivity(range: { startAt: number; endAt: number }, key: string, enabled: boolean) {
  return useQuery({
    queryKey: ['websites-activity', key],
    enabled,
    staleTime: 60_000,
    queryFn: () => api<DashboardActivity>(`/api/dashboard?${rangeQueryString(range.startAt, range.endAt)}`),
  });
}

/** Sites missing from the response are only "unknown" when the API capped the list. */
function siteActivity(data: DashboardActivity | undefined, id: string): ActivitySite | null | undefined {
  if (!data) return undefined;
  const site = data.websites.find((row) => row.id === id);
  if (site) return site;
  return data.siteCount > data.cardsLimit ? undefined : null;
}

function trackingState(day: ActivitySite | null | undefined, week: ActivitySite | null | undefined): TrackingState {
  if (day === undefined || week === undefined) return 'unknown';
  if (day && day.pageviews > 0) return 'active';
  if (week && week.pageviews > 0) return 'quiet';
  return 'idle';
}

export default function Websites() {
  const navigate = useNavigate();
  const colors = useChartColors();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editingSite, setEditingSite] = useState<Website | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  // The read-only demo can neither add nor edit websites.
  const { isDemo } = useDemoSession();

  const websitesQuery = useQuery({
    queryKey: ['websites'],
    queryFn: () => api<Website[]>('/api/websites'),
  });

  const billingQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () =>
      api<{
        hosted: boolean;
        plan?: { maxWebsites?: number | null };
      }>('/api/billing/subscription'),
  });

  const sites = useMemo(() => websitesQuery.data ?? [], [websitesQuery.data]);
  const hasSites = sites.length > 0;
  const ranges = useMemo(() => ({ day: presetToRange('24h'), week: presetToRange('7d') }), []);
  const dayQuery = useActivity(ranges.day, '24h', hasSites);
  const weekQuery = useActivity(ranges.week, '7d', hasSites);

  const maxWebsites = billingQuery.data?.plan?.maxWebsites;
  const atWebsiteLimit =
    billingQuery.data?.hosted === true && typeof maxWebsites === 'number' && sites.length >= maxWebsites;

  // `/websites?new=1` (dashboard empty state) opens the add dialog.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    if (!isDemo) setCreating(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, isDemo]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = sites
      .filter(
        (site) =>
          !needle ||
          site.name.toLowerCase().includes(needle) ||
          displayDomain(site.domain).toLowerCase().includes(needle),
      )
      .map((site) => {
        const day = siteActivity(dayQuery.data, site.id);
        const week = siteActivity(weekQuery.data, site.id);
        return { site, day, week, state: trackingState(day, week) };
      });
    // Busiest first once the numbers are in (same order as the dashboard home).
    if (dayQuery.data && weekQuery.data) {
      list.sort(
        (a, b) =>
          (b.day?.visitors ?? -1) - (a.day?.visitors ?? -1) ||
          (b.week?.pageviews ?? -1) - (a.week?.pageviews ?? -1) ||
          a.site.name.localeCompare(b.site.name),
      );
    }
    return list;
  }, [sites, search, dayQuery.data, weekQuery.data]);

  const activeCount = rows.filter((row) => row.state === 'active').length;
  const activityLoaded = Boolean(dayQuery.data && weekQuery.data);

  function openCreate() {
    setCreating(true);
  }

  function onRowClick(event: MouseEvent<HTMLTableRowElement>, id: string) {
    if ((event.target as HTMLElement).closest('a, button')) return;
    navigate(`/websites/${id}`);
  }

  const addButton = isDemo ? null : (
    <Button
      variant="primary"
      onClick={openCreate}
      disabled={atWebsiteLimit}
      title={atWebsiteLimit ? t('websitesRequiresUpgrade') : undefined}
    >
      <Plus aria-hidden />
      {t('addWebsite')}
    </Button>
  );

  return (
    <Page className="ws-page-websites">
      <PageHeader title={t('websites')} lead={t('websitesSubtitle')} actions={hasSites ? addButton : null} />

      <PageBody className="stack">
        {atWebsiteLimit && !isDemo ? <PlanUpgradeBanner message={t('websitesRequiresUpgrade')} /> : null}

        <DataViewState
          loading={websitesQuery.isLoading}
          error={websitesQuery.isError ? websitesQuery.error : null}
          onRetry={() => websitesQuery.refetch()}
          loadingFallback={<WebsitesTableSkeleton />}
        >
          {!hasSites ? (
            <EmptyState
              variant="rich"
              icon={<Globe />}
              title={t('noWebsites')}
              description={t('workspaceNoWebsitesHint')}
            >
              <ol className="empty-state-steps">
                <li data-step="1">{t('emptyStep1')}</li>
                <li data-step="2">{t('emptyStep2')}</li>
                <li data-step="3">{t('emptyStep3')}</li>
              </ol>
              {addButton ? <div className="empty-state-actions">{addButton}</div> : null}
            </EmptyState>
          ) : (
            <SectionCard
              flush
              title={t('allWebsites')}
              description={
                activityLoaded
                  ? t('workspaceWebsitesActiveSummary')
                      .replace('{active}', formatNumber(activeCount))
                      .replace('{total}', formatNumber(sites.length))
                  : t('workspaceWebsitesCount').replace('{count}', formatNumber(sites.length))
              }
              actions={
                sites.length > 5 ? (
                  <ResourceSearchField
                    value={search}
                    onChange={setSearch}
                    placeholder={t('workspaceSearchWebsites')}
                    aria-label={t('workspaceSearchWebsites')}
                    className="ws-card-search"
                  />
                ) : undefined
              }
            >
              <div className="table-scroll">
                <table className="data-table data-table--interactive ws-websites-table">
                  <thead>
                    <tr>
                      <th>{t('website')}</th>
                      <th>{t('status')}</th>
                      <th className="num">{t('workspaceVisitors24h')}</th>
                      <th className="num">{t('workspacePageviews7d')}</th>
                      <th>{t('created')}</th>
                      <th>
                        <span className="visually-hidden">{t('actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ site, day, week, state }) => (
                      <tr key={site.id} onClick={(event) => onRowClick(event, site.id)}>
                        <td>
                          <Link to={`/websites/${site.id}`} className="ws-cell-link">
                            <SiteIdentity name={site.name} domain={site.domain} />
                          </Link>
                        </td>
                        <td>
                          {state === 'unknown' ? (
                            activityLoaded ? (
                              <span className="text-muted">–</span>
                            ) : (
                              <Skeleton className="h-5 w-24" />
                            )
                          ) : (
                            <StatusBadge tone={TRACKING_BADGE[state].tone}>{t(TRACKING_BADGE[state].key)}</StatusBadge>
                          )}
                        </td>
                        <td className="num">{day ? formatNumber(day.visitors) : day === null ? '0' : '–'}</td>
                        <td className="num">
                          <span className="ws-trend-cell">
                            {week ? (
                              <Sparkline
                                values={week.series.map((point) => point.y)}
                                color={colors.series.pageviews}
                                width={88}
                                height={26}
                              />
                            ) : null}
                            <span>{week ? formatNumber(week.pageviews) : week === null ? '0' : '–'}</span>
                          </span>
                        </td>
                        <td className="text-muted ws-nowrap" title={site.createdAt != null ? formatDateOnly(site.createdAt) : undefined}>
                          {site.createdAt != null ? formatShortDate(site.createdAt) : '–'}
                        </td>
                        <td className="ws-row-actions">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            render={<Link to={`/websites/${site.id}/realtime`} />}
                            aria-label={`${t('realtime')} · ${site.name}`}
                            title={t('realtime')}
                          >
                            <Activity aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            render={<Link to={`/websites/${site.id}/settings`} />}
                            aria-label={`${t('settings')} · ${site.name}`}
                            title={t('settings')}
                          >
                            <Settings aria-hidden />
                          </Button>
                          {isDemo ? null : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setEditingSite(site)}
                              aria-label={`${t('editWebsite')} · ${site.name}`}
                              title={t('editWebsite')}
                            >
                              <Pencil aria-hidden />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length ? (
                  <EmptyState title={t('workspaceNoMatches')} description={t('workspaceNoMatchesHint')} />
                ) : null}
              </div>
            </SectionCard>
          )}
        </DataViewState>
      </PageBody>

      <WebsiteFormDialog
        open={creating || editingSite != null}
        website={editingSite}
        onClose={() => {
          setCreating(false);
          setEditingSite(null);
        }}
        onCreated={(website) => navigate(`/websites/${website.id}/settings?setup=1`)}
      />
    </Page>
  );
}

function WebsitesTableSkeleton() {
  return (
    <SectionCard flush title={t('allWebsites')}>
      <div className="ws-table-skeleton" aria-hidden>
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="ws-table-skeleton-row">
            <Skeleton className="h-7 w-7" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ml-auto h-4 w-24" />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
