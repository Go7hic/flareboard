import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BrandLogo } from '../components/BrandLogo';
import { DataViewState } from '../components/DataViewState';
import { DateRangePicker } from '../components/DateRangePicker';
import { LanguageSelector } from '../components/LanguageSelector';
import { KpiStripSkeleton } from '../components/KpiStrip';
import { OverviewDimensions } from '../components/OverviewDimensions';
import { OverviewKpiStrip } from '../components/OverviewKpiStrip';
import { OverviewTrendCard } from '../components/OverviewTrendCard';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { ThemeToggle } from '../components/ThemeToggle';
import { WebsiteNameLabel } from '../components/WebsiteNameLabel';
import { Button } from '../components/ui/button';
import { api, bootstrapSession, logoutSession, startDemoSession, type WebsiteStats } from '../lib/api';
import {
  isHourlyChartRange,
  mergePageviewsVisitors,
  type MetricsSeries,
} from '../lib/chartTimeseries';
import { presetToRange, rangeQueryString, type DateRangePreset } from '../lib/dateRange';
import { preloadConsole } from '../lib/consoleChunks';
import { t } from '../lib/i18n';
import { trackProductEvent } from '../lib/tracking';
import { useChartColors } from '../lib/useChartColors';
import { fetchMe } from '../lib/useDemoSession';
import '../styles/console-pages';

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

/**
 * Public overview of the sample website: the fallback when a demo session cannot be started
 * (demo unavailable, rate limited, offline API).
 */
function DemoOverview() {
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
  const onCreateAccount = (place: string) => () => trackProductEvent('demo_create_account', { place });

  const overviewLoadingFallback = (
    <>
      <KpiStripSkeleton cells={5} />
      <OverviewTrendCard data={[]} loading />
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
              <Link to={registerHref} onClick={onCreateAccount('nav')}>{t('demoBannerCta')}</Link>
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
            <Link to={registerHref} onClick={onCreateAccount('banner')}>{t('demoBannerCta')}</Link>
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
                <Link to={registerHref} onClick={onCreateAccount('not_ready')}>{t('landingCreateFreeAccount')}</Link>
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

          <PageBody className="stack">
            <DataViewState
              loading={!overviewQuery.data && (metaQuery.isPending || overviewQuery.isPending)}
              error={overviewQuery.isError ? overviewQuery.error : null}
              onRetry={() => overviewQuery.refetch()}
              loadingFallback={overviewLoadingFallback}
            >
              <section aria-labelledby="demo-overview">
                <h2 id="demo-overview" className="visually-hidden">
                  {t('trafficOverTime')}
                </h2>
                {stats ? (
                  <OverviewKpiStrip
                    stats={stats}
                    compareLabel=""
                    pageviewsColor={metricColors.pageviews}
                    visitorsColor={metricColors.visitors}
                  />
                ) : (
                  <KpiStripSkeleton cells={5} />
                )}
              </section>

              <OverviewTrendCard data={chartData} hourly={hourly} />
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

type LauncherState = { kind: 'starting' } | { kind: 'signed-in' } | { kind: 'fallback' };

/**
 * `/demo`: opens the real dashboard, read-only, signed in as the shared demo account. A real
 * account is asked first (the demo replaces its session); if no demo session can be started,
 * the public sample overview is shown instead.
 */
export default function DemoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, setState] = useState<LauncherState>({ kind: 'starting' });
  const started = useRef(false);

  async function openDemo() {
    setState({ kind: 'starting' });
    try {
      const { websiteId } = await startDemoSession();
      // Nothing from a previous account may show inside the demo.
      queryClient.clear();
      navigate(`/websites/${websiteId}`, { replace: true });
    } catch {
      setState({ kind: 'fallback' });
    }
  }

  async function leaveAccountForDemo() {
    await logoutSession();
    queryClient.clear();
    await openDemo();
  }

  useEffect(() => {
    // Once per visit (StrictMode runs effects twice in development).
    if (started.current) return;
    started.current = true;
    // The demo opens in the console: fetch it alongside the session requests.
    preloadConsole();
    void (async () => {
      if (await bootstrapSession()) {
        const me = await fetchMe().catch(() => null);
        if (me && !me.isDemo) {
          setState({ kind: 'signed-in' });
          return;
        }
      }
      await openDemo();
    })();
  }, []);

  if (state.kind === 'fallback') return <DemoOverview />;
  if (state.kind === 'starting') {
    return (
      <main className="demo-launcher" aria-busy="true">
        <p className="demo-launcher-body">{t('demoLauncherOpening')}</p>
      </main>
    );
  }

  return (
    <main className="demo-launcher">
      <section className="demo-launcher-panel" aria-labelledby="demo-launcher-title">
        <h1 id="demo-launcher-title" className="demo-launcher-title">
          {t('demoLauncherSignedInTitle')}
        </h1>
        <p className="demo-launcher-body">{t('demoLauncherSignedInBody')}</p>
        <div className="demo-launcher-actions">
          <Button type="button" variant="primary" onClick={() => void leaveAccountForDemo()}>
            {t('demoLauncherOpenDemo')}
          </Button>
          <Button asChild variant="outline">
            <Link to="/dashboard">{t('demoLauncherBackToDashboard')}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
