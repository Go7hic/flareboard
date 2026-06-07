import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DateRangePicker } from '../components/DateRangePicker';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { api, getToken, type LinkStats, type TrackingLink } from '../lib/api';
import { type DateRangePreset, presetToRange, rangeQueryString } from '../lib/dateRange';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export default function LinkAnalyticsPage() {
  const chartColors = useChartColors();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const linkId = params.get('linkId') ?? '';
  const [range, setRange] = useState({
    preset: '30d' as DateRangePreset,
    ...presetToRange('30d'),
  });

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

  const linksQuery = useQuery({
    queryKey: ['links'],
    queryFn: () => api<TrackingLink[]>('/api/links'),
  });

  const links = linksQuery.data ?? [];
  const link = links.find((l) => l.id === linkId);
  const rangeQs = rangeQueryString(range.startAt, range.endAt);

  function onLinkSelect(nextId: string) {
    if (!nextId) {
      navigate('/links/analytics');
      return;
    }
    navigate(`/links/analytics?linkId=${encodeURIComponent(nextId)}`);
  }

  const statsQuery = useQuery({
    queryKey: ['link-stats', linkId, range.startAt, range.endAt],
    enabled: Boolean(linkId),
    queryFn: () => api<LinkStats>(`/api/links/${linkId}/stats?${rangeQs}`),
  });

  const stats = statsQuery.data;
  const chartData = stats?.series ?? [];

  return (
    <div className="page page-link-analytics">
      <PageHeader
        title={t('linkAnalytics')}
        subtitle={link ? link.url : undefined}
        backTo="/links"
        backLabel={t('links')}
        toolbar={
          <div className="stats-toolbar">
            <div className="field links-toolbar-field">
              <Label htmlFor="link-picker">{t('selectLink')}</Label>
              <select
                id="link-picker"
                className="select"
                value={linkId}
                onChange={(e) => onLinkSelect(e.target.value)}
                disabled={linksQuery.isLoading}
              >
                <option value="">{t('selectLinkPlaceholder')}</option>
                {links.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            {linkId ? <DateRangePicker value={range} onChange={setRange} /> : null}
          </div>
        }
      />

      {!linksQuery.isLoading && !links.length ? (
        <div className="panel empty-state-rich section-gap">
          <EmptyState title={t('noLinksScope')}>
            <Button asChild variant="primary">
              <Link to="/links">{t('links')}</Link>
            </Button>
          </EmptyState>
        </div>
      ) : null}

      {link ? (
        <p className="section-lead text-muted" style={{ marginTop: 0 }}>
          {t('trackedViaSlug')} <code>{link.slug}</code>
        </p>
      ) : linkId ? (
        <p className="text-muted">{t('linkNotFound')}</p>
      ) : null}

      {linkId && link ? (
        <section className="analytics-hero panel section-gap" aria-labelledby="link-analytics-hero">
          <h2 id="link-analytics-hero" className="visually-hidden">
            {t('linkClicksOverTime')}
          </h2>
          <div className="analytics-hero-stats">
            <div className="stat-card stat-card-primary">
              <div className="stat-label">{t('linkClicks')}</div>
              <div className="stat-value">
                {statsQuery.isLoading ? '—' : (stats?.clicks?.toLocaleString() ?? '0')}
              </div>
            </div>
            <StatCard
              label={t('linkUniqueVisitors')}
              value={statsQuery.isLoading ? '—' : (stats?.visitors?.toLocaleString() ?? '0')}
            />
          </div>
          <div className="analytics-hero-chart">
            <h3 className="section-title">{t('linkClicksOverTime')}</h3>
            {statsQuery.isLoading ? (
              <div className="chart-wrap chart-wrap-hero chart-skeleton" aria-busy>
                <div className="skeleton skeleton-block" />
              </div>
            ) : chartData.length > 0 ? (
              <div className="chart-wrap chart-wrap-hero">
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} vertical={false} />
                    <XAxis dataKey="x" tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: chartColors.muted }}
                      stroke={chartColors.border}
                    />
                    <Tooltip
                      contentStyle={{
                        background: chartColors.panel,
                        border: `1px solid ${chartColors.border}`,
                        borderRadius: 8,
                        fontSize: 13,
                        color: chartColors.text,
                      }}
                    />
                    <Line type="monotone" dataKey="y" stroke={chartColors.accent} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-muted">{t('noLinkClicksInRange')}</p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
