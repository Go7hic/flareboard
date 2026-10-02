import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, ReferenceLine } from 'recharts';
import { ChevronDown, ChevronUp, CreditCard, Download, ReceiptText } from 'lucide-react';
import { keepPreviousForWebsite } from '../components/audience/keepPrevious';
import { RelativeTime } from '../components/audience/ActivityLists';
import { Segmented } from '../components/audience/Segmented';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { BreakdownList, type BreakdownItem } from '../components/BreakdownList';
import { ChartLegend } from '../components/ChartLegend';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatChangeDelta } from '../components/StatChangeDelta';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import {
  api,
  type RevenueAttributionDimension,
  type RevenueAttributionResponse,
  type RevenueReportResponse,
  type RevenueMrrPoint,
  type RevenueSubscriptionsResponse,
} from '../lib/api';
import { areaMark, BAR_MARK, STACK_MARK } from '../lib/chartMarks';
import { computeCompareRange } from '../lib/compare-utils';
import { downloadCsv } from '../lib/downloadCsv';
import { formatNumber, formatPercent, formatShortDate, formatShortDateTime, shortId } from '../lib/format';
import { getLocale, t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { useWebsiteRange } from '../lib/useWebsiteRange';

/** Rows per transaction export (API: REVENUE_EXPORT_ROW_CAP). */
const TRANSACTION_EXPORT_CAP = 50_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Top paying sessions shown before "View all". */
const SESSION_ROWS = 10;

const DIMENSIONS: Array<{ id: RevenueAttributionDimension; label: () => string }> = [
  { id: 'utm_source', label: () => t('source') },
  { id: 'utm_medium', label: () => t('medium') },
  { id: 'utm_campaign', label: () => t('campaign') },
  { id: 'referrer_domain', label: () => t('revenueDimensionReferrer') },
];

/** MRR movement series, in stacking order (gains up, losses below the axis), palette slots 1–4. */
const MOVEMENT = [
  { key: 'newMrr', label: () => t('revenueNewMrr'), slot: 0 },
  { key: 'expansionMrr', label: () => t('revenueExpansionMrr'), slot: 1 },
  { key: 'contractionMrr', label: () => t('revenueContractionMrr'), slot: 2 },
  { key: 'churnedMrr', label: () => t('revenueChurnedMrr'), slot: 3 },
] as const;

/** GET /revenue/sessions: tracked purchase revenue per session, highest first (max 100). */
type RevenueSessionsResponse = {
  sessions: Array<{
    sessionId: string;
    eventName: string;
    currency: string;
    revenue: number;
    transactions: number;
    lastAt: number;
  }>;
};

function formatMoney(value: number | null | undefined, currency: string) {
  if (value == null || !Number.isFinite(value)) return '-';
  try {
    return new Intl.NumberFormat(getLocale(), { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    // Tracked events may carry a code Intl does not know.
    return `${formatNumber(value, { maximumFractionDigits: 2 })} ${currency}`;
  }
}

/** Headline amounts: cents only below 10,000 (US$154,710 rather than US$154,710.36). */
function formatMoneyHeadline(value: number, currency: string) {
  if (!Number.isFinite(value)) return '-';
  if (Math.abs(value) < 10_000) return formatMoney(value, currency);
  try {
    return new Intl.NumberFormat(getLocale(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${formatNumber(value, { maximumFractionDigits: 0 })} ${currency}`;
  }
}

/** Axis ticks: plain whole numbers, compact from 10k (the currency is named in the header). */
function formatAxisAmount(value: number) {
  return formatNumber(value, { compact: Math.abs(value) >= 10_000, maximumFractionDigits: Math.abs(value) >= 10_000 ? 1 : 0 });
}

function percentChange(current: number, previous: number | undefined) {
  if (previous === undefined || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

/** Every UTC day of the range (`YYYY-MM-DD`), so days without revenue show as gaps at zero. */
function utcDays(startAt: number, endAt: number): string[] {
  const days: string[] = [];
  const start = Date.UTC(new Date(startAt).getUTCFullYear(), new Date(startAt).getUTCMonth(), new Date(startAt).getUTCDate());
  for (let day = start; day <= endAt && days.length < 400; day += DAY_MS) {
    days.push(new Date(day).toISOString().slice(0, 10));
  }
  return days;
}

/** "2026-09" → "Sep" / "9月" (year only when not the current one). */
function formatMonth(period: string) {
  const date = new Date(`${period.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return period;
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString(getLocale(), {
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' as const }),
    timeZone: 'UTC',
  });
}

export default function RevenuePage() {
  const chartColors = useChartColors();
  const { websiteId } = useParams<{ websiteId: string }>();
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '30d');
  const [currency, setCurrency] = useState<string | null>(null);
  const [dimension, setDimension] = useState<RevenueAttributionDimension>('utm_source');
  const [exportError, setExportError] = useState<string | null>(null);
  const [allSessions, setAllSessions] = useState(false);
  const previous = computeCompareRange(range.startAt, range.endAt, 'previous');

  const revenueQuery = useQuery({
    queryKey: ['revenue-page', websiteId, range.startAt, range.endAt],
    enabled: Boolean(websiteId),
    placeholderData: keepPreviousForWebsite(websiteId),
    queryFn: () => api<RevenueReportResponse>(`/api/reports/revenue?websiteId=${websiteId}&${rangeQs}`),
  });

  const previousQuery = useQuery({
    queryKey: ['revenue-page', websiteId, previous.compareStartAt, previous.compareEndAt],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<RevenueReportResponse>(
        `/api/reports/revenue?websiteId=${websiteId}&startAt=${previous.compareStartAt}&endAt=${previous.compareEndAt}`,
      ),
  });

  const subscriptionsQuery = useQuery({
    queryKey: ['revenue-subscriptions', websiteId, range.endAt],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<RevenueSubscriptionsResponse>(`/api/websites/${websiteId}/revenue/subscriptions?endAt=${range.endAt}`),
  });

  const attributionQuery = useQuery({
    queryKey: ['revenue-attribution', websiteId, range.startAt, range.endAt, dimension],
    enabled: Boolean(websiteId),
    placeholderData: keepPreviousForWebsite(websiteId),
    queryFn: () =>
      api<RevenueAttributionResponse>(`/api/websites/${websiteId}/revenue/attribution?dimension=${dimension}&${rangeQs}`),
  });

  const sessionsQuery = useQuery({
    queryKey: ['revenue-sessions', websiteId, range.startAt, range.endAt],
    enabled: Boolean(websiteId),
    placeholderData: keepPreviousForWebsite(websiteId),
    queryFn: () => api<RevenueSessionsResponse>(`/api/websites/${websiteId}/revenue/sessions?${rangeQs}`),
  });

  // Every currency seen in transactions or subscriptions; amounts are never converted.
  const currencies = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of revenueQuery.data?.totals ?? []) seen.set(row.currency, Math.abs(row.total));
    for (const point of subscriptionsQuery.data?.latest ?? []) {
      seen.set(point.currency, Math.max(seen.get(point.currency) ?? 0, point.mrr));
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  }, [revenueQuery.data?.totals, subscriptionsQuery.data?.latest]);

  useEffect(() => {
    if (currencies.length && (!currency || !currencies.includes(currency))) setCurrency(currencies[0]!);
  }, [currencies, currency]);

  const active = currency ?? currencies[0] ?? 'USD';
  const totals = revenueQuery.data?.totals.find((row) => row.currency === active);
  const previousTotals = previousQuery.data?.totals.find((row) => row.currency === active);
  const revenueTotal = totals?.total ?? 0;
  const transactions = totals?.transactions ?? 0;
  const aov = transactions > 0 ? revenueTotal / transactions : 0;
  const previousRevenue = previousQuery.data ? (previousTotals?.total ?? 0) : undefined;
  const previousTransactions = previousQuery.data ? (previousTotals?.transactions ?? 0) : undefined;
  const previousAov =
    previousTotals && previousTotals.transactions > 0 ? previousTotals.total / previousTotals.transactions : undefined;

  const chartData = useMemo(() => {
    const byDate = new Map(
      (revenueQuery.data?.byDay ?? []).filter((row) => row.currency === active).map((row) => [row.date, row]),
    );
    return utcDays(range.startAt, range.endAt).map((date) => {
      const row = byDate.get(date);
      return {
        x: formatShortDate(`${date}T00:00:00Z`, { timeZone: 'UTC' }),
        total: Math.round((row?.total ?? 0) * 100) / 100,
      };
    });
  }, [revenueQuery.data?.byDay, active, range.startAt, range.endAt]);

  const byEvent = (revenueQuery.data?.byEvent ?? []).filter((row) => row.currency === active);
  const latest = subscriptionsQuery.data?.latest.find((point) => point.currency === active);
  const hasSubscriptions = (subscriptionsQuery.data?.currencies.length ?? 0) > 0;
  const mrrSeries = useMemo(
    () =>
      (subscriptionsQuery.data?.series ?? [])
        .filter((point) => point.currency === active)
        .map((point) => ({
          ...point,
          x: formatMonth(point.period),
          // Losses stack below the axis.
          contractionMrr: -point.contractionMrr,
          churnedMrr: -point.churnedMrr,
        })),
    [subscriptionsQuery.data?.series, active],
  );
  const attributionRows = (attributionQuery.data?.rows ?? []).filter((row) => row.currency === active);
  const paidSessions = (sessionsQuery.data?.sessions ?? []).filter((row) => row.currency === active);
  const visibleSessions = allSessions ? paidSessions : paidSessions.slice(0, SESSION_ROWS);

  const initialLoading = revenueQuery.isLoading && !revenueQuery.data;
  const isEmpty = !initialLoading && !(revenueQuery.data?.totals.length ?? 0);
  const money = (value: number) => formatMoney(value, active);

  const runExport = (path: string, filename: string) => {
    setExportError(null);
    downloadCsv(path, filename).catch((error: unknown) =>
      setExportError(error instanceof Error ? error.message : t('exportFailed')),
    );
  };

  // Subscription businesses see MRR right under the daily chart; otherwise the card (an empty
  // state pointing at Stripe) sits at the end of the page.
  const subscriptionsCard = (
    <SubscriptionsCard
      websiteId={websiteId}
      endAt={range.endAt}
      loading={subscriptionsQuery.isLoading}
      hasSubscriptions={hasSubscriptions}
      latest={latest}
      mrrSeries={mrrSeries}
      active={active}
      className={hasSubscriptions ? 'span-12' : undefined}
      onExport={runExport}
    />
  );

  const attributionLabel = (value: string | null) =>
    value ?? (dimension === 'referrer_domain' ? t('revenueAttributionDirect') : t('revenueAttributionNone'));

  const delta = (change: number | undefined) =>
    change === undefined || !Number.isFinite(change) ? undefined : <StatChangeDelta change={change} />;

  const eventMax = byEvent.reduce((max, row) => Math.max(max, row.total), 0) || 1;
  const eventItems: BreakdownItem[] = byEvent.map((row) => ({
    id: `${row.eventName}-${row.source}`,
    label: (
      <>
        <span className="mono truncate-1">{row.eventName}</span>
        <span className="audience-source-tag">
          {row.source === 'stripe' ? t('revenueSourceStripe') : t('revenueSourceEvent')}
        </span>
      </>
    ),
    title: row.eventName,
    share: Math.max(0, row.total) / eventMax,
    values: [money(row.total), formatNumber(row.transactions)],
  }));

  const attributionMax = attributionRows.reduce((max, row) => Math.max(max, row.total), 0) || 1;
  const attributionItems: BreakdownItem[] = attributionRows.map((row) => ({
    id: `${row.value ?? ''}-${row.currency}`,
    label: <span className={row.value ? 'truncate-1' : 'truncate-1 text-muted'}>{attributionLabel(row.value)}</span>,
    title: attributionLabel(row.value),
    share: Math.max(0, row.total) / attributionMax,
    values: [money(row.total), formatNumber(row.transactions), formatNumber(row.customers)],
  }));

  return (
    <Page className="page-revenue">
      <PageHeader
        title={t('revenue')}
        lead={t('revenuePageLead')}
        actions={
          <>
            {currencies.length > 1 ? (
              <label className="audience-currency" title={t('revenueCurrencyNote')}>
                <span className="visually-hidden">{t('revenueCurrency')}</span>
                <select
                  className="select audience-currency-select"
                  value={active}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />
            <Button
              type="button"
              variant="outline"
              title={t('revenueExportCapHint').replace('{count}', formatNumber(TRANSACTION_EXPORT_CAP))}
              onClick={() =>
                runExport(
                  `/api/websites/${websiteId}/revenue/export?table=transactions&${rangeQs}`,
                  `${websiteId}-revenue-transactions.csv`,
                )
              }
            >
              <Download data-icon="inline-start" aria-hidden />
              {t('revenueExportTransactions')}
            </Button>
          </>
        }
      />

      <PageBody className="stack">
        {exportError ? (
          <p className="text-danger audience-alert" role="alert">
            {exportError}
          </p>
        ) : null}

        <DataViewState
          error={revenueQuery.isError && !revenueQuery.data ? revenueQuery.error : null}
          onRetry={() => revenueQuery.refetch()}
        >
          {initialLoading ? (
            <KpiStripSkeleton cells={3} />
          ) : (
            <KpiStrip columns={3}>
              <KpiCell
                label={t('revenueNet')}
                value={formatMoneyHeadline(revenueTotal, active)}
                title={money(revenueTotal)}
                delta={delta(percentChange(revenueTotal, previousRevenue))}
              />
              <KpiCell
                label={t('revenueTransactions')}
                value={formatNumber(transactions)}
                delta={delta(percentChange(transactions, previousTransactions))}
              />
              <KpiCell
                label={t('audienceAverageOrderValue')}
                value={transactions > 0 ? money(aov) : '-'}
                delta={transactions > 0 ? delta(percentChange(aov, previousAov)) : undefined}
              />
            </KpiStrip>
          )}
          {currencies.length > 1 ? <p className="audience-footnote">{t('revenueCurrencyNote')}</p> : null}

          {isEmpty ? (
            <EmptyState
              variant="rich"
              icon={<ReceiptText />}
              title={t('audienceRevenueEmptyTitle')}
              description={t('audienceRevenueEmptyBody')}
            />
          ) : (
            <div className="layout-grid layout-grid--stretch">
              <SectionCard className="span-12" title={t('revenueByDay')}>
                {initialLoading ? (
                  <Skeleton className="h-[260px] w-full" />
                ) : (
                  <div className="audience-chart">
                    <AnalyticsChart
                      Chart={BarChart}
                      data={chartData}
                      responsive={{ height: 260 }}
                      valueFormatter={formatAxisAmount}
                      xAxis={{ dataKey: 'x', interval: 'preserveStartEnd', minTickGap: 28 }}
                      tooltip={{ formatter: (value) => money(Number(value)) }}
                    >
                      <Bar dataKey="total" name={t('revenueNet')} fill={chartColors.accent} {...BAR_MARK} />
                    </AnalyticsChart>
                  </div>
                )}
              </SectionCard>

              {hasSubscriptions ? subscriptionsCard : null}

              <SectionCard className="span-6" title={t('audienceRevenueByEvent')}>
                {initialLoading ? (
                  <BreakdownSkeleton />
                ) : byEvent.length ? (
                  <BreakdownList
                    items={eventItems}
                    labelHeader={t('revenueEvent')}
                    columns={[{ label: t('revenueTotal') }, { label: t('revenueTransactions') }]}
                  />
                ) : (
                  <EmptyState title={t('noDataInPeriod')} description={t('audienceNoRevenueInCurrency')} />
                )}
              </SectionCard>

              <SectionCard
                className="span-6"
                title={t('revenueAttribution')}
                description={t('revenueAttributionLead')}
                actions={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('revenueExportAttribution')}
                    title={t('revenueExportAttribution')}
                    onClick={() =>
                      runExport(
                        `/api/websites/${websiteId}/revenue/export?table=attribution&dimension=${dimension}&${rangeQs}`,
                        `${websiteId}-revenue-attribution-${dimension}.csv`,
                      )
                    }
                  >
                    <Download aria-hidden />
                  </Button>
                }
              >
                <Segmented
                  className="audience-card-segmented"
                  aria-label={t('revenueAttribution')}
                  value={dimension}
                  onChange={setDimension}
                  options={DIMENSIONS.map((item) => ({ id: item.id, label: item.label() }))}
                />
                <DataViewState
                  error={attributionQuery.isError && !attributionQuery.data ? attributionQuery.error : null}
                  onRetry={() => attributionQuery.refetch()}
                >
                  {attributionQuery.isLoading && !attributionQuery.data ? (
                    <BreakdownSkeleton />
                  ) : attributionItems.length ? (
                    <BreakdownList
                      className={attributionQuery.isPlaceholderData ? 'audience-refreshing' : undefined}
                      items={attributionItems}
                      labelHeader={DIMENSIONS.find((item) => item.id === dimension)?.label()}
                      columns={[
                        { label: t('revenueTotal') },
                        { label: t('revenueTransactions') },
                        { label: t('revenueCustomers') },
                      ]}
                    />
                  ) : (
                    <EmptyState title={t('noDataInPeriod')} description={t('audienceNoRevenueInCurrency')} />
                  )}
                </DataViewState>
              </SectionCard>

              <SectionCard
                className="span-12"
                flush
                title={t('audienceTopPayingSessions')}
                description={t('audienceTopPayingSessionsLead')}
                footer={
                  paidSessions.length > SESSION_ROWS ? (
                    <button type="button" className="card-footer-link" onClick={() => setAllSessions((open) => !open)}>
                      {allSessions
                        ? t('audienceShowLess')
                        : t('audienceViewAllCount').replace('{count}', formatNumber(paidSessions.length))}
                      {allSessions ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
                    </button>
                  ) : undefined
                }
              >
                {sessionsQuery.isLoading && !sessionsQuery.data ? (
                  <div className="card-body">
                    <BreakdownSkeleton />
                  </div>
                ) : paidSessions.length ? (
                  <div className="table-scroll">
                    <table className="data-table audience-table audience-sessions-table">
                      <thead>
                        <tr>
                          <th>{t('session')}</th>
                          <th className="audience-hide-sm">{t('revenueEvent')}</th>
                          <th className="num audience-hide-sm">{t('revenueTransactions')}</th>
                          <th className="num">{t('revenueTotal')}</th>
                          <th className="num">{t('audienceLastPurchase')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleSessions.map((row) => (
                          <tr key={`${row.sessionId}-${row.currency}`}>
                            <td>
                              <Link
                                className="inline-link mono"
                                to={`/websites/${websiteId}/sessions/${row.sessionId}`}
                                title={row.sessionId}
                              >
                                {shortId(row.sessionId, 8)}
                              </Link>
                            </td>
                            <td className="mono audience-cell-muted audience-hide-sm">{row.eventName}</td>
                            <td className="num audience-hide-sm">{formatNumber(row.transactions)}</td>
                            <td className="num audience-cell-strong">{money(row.revenue)}</td>
                            <td className="num audience-cell-muted" title={formatShortDateTime(row.lastAt)}>
                              <RelativeTime value={row.lastAt} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title={t('audienceNoPayingSessions')} description={t('audienceNoPayingSessionsBody')} />
                )}
              </SectionCard>
            </div>
          )}
        </DataViewState>

        {hasSubscriptions && !isEmpty ? null : subscriptionsCard}
      </PageBody>
    </Page>
  );
}

/** Stripe subscriptions: MRR now, its trend, and what moved it (gains above the axis, losses below). */
function SubscriptionsCard({
  websiteId,
  endAt,
  loading,
  hasSubscriptions,
  latest,
  mrrSeries,
  active,
  className,
  onExport,
}: {
  websiteId: string | undefined;
  endAt: number;
  loading: boolean;
  hasSubscriptions: boolean;
  latest: RevenueMrrPoint | undefined;
  mrrSeries: Array<Omit<RevenueMrrPoint, 'contractionMrr' | 'churnedMrr'> & { x: string; contractionMrr: number; churnedMrr: number }>;
  active: string;
  className?: string;
  onExport: (path: string, filename: string) => void;
}) {
  const chartColors = useChartColors();
  const money = (value: number) => formatMoney(value, active);
  return (
    <SectionCard
      className={className}
      title={t('revenueSubscriptions')}
      description={t('revenueSubscriptionsLead')}
      actions={
        hasSubscriptions ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              onExport(`/api/websites/${websiteId}/revenue/export?table=mrr&endAt=${endAt}`, `${websiteId}-revenue-mrr.csv`)
            }
          >
            <Download data-icon="inline-start" aria-hidden />
            {t('revenueExportMrr')}
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        <Skeleton className="h-[200px] w-full" />
      ) : !hasSubscriptions || !mrrSeries.length ? (
        <EmptyState
          icon={<CreditCard />}
          title={t('revenueNoSubscriptions')}
          description={t('revenueNoSubscriptionsBody')}
          action={
            <Button type="button" variant="outline" size="sm" asChild>
              <Link to={`/websites/${websiteId}/warehouse`}>{t('audienceConnectStripe')}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="audience-card-kpis">
            <KpiStrip inline columns={4}>
              <KpiCell
                label={t('revenueMrr')}
                value={formatMoneyHeadline(latest?.mrr ?? 0, active)}
                title={money(latest?.mrr ?? 0)}
                hint={`${t('revenueArr')} ${formatMoneyHeadline(latest?.arr ?? 0, active)}`}
              />
              <KpiCell label={t('revenueActiveSubscribers')} value={formatNumber(latest?.subscribers ?? 0)} />
              <KpiCell
                label={t('revenueChurnRate')}
                value={latest?.churnRate == null ? '-' : formatPercent(latest.churnRate * 100, { digits: 1 })}
              />
              <KpiCell label={t('revenueArpu')} value={money(latest?.arpu ?? 0)} />
            </KpiStrip>
          </div>
          <div className="audience-mrr-grid">
            <div>
              <h3 className="audience-subchart-title">{t('revenueMrr')}</h3>
              <div className="audience-chart">
                <AnalyticsChart
                  Chart={AreaChart}
                  data={mrrSeries}
                  responsive={{ height: 220 }}
                  valueFormatter={formatAxisAmount}
                  xAxis={{ dataKey: 'x', interval: 'preserveStartEnd' }}
                  tooltip={{ formatter: (value) => money(Number(value)) }}
                >
                  <Area
                    dataKey="mrr"
                    name={t('revenueMrr')}
                    stroke={chartColors.accent}
                    fill={chartColors.accent}
                    {...areaMark(chartColors.panel)}
                  />
                </AnalyticsChart>
              </div>
            </div>
            <div>
              <div className="audience-subchart-head">
                <h3 className="audience-subchart-title">{t('revenueMrrMovement')}</h3>
                <ChartLegend
                  items={MOVEMENT.map((series) => ({
                    label: series.label(),
                    color: `var(--chart-${series.slot + 1})`,
                    shape: 'box' as const,
                  }))}
                />
              </div>
              <div className="audience-chart">
                <AnalyticsChart
                  Chart={BarChart}
                  stackOffset="sign"
                  data={mrrSeries}
                  responsive={{ height: 220 }}
                  valueFormatter={formatAxisAmount}
                  xAxis={{ dataKey: 'x', interval: 'preserveStartEnd' }}
                  tooltip={{ formatter: (value) => money(Number(value)) }}
                >
                  <ReferenceLine y={0} stroke={chartColors.border} />
                  {MOVEMENT.map((series) => (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      name={series.label()}
                      stackId="movement"
                      fill={chartColors.palette[series.slot] || chartColors.accent}
                      {...STACK_MARK}
                    />
                  ))}
                </AnalyticsChart>
              </div>
            </div>
          </div>
        </>
      )}
    </SectionCard>
  );
}

function BreakdownSkeleton() {
  return (
    <div className="audience-breakdown-skeleton" aria-hidden>
      {[0.9, 0.7, 0.55, 0.4].map((width, index) => (
        <Skeleton key={index} className="h-[34px]" style={{ width: `${width * 100}%` }} />
      ))}
    </div>
  );
}
