import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Bar, BarChart, Line, LineChart, ReferenceLine } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Panel } from '../components/ui/panel';
import { StatCard, StatCardSkeleton } from '../components/ui/stat-card';
import {
  api,
  type RevenueAttributionDimension,
  type RevenueAttributionResponse,
  type RevenueReportResponse,
  type RevenueSubscriptionsResponse,
} from '../lib/api';
import { chartSeriesColor } from '../lib/chart-colors';
import { downloadCsv } from '../lib/downloadCsv';
import { formatNumber, formatPercent } from '../lib/format';
import { getLocale, t } from '../lib/i18n';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { useChartColors } from '../lib/useChartColors';

/** Rows per transaction export (API: REVENUE_EXPORT_ROW_CAP). */
const TRANSACTION_EXPORT_CAP = 50_000;

const DIMENSIONS: Array<{ id: RevenueAttributionDimension; label: () => string }> = [
  { id: 'utm_source', label: () => t('revenueDimensionUtmSource') },
  { id: 'utm_medium', label: () => t('revenueDimensionUtmMedium') },
  { id: 'utm_campaign', label: () => t('revenueDimensionUtmCampaign') },
  { id: 'referrer_domain', label: () => t('revenueDimensionReferrer') },
];

/** MRR movement series, in stacking order. Colors come from the shared chart palette. */
const MOVEMENT = [
  { key: 'newMrr', label: () => t('revenueNewMrr'), color: 1 },
  { key: 'expansionMrr', label: () => t('revenueExpansionMrr'), color: 2 },
  { key: 'contractionMrr', label: () => t('revenueContractionMrr'), color: 3 },
  { key: 'churnedMrr', label: () => t('revenueChurnedMrr'), color: 4 },
] as const;

function formatMoney(value: number | null | undefined, currency: string) {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(getLocale(), { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    // Tracked events may carry a code Intl does not know.
    return `${formatNumber(value, { maximumFractionDigits: 2 })} ${currency}`;
  }
}

function LegendSwatch({ index, label }: { index: number; label: string }) {
  const color = chartSeriesColor(index);
  return (
    <span className="dashboard-aggregate-legend-item">
      <span
        className="dashboard-aggregate-legend-swatch"
        style={{ borderColor: color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
      />
      <span className="dashboard-aggregate-legend-label">{label}</span>
    </span>
  );
}

export default function RevenuePage() {
  const chartColors = useChartColors();
  const { websiteId } = useParams<{ websiteId: string }>();
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const [currency, setCurrency] = useState<string | null>(null);
  const [dimension, setDimension] = useState<RevenueAttributionDimension>('utm_source');
  const [exportError, setExportError] = useState<string | null>(null);

  const revenueQuery = useQuery({
    queryKey: ['revenue-page', websiteId, range.startAt, range.endAt],
    enabled: Boolean(websiteId),
    queryFn: () => api<RevenueReportResponse>(`/api/reports/revenue?websiteId=${websiteId}&${rangeQs}`),
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
    queryFn: () =>
      api<RevenueAttributionResponse>(`/api/websites/${websiteId}/revenue/attribution?dimension=${dimension}&${rangeQs}`),
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

  const chartData = useMemo(
    () =>
      (revenueQuery.data?.byDay ?? [])
        .filter((row) => row.currency === active)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((row) => ({ date: row.date, total: Math.round(row.total * 100) / 100 })),
    [revenueQuery.data?.byDay, active],
  );
  const byEvent = (revenueQuery.data?.byEvent ?? []).filter((row) => row.currency === active);

  const mrrSeries = useMemo(
    () =>
      (subscriptionsQuery.data?.series ?? [])
        .filter((point) => point.currency === active)
        .map((point) => ({
          ...point,
          // Losses stack below the axis.
          contractionMrr: -point.contractionMrr,
          churnedMrr: -point.churnedMrr,
        })),
    [subscriptionsQuery.data?.series, active],
  );
  const latest = subscriptionsQuery.data?.latest.find((point) => point.currency === active);
  const hasSubscriptions = (subscriptionsQuery.data?.currencies.length ?? 0) > 0;
  const attributionRows = (attributionQuery.data?.rows ?? []).filter((row) => row.currency === active);

  const isEmpty = !revenueQuery.isLoading && !(revenueQuery.data?.totals.length ?? 0);

  const runExport = (path: string, filename: string) => {
    setExportError(null);
    downloadCsv(path, filename).catch((error: unknown) =>
      setExportError(error instanceof Error ? error.message : t('exportFailed')),
    );
  };

  const attributionLabel = (value: string | null) =>
    value ?? (dimension === 'referrer_domain' ? t('revenueAttributionDirect') : t('revenueAttributionNone'));

  return (
    <Page>
      <PageHeader
        title={t('revenue')}
        lead={t('revenuePageLead')}
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                runExport(
                  `/api/websites/${websiteId}/revenue/export?table=transactions&${rangeQs}`,
                  `${websiteId}-revenue-transactions.csv`,
                )
              }
            >
              {t('revenueExportTransactions')}
            </Button>
            <WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />
          </>
        }
      />

      <PageBody>
        {exportError ? (
          <p className="text-danger section-gap" role="alert">
            {exportError}
          </p>
        ) : null}

        <div className="revenue-toolbar section-gap">
          {currencies.length > 1 ? (
            <label className="revenue-currency">
              <span className="text-muted">{t('revenueCurrency')}</span>
              <select className="select" value={active} onChange={(event) => setCurrency(event.target.value)}>
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="text-muted">
            {t('revenueCurrencyNote')} {t('revenueExportCapHint').replace('{count}', formatNumber(TRANSACTION_EXPORT_CAP))}
          </p>
        </div>

        <section className="analytics-hero-stats section-gap">
          {revenueQuery.isLoading ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : (
            <>
              <StatCard label={t('revenueNet')} value={formatMoney(totals?.total ?? 0, active)} variant="primary" />
              <StatCard label={t('revenueTransactions')} value={formatNumber(totals?.transactions ?? 0)} />
            </>
          )}
          {subscriptionsQuery.isLoading ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : hasSubscriptions ? (
            <>
              <StatCard label={t('revenueMrr')} value={formatMoney(latest?.mrr ?? 0, active)} hint={`${t('revenueArr')} ${formatMoney(latest?.arr ?? 0, active)}`} />
              <StatCard label={t('revenueActiveSubscribers')} value={formatNumber(latest?.subscribers ?? 0)} />
              <StatCard
                label={t('revenueChurnRate')}
                value={latest?.churnRate == null ? '—' : formatPercent(latest.churnRate * 100, { digits: 1 })}
              />
              <StatCard label={t('revenueArpu')} value={formatMoney(latest?.arpu ?? null, active)} />
            </>
          ) : null}
        </section>

        <Panel className="section-gap">
          <h2 className="section-title">{t('revenueByDay')}</h2>
          <DataViewState
            loading={revenueQuery.isLoading}
            error={revenueQuery.isError ? revenueQuery.error : null}
            onRetry={() => revenueQuery.refetch()}
            isEmpty={isEmpty}
            emptyTitle={t('noDataInPeriod')}
          >
            <>
              {chartData.length > 0 ? (
                <div className="chart-wrap chart-wrap-compact section-gap">
                  <AnalyticsChart Chart={BarChart} data={chartData} xAxis={{ dataKey: 'date' }}>
                    <Bar dataKey="total" name={t('revenueTotal')} fill={chartColors.palette[0]} radius={[4, 4, 0, 0]} />
                  </AnalyticsChart>
                </div>
              ) : null}

              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('revenueEvent')}</th>
                      <th>{t('revenueSource')}</th>
                      <th className="num">{t('revenueTotal')}</th>
                      <th className="num">{t('revenueTransactions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byEvent.map((row) => (
                      <tr key={`${row.eventName}-${row.source}`}>
                        <td className="mono">{row.eventName}</td>
                        <td>{row.source === 'stripe' ? t('revenueSourceStripe') : t('revenueSourceEvent')}</td>
                        <td className="num">{formatMoney(row.total, active)}</td>
                        <td className="num">{formatNumber(row.transactions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          </DataViewState>
        </Panel>

        <Panel className="section-gap">
          <header className="panel-header">
            <div>
              <h2 className="section-title">{t('revenueSubscriptions')}</h2>
              <p className="text-muted">{t('revenueSubscriptionsLead')}</p>
            </div>
            {hasSubscriptions ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  runExport(`/api/websites/${websiteId}/revenue/export?table=mrr&endAt=${range.endAt}`, `${websiteId}-revenue-mrr.csv`)
                }
              >
                {t('revenueExportMrr')}
              </Button>
            ) : null}
          </header>
          {subscriptionsQuery.isLoading ? (
            <div className="skeleton skeleton-block" aria-busy />
          ) : !hasSubscriptions || !mrrSeries.length ? (
            <EmptyState title={t('revenueNoSubscriptions')} description={t('revenueNoSubscriptionsBody')} />
          ) : (
            <div className="revenue-mrr-grid">
              <div>
                <h3 className="section-title">{t('revenueMrr')}</h3>
                <div className="chart-wrap chart-wrap-compact">
                  <AnalyticsChart Chart={LineChart} data={mrrSeries} xAxis={{ dataKey: 'period' }}>
                    <Line type="monotone" dataKey="mrr" name={t('revenueMrr')} stroke={chartColors.palette[0]} strokeWidth={2} dot={false} />
                  </AnalyticsChart>
                </div>
              </div>
              <div>
                <h3 className="section-title">{t('revenueMrrMovement')}</h3>
                <div className="chart-wrap chart-wrap-compact">
                  <AnalyticsChart Chart={BarChart} data={mrrSeries} xAxis={{ dataKey: 'period' }} yAxis={{ allowDecimals: true }}>
                    <ReferenceLine y={0} stroke={chartColors.border} />
                    {MOVEMENT.map((series) => (
                      <Bar
                        key={series.key}
                        dataKey={series.key}
                        name={series.label()}
                        stackId="movement"
                        fill={chartColors.palette[series.color] || chartSeriesColor(series.color)}
                      />
                    ))}
                  </AnalyticsChart>
                </div>
                <div className="dashboard-aggregate-legend analytics-chart-legend" aria-hidden>
                  {MOVEMENT.map((series) => (
                    <LegendSwatch key={series.key} index={series.color} label={series.label()} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel className="section-gap">
          <header className="panel-header">
            <div>
              <h2 className="section-title">{t('revenueAttribution')}</h2>
              <p className="text-muted">{t('revenueAttributionLead')}</p>
            </div>
            <div className="revenue-attribution-actions">
              <select
                className="select"
                aria-label={t('revenueAttribution')}
                value={dimension}
                onChange={(event) => setDimension(event.target.value as RevenueAttributionDimension)}
              >
                {DIMENSIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label()}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  runExport(
                    `/api/websites/${websiteId}/revenue/export?table=attribution&dimension=${dimension}&${rangeQs}`,
                    `${websiteId}-revenue-attribution-${dimension}.csv`,
                  )
                }
              >
                {t('revenueExportAttribution')}
              </Button>
            </div>
          </header>
          <DataViewState
            loading={attributionQuery.isLoading}
            error={attributionQuery.isError ? attributionQuery.error : null}
            onRetry={() => attributionQuery.refetch()}
            isEmpty={!attributionQuery.isLoading && attributionRows.length === 0}
            emptyTitle={t('noDataInPeriod')}
          >
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{DIMENSIONS.find((item) => item.id === dimension)!.label()}</th>
                    <th className="num">{t('revenueTotal')}</th>
                    <th className="num">{t('revenueTransactions')}</th>
                    <th className="num">{t('revenueCustomers')}</th>
                  </tr>
                </thead>
                <tbody>
                  {attributionRows.map((row) => (
                    <tr key={`${row.value ?? ''}-${row.currency}`}>
                      <td className={row.value ? undefined : 'text-muted'}>{attributionLabel(row.value)}</td>
                      <td className="num">{formatMoney(row.total, active)}</td>
                      <td className="num">{formatNumber(row.transactions)}</td>
                      <td className="num">{formatNumber(row.customers)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataViewState>
        </Panel>
      </PageBody>
    </Page>
  );
}
