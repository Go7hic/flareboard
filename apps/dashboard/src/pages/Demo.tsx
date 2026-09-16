import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Line, LineChart } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { BrandLogo } from '../components/BrandLogo';
import { DataViewState } from '../components/DataViewState';
import { DateRangePicker } from '../components/DateRangePicker';
import { EmptyState } from '../components/EmptyState';
import { LanguageSelector } from '../components/LanguageSelector';
import { OverviewDimensions } from '../components/OverviewDimensions';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { ThemeToggle } from '../components/ThemeToggle';
import { WebsiteNameLabel } from '../components/WebsiteNameLabel';
import { Button } from '../components/ui/button';
import { StatCard, StatCardSkeleton } from '../components/ui/stat-card';
import { api, type WebsiteStats } from '../lib/api';
import {
  isHourlyChartRange,
  mergePageviewsVisitors,
  type MetricsSeries,
} from '../lib/chartTimeseries';
import { presetToRange, rangeQueryString, type DateRangePreset } from '../lib/dateRange';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';

type DemoWebsite = {
  name: string;
  domain?: string | null;
  timezone: string;
  sample: boolean;
};

type DemoOverview = {
  website: DemoWebsite;
  stats: WebsiteStats;
  timeseries: MetricsSeries;
};

type AppConfig = {
  registrationEnabled?: boolean;
};

function OverviewKpi({
  label,
  stat,
}: {
  label: string;
  stat?: { value: number; change?: number };
}) {
  if (!stat) return null;
  return <StatCard label={label} value={formatNumber(stat.value)} />;
}

export default function DemoPage() {
  const chartColors = useChartColors();
  const [startHref, setStartHref] = useState('/register');
  const [preset, setPreset] = useState<DateRangePreset>('30d');
  const [customRange, setCustomRange] = useState<{ startAt: number; endAt: number } | null>(null);

  const metaQuery = useQuery({
    queryKey: ['public-demo-meta'],
    queryFn: () => api<{ website: DemoWebsite }>('/api/demo'),
    retry: false,
  });

  const timezone = metaQuery.data?.website.timezone ?? 'UTC';
  const range = useMemo(() => {
    if (preset === 'custom' && customRange) return { preset, ...customRange };
    const { startAt, endAt } = presetToRange(preset, undefined, undefined, timezone);
    return { preset, startAt, endAt };
  }, [preset, customRange, timezone]);
  const rangeQs = rangeQueryString(range.startAt, range.endAt);

  useEffect(() => {
    api<AppConfig>('/api/config')
      .then((cfg) => setStartHref(cfg.registrationEnabled ? '/register' : '/login'))
      .catch(() => {});
  }, []);

  const overviewQuery = useQuery({
    queryKey: ['public-demo-overview', range.startAt, range.endAt],
    enabled: metaQuery.isSuccess,
    queryFn: () => api<DemoOverview>(`/api/demo/overview?${rangeQs}`),
  });

  const hourly = isHourlyChartRange(range.startAt, range.endAt);
  const stats = overviewQuery.data?.stats;
  const chartData = useMemo(
    () => mergePageviewsVisitors(overviewQuery.data?.timeseries, hourly, timezone),
    [overviewQuery.data?.timeseries, hourly, timezone],
  );
  const metricColors = useMemo(
    () => ({
      pageviews: chartColors.series.pageviews,
      visitors: chartColors.series.visitors,
    }),
    [chartColors],
  );

  const website = metaQuery.data?.website;
  const registerHref = `${startHref}?from=demo`;

  const overviewLoadingFallback = (
    <>
      <section className="page-stats-kpis section-gap" aria-hidden>
        <div className="analytics-hero-stats">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      </section>
      <section className="panel page-stats-chart section-gap" aria-hidden>
        <div className="chart-wrap chart-wrap-hero chart-skeleton" aria-busy>
          <div className="skeleton skeleton-block" />
        </div>
      </section>
    </>
  );

  return (
    <div className="demo-shell">
      <header className="landing-nav">
        <div className="landing-nav-inner demo-nav-inner">
          <Link to="/" className="shell-brand landing-brand">
            <BrandLogo />
          </Link>
          <span className="badge demo-nav-badge">{t('demoSampleBadge')}</span>
          <div className="landing-nav-actions shell-nav-end">
            <LanguageSelector />
            <ThemeToggle />
            <Button asChild variant="primary" size="sm">
              <Link to={registerHref}>{t('demoBannerCta')}</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="demo-banner">
        <div className="demo-banner-inner">
          <div className="demo-banner-copy">
            <p className="demo-banner-title">{t('demoBannerTitle')}</p>
            <p className="demo-banner-body">{t('demoBannerBody')}</p>
          </div>
          <Button asChild variant="primary" size="sm">
            <Link to={registerHref}>{t('demoBannerCta')}</Link>
          </Button>
        </div>
      </div>

      {metaQuery.isError ? (
        <Page>
          <div className="panel empty-state-rich">
            <h1 className="page-title">{t('demoNotReadyTitle')}</h1>
            <p className="page-subtitle">{t('demoNotReadyBody')}</p>
            <div className="demo-not-ready-actions">
              <Button asChild variant="primary">
                <Link to={registerHref}>{t('landingCreateFreeAccount')}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/">{t('demoBackHome')}</Link>
              </Button>
            </div>
          </div>
        </Page>
      ) : (
        <Page className="page-stats">
          <PageHeader
            title={
              website ? (
                <WebsiteNameLabel name={website.name} domain={website.domain} faviconSize={22} />
              ) : (
                t('navOverview')
              )
            }
            lead={t('demoPageLead')}
            actions={
              <DateRangePicker
                compact
                popover
                timezone={timezone}
                value={range}
                onChange={(next) => {
                  setPreset(next.preset);
                  if (next.preset === 'custom') {
                    setCustomRange({ startAt: next.startAt, endAt: next.endAt });
                  } else {
                    setCustomRange(null);
                  }
                }}
              />
            }
          />

          <PageBody>
            <DataViewState
              loading={!overviewQuery.data && (metaQuery.isPending || overviewQuery.isPending)}
              error={overviewQuery.isError ? overviewQuery.error : null}
              onRetry={() => overviewQuery.refetch()}
              loadingFallback={overviewLoadingFallback}
            >
              <section className="page-stats-kpis section-gap" aria-labelledby="demo-overview">
                <h2 id="demo-overview" className="visually-hidden">
                  {t('trafficOverTime')}
                </h2>
                <div className="analytics-hero-stats">
                  {stats ? (
                    <>
                      <OverviewKpi label={t('pageviews')} stat={stats.pageviews} />
                      <OverviewKpi label={t('visitors')} stat={stats.visitors} />
                      <OverviewKpi label={t('visits')} stat={stats.visits} />
                      <OverviewKpi label={t('bounces')} stat={stats.bounces} />
                      <OverviewKpi label={t('totalTime')} stat={stats.totaltime} />
                    </>
                  ) : (
                    <>
                      <StatCardSkeleton />
                      <StatCardSkeleton />
                      <StatCardSkeleton />
                      <StatCardSkeleton />
                      <StatCardSkeleton />
                    </>
                  )}
                </div>
              </section>

              <section className="panel page-stats-chart section-gap" aria-labelledby="demo-chart-title">
                <h2 id="demo-chart-title" className="section-title">
                  {t('trafficOverTime')}
                </h2>
                {chartData.length > 0 ? (
                  <>
                    <div className="chart-wrap chart-wrap-hero">
                      <AnalyticsChart
                        Chart={LineChart}
                        data={chartData}
                        xAxis={{
                          dataKey: 'x',
                          interval: hourly ? 'preserveStartEnd' : undefined,
                          minTickGap: hourly ? 24 : 8,
                        }}
                      >
                        <Line
                          type="monotone"
                          dataKey="pageviews"
                          name={t('pageviews')}
                          stroke={metricColors.pageviews}
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="visitors"
                          name={t('visitors')}
                          stroke={metricColors.visitors}
                          strokeWidth={2}
                          dot={false}
                        />
                      </AnalyticsChart>
                    </div>
                    <div className="dashboard-aggregate-legend analytics-chart-legend" aria-hidden>
                      <span className="dashboard-aggregate-legend-item">
                        <span className="dashboard-aggregate-legend-swatch dashboard-aggregate-legend-swatch--pageviews" />
                        <span className="dashboard-aggregate-legend-label">{t('pageviews')}</span>
                      </span>
                      <span className="dashboard-aggregate-legend-item">
                        <span className="dashboard-aggregate-legend-swatch dashboard-aggregate-legend-swatch--visitors" />
                        <span className="dashboard-aggregate-legend-label">{t('visitors')}</span>
                      </span>
                    </div>
                  </>
                ) : (
                  <EmptyState title={t('chartNoData')} description={t('noDataInPeriodHint')} />
                )}
              </section>
            </DataViewState>

            {metaQuery.isSuccess ? (
              <OverviewDimensions
                websiteId="demo"
                qs={rangeQs}
                rangeQs={rangeQs}
                metricsPathPrefix="/api/demo"
                hideExplorer
              />
            ) : null}
          </PageBody>
        </Page>
      )}
    </div>
  );
}
