import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { api, getToken } from '../lib/api';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';

const OVERVIEW_DAYS = 7;

interface SeriesPoint {
  x: string;
  y: number;
}

interface DashboardSite {
  id: string;
  name: string;
  domain?: string;
  pageviews: number;
  visitors: number;
  visits?: number;
  series: SeriesPoint[];
}

function formatChartLabel(x: string) {
  const parts = x.split('-');
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  return x;
}

export default function DashboardHome() {
  const navigate = useNavigate();
  const chartColors = useChartColors();

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

  const overviewQuery = useQuery({
    queryKey: ['dashboard-overview', OVERVIEW_DAYS],
    queryFn: () =>
      api<{ websites: DashboardSite[] }>(`/api/dashboard?days=${OVERVIEW_DAYS}`),
  });

  const sites = overviewQuery.data?.websites ?? [];

  return (
    <div className="page page-dashboard">
      <PageHeader title={t('dashboard')} subtitle={t('dashboardSubtitle7d')} />

      {overviewQuery.isLoading ? (
        <div className="dashboard-site-list section-gap">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="panel dashboard-site-card" aria-hidden>
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="dashboard-site-card-chart mt-3 h-24 w-full" />
            </div>
          ))}
        </div>
      ) : null}

      {sites.length > 0 ? (
        <div className="dashboard-site-list section-gap">
          {sites.map((w) => {
            const chartData = w.series.map((p) => ({
              x: formatChartLabel(p.x),
              y: p.y,
            }));
            return (
              <Link key={w.id} to={`/websites/${w.id}`} className="panel dashboard-site-card">
                <span className="site-card-arrow" aria-hidden>
                  →
                </span>
                <div className="dashboard-site-card-head">
                  <div className="dashboard-site-card-identity">
                    <span className="site-card-name">{w.name}</span>
                    {w.domain ? <span className="site-card-domain">{w.domain}</span> : null}
                  </div>
                  <div className="dashboard-site-row-kpis">
                    <div className="dashboard-site-kpi dashboard-site-kpi-primary">
                      <span className="dashboard-site-kpi-label">{t('pageviews')}</span>
                      <span className="dashboard-site-kpi-value is-primary">
                        {w.pageviews.toLocaleString()}
                      </span>
                    </div>
                    <div className="dashboard-site-kpi">
                      <span className="dashboard-site-kpi-label">{t('visitors')}</span>
                      <span className="dashboard-site-kpi-value">{w.visitors.toLocaleString()}</span>
                    </div>
                    {w.visits != null ? (
                      <div className="dashboard-site-kpi">
                        <span className="dashboard-site-kpi-label">{t('visits')}</span>
                        <span className="dashboard-site-kpi-value">{w.visits.toLocaleString()}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="dashboard-site-card-chart" aria-hidden={chartData.length === 0}>
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={chartColors.border}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="x"
                          tick={{ fontSize: 10, fill: chartColors.muted }}
                          stroke={chartColors.border}
                          interval="preserveStartEnd"
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis hide allowDecimals={false} />
                        <Tooltip
                          contentStyle={{
                            background: chartColors.panel,
                            border: `1px solid ${chartColors.border}`,
                            borderRadius: 8,
                            fontSize: 12,
                            color: chartColors.text,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="y"
                          name={t('pageviews')}
                          stroke={chartColors.accent}
                          strokeWidth={2}
                          fill={chartColors.accent}
                          fillOpacity={0.12}
                          dot={false}
                          activeDot={{ r: 3 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-muted dashboard-site-card-empty">{t('noDataInPeriod')}</p>
                  )}
                </div>
                <div className="dashboard-site-card-foot">
                  <span className="dashboard-site-card-hint">{t('dashboardViewSite')}</span>
                  <span className="dashboard-site-card-compare">{t('dashboardCompareHint')}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : null}

      {!overviewQuery.isLoading && !sites.length ? (
        <div className="panel empty-state-rich section-gap">
          <h3>{t('noWebsitesDashboard')}</h3>
          <p className="text-muted">{t('noWebsitesHint')}</p>
          <ol className="empty-state-steps">
            <li data-step="1">{t('emptyStep1')}</li>
            <li data-step="2">{t('emptyStep2')}</li>
            <li data-step="3">{t('emptyStep3')}</li>
          </ol>
          <Button asChild variant="primary" className="empty-state-cta">
            <Link to="/websites">{t('addWebsiteCta')}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
