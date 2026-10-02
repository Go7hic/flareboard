import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ExternalLink, Link2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Area, AreaChart } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { BreakdownList, type BreakdownItem } from '../components/BreakdownList';
import { DataViewState } from '../components/DataViewState';
import { DateRangePicker } from '../components/DateRangePicker';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { KvList } from '../components/KvList';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatChangeDelta } from '../components/StatChangeDelta';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { CopyButton } from '../components/workspace/CopyButton';
import { changePercent, safeRatio } from '../components/workspace/workspace-format';
import { api, INGEST_URL, type LinkStats, type Team, type TrackingLink } from '../lib/api';
import { areaMark } from '../lib/chartMarks';
import { computeCompareRange } from '../lib/compare-utils';
import { type DateRangePreset, presetToRange, rangeQueryString } from '../lib/dateRange';
import { formatNumber, formatShortDate } from '../lib/format';
import { getLocale, t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import type { StoredRange } from '../lib/websiteRangeStorage';

const DAY_MS = 86_400_000;

/** Daily clicks for every UTC day of the range (the API leaves out days without clicks). */
function fillDays(series: Array<{ x: string; y: number }>, startAt: number, endAt: number) {
  const byDay = new Map(series.map((point) => [point.x.slice(0, 10), point.y]));
  const days: Array<{ day: string; date: Date; clicks: number }> = [];
  const first = new Date(startAt);
  first.setUTCHours(0, 0, 0, 0);
  for (let ms = first.getTime(); ms <= endAt && days.length < 400; ms += DAY_MS) {
    const date = new Date(ms);
    const day = date.toISOString().slice(0, 10);
    days.push({ day, date, clicks: byDay.get(day) ?? 0 });
  }
  return days;
}

function weekdayName(index: number) {
  // 2024-01-01 was a Monday; index 0 = Monday.
  return new Date(Date.UTC(2024, 0, 1 + index)).toLocaleDateString(getLocale(), { weekday: 'long', timeZone: 'UTC' });
}

export default function LinkAnalyticsPage() {
  const chartColors = useChartColors();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const linkId = params.get('linkId') ?? '';
  const [range, setRange] = useState<StoredRange>({
    preset: '30d' as DateRangePreset,
    ...presetToRange('30d'),
  });

  const linksQuery = useQuery({
    queryKey: ['links'],
    queryFn: () => api<TrackingLink[]>('/api/links'),
  });
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: () => api<Team[]>('/api/teams') });

  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data]);
  const link = links.find((l) => l.id === linkId);
  const rangeQs = rangeQueryString(range.startAt, range.endAt);
  const previous = useMemo(() => computeCompareRange(range.startAt, range.endAt, 'previous'), [range.startAt, range.endAt]);

  // Open the first link when none is chosen.
  useEffect(() => {
    if (!linkId && links.length) navigate(`/links/analytics?linkId=${encodeURIComponent(links[0]!.id)}`, { replace: true });
  }, [linkId, links, navigate]);

  function onLinkSelect(nextId: string) {
    navigate(nextId ? `/links/analytics?linkId=${encodeURIComponent(nextId)}` : '/links/analytics');
  }

  const statsQuery = useQuery({
    queryKey: ['link-stats', linkId, range.startAt, range.endAt],
    enabled: Boolean(linkId),
    queryFn: () => api<LinkStats>(`/api/links/${linkId}/stats?${rangeQs}`),
    placeholderData: keepPreviousData,
  });
  const previousQuery = useQuery({
    queryKey: ['link-stats', linkId, previous.compareStartAt, previous.compareEndAt],
    enabled: Boolean(linkId),
    queryFn: () =>
      api<LinkStats>(`/api/links/${linkId}/stats?${rangeQueryString(previous.compareStartAt, previous.compareEndAt)}`),
  });

  const stats = statsQuery.data;
  const prior = statsQuery.isPlaceholderData ? undefined : previousQuery.data;
  const days = useMemo(
    () => (stats ? fillDays(stats.series ?? [], range.startAt, range.endAt) : []),
    [stats, range.startAt, range.endAt],
  );
  const chartData = days.map((point) => ({ x: formatShortDate(point.date, { timeZone: 'UTC' }), clicks: point.clicks }));
  const busiest = days.reduce<(typeof days)[number] | null>((best, point) => (!best || point.clicks > best.clicks ? point : best), null);

  const weekdayItems: BreakdownItem[] = useMemo(() => {
    const totals = Array.from({ length: 7 }, () => 0);
    for (const point of days) totals[(point.date.getUTCDay() + 6) % 7] += point.clicks;
    const max = Math.max(...totals, 1);
    return totals.map((clicks, index) => ({
      id: String(index),
      label: weekdayName(index),
      share: clicks / max,
      values: [formatNumber(clicks)],
    }));
  }, [days]);

  const clicksPerVisitor = stats ? safeRatio(stats.clicks, stats.visitors) : undefined;
  const priorPerVisitor = prior ? safeRatio(prior.clicks, prior.visitors) : undefined;
  const delta = (current: number | undefined, before: number | undefined) => {
    if (current === undefined) return undefined;
    const change = changePercent(current, before);
    return change === undefined ? undefined : <StatChangeDelta change={change} />;
  };
  const shortUrl = link ? `${INGEST_URL}/l/${link.slug}` : '';
  const teamName = link?.teamId ? (teamsQuery.data ?? []).find((team) => team.id === link.teamId)?.name : undefined;

  return (
    <Page className="ws-page-link-analytics">
      <PageHeader
        title={link?.name ?? t('linkAnalytics')}
        lead={link ? t('workspaceLinkAnalyticsLead') : undefined}
        backTo="/links"
        backLabel={t('linksAndPixels')}
        actions={
          links.length ? (
            <div className="ws-header-controls">
              <select
                className="select ws-header-select"
                aria-label={t('selectLink')}
                value={linkId}
                onChange={(e) => onLinkSelect(e.target.value)}
                disabled={linksQuery.isLoading}
              >
                {link ? null : <option value="">{t('selectLinkPlaceholder')}</option>}
                {links.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              {linkId ? <DateRangePicker value={range} onChange={setRange} popover /> : null}
            </div>
          ) : null
        }
      />

      <PageBody className="stack">
        {!linksQuery.isLoading && !links.length ? (
          <EmptyState
            variant="rich"
            icon={<Link2 />}
            title={t('noLinksScope')}
            description={t('workspaceLinksEmpty')}
            action={
              <Button variant="primary" render={<Link to="/links" />}>
                {t('createLink')}
              </Button>
            }
          />
        ) : linkId && !linksQuery.isLoading && !link ? (
          <EmptyState variant="rich" icon={<Link2 />} title={t('linkNotFound')} />
        ) : link ? (
          <DataViewState
            loading={statsQuery.isLoading}
            error={statsQuery.isError ? statsQuery.error : null}
            onRetry={() => statsQuery.refetch()}
            loadingFallback={
              <div className="stack" aria-hidden>
                <KpiStripSkeleton cells={4} />
                <SectionCard title={t('linkClicksOverTime')}>
                  <Skeleton className="h-[260px] w-full" />
                </SectionCard>
              </div>
            }
          >
            {stats ? (
              <>
                <KpiStrip columns={4}>
                  <KpiCell label={t('linkClicks')} value={formatNumber(stats.clicks)} delta={delta(stats.clicks, prior?.clicks)} />
                  <KpiCell
                    label={t('linkUniqueVisitors')}
                    value={formatNumber(stats.visitors)}
                    delta={delta(stats.visitors, prior?.visitors)}
                  />
                  <KpiCell
                    label={t('workspaceClicksPerVisitor')}
                    value={clicksPerVisitor === undefined ? '–' : formatNumber(clicksPerVisitor, { maximumFractionDigits: 2 })}
                    delta={delta(clicksPerVisitor, priorPerVisitor)}
                  />
                  <KpiCell
                    label={t('workspaceBusiestDay')}
                    value={busiest && busiest.clicks > 0 ? formatShortDate(busiest.date, { timeZone: 'UTC' }) : '–'}
                    hint={
                      busiest && busiest.clicks > 0
                        ? t('workspaceClicksCount').replace('{count}', formatNumber(busiest.clicks))
                        : undefined
                    }
                  />
                </KpiStrip>

                <SectionCard title={t('linkClicksOverTime')}>
                  {stats.clicks > 0 ? (
                    <div className={statsQuery.isPlaceholderData ? 'ws-result-chart ws-refreshing' : 'ws-result-chart'}>
                      <AnalyticsChart
                        Chart={AreaChart}
                        data={chartData}
                        responsive={{ height: 260 }}
                        xAxis={{ dataKey: 'x', interval: 'preserveStartEnd', minTickGap: 28 }}
                      >
                        <Area
                          dataKey="clicks"
                          name={t('linkClicks')}
                          stroke={chartColors.accent}
                          fill={chartColors.accent}
                          {...areaMark(chartColors.panel)}
                        />
                      </AnalyticsChart>
                    </div>
                  ) : (
                    <EmptyState icon={<Link2 />} title={t('noLinkClicksInRange')} description={t('workspaceLinkClicksHint')} />
                  )}
                </SectionCard>

                <div className="layout-grid layout-grid--stretch">
                  <SectionCard className="span-6" title={t('workspaceClicksByWeekday')}>
                    {stats.clicks > 0 ? (
                      <BreakdownList items={weekdayItems} columns={[{ label: t('linkClicks') }]} labelHeader={t('workspaceWeekday')} />
                    ) : (
                      <p className="ws-muted-line">{t('noLinkClicksInRange')}</p>
                    )}
                  </SectionCard>
                  <SectionCard className="span-6" title={t('workspaceLinkDetails')}>
                    <KvList
                      items={[
                        {
                          key: 'short',
                          label: t('workspaceShortUrl'),
                          value: (
                            <span className="ws-copy-cell">
                              <code className="ws-mono-value">{shortUrl.replace(/^https?:\/\//, '')}</code>
                              <CopyButton text={shortUrl} iconOnly />
                            </span>
                          ),
                        },
                        {
                          key: 'destination',
                          label: t('workspaceLinkDestination'),
                          value: (
                            <a className="ws-external" href={link.url} target="_blank" rel="noreferrer">
                              <span>{link.url}</span>
                              <ExternalLink aria-hidden />
                            </a>
                          ),
                        },
                        { key: 'slug', label: t('trackedViaSlug'), value: <code className="ws-mono-value">{link.slug}</code> },
                        {
                          key: 'scope',
                          label: t('workspaceScope'),
                          value: teamName ?? (link.teamId ? t('teamBadge') : t('personalNoTeam')),
                        },
                      ]}
                    />
                  </SectionCard>
                </div>
              </>
            ) : null}
          </DataViewState>
        ) : null}
      </PageBody>
    </Page>
  );
}
