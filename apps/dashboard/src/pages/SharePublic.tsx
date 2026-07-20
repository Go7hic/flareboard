import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Line, LineChart } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { BoardWidgets } from '../components/BoardWidgets';
import { BrandLogo } from '../components/BrandLogo';
import { WebsiteNameLabel } from '../components/WebsiteNameLabel';
import { StatCard } from '../components/ui/stat-card';
import { formatChartTimeLabel, isHourlyChartRange } from '../lib/chartTimeseries';
import { API_URL, type WebsiteStats } from '../lib/api';
import { parseBoardConfig, type BoardRangePreset } from '../lib/board-config';
import { type DateRangePreset, presetToRange, rangeQueryString } from '../lib/dateRange';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';

type PublicWebsiteShare = WebsiteStats & {
  website: { id: string; name: string; domain?: string; timezone?: string };
  share: { name: string; slug: string };
  timeseries: { pageviews: { x: string; y: number }[] };
};

type PublicBoardShare = {
  board: {
    id: string;
    name: string;
    parameters: Record<string, unknown>;
  };
  share: { name: string; slug: string };
};

export default function SharePublic() {
  const chartColors = useChartColors();
  const { slug } = useParams<{ slug: string }>();
  const [preset, setPreset] = useState<DateRangePreset | 'default'>('default');
  const [siteTimezone, setSiteTimezone] = useState('UTC');
  const range = useMemo(
    () => (preset === 'default' ? null : presetToRange(preset, undefined, undefined, siteTimezone)),
    [preset, siteTimezone],
  );
  const rangeQs = range ? rangeQueryString(range.startAt, range.endAt) : '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-share', slug, range],
    enabled: Boolean(slug),
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/share/${slug}${rangeQs ? `?${rangeQs}` : ''}`);
      if (!res.ok) throw new Error(t('shareNotFound'));
      return res.json() as Promise<PublicWebsiteShare | PublicBoardShare>;
    },
  });

  useEffect(() => {
    if (data && 'website' in data && data.website.timezone) {
      setSiteTimezone(data.website.timezone);
    }
  }, [data]);

  const isBoard = data && 'board' in data;
  const boardConfig = isBoard ? parseBoardConfig(data.board.parameters) : null;
  const activePreset = preset === 'default' ? (boardConfig?.rangePreset ?? '24h') : preset;
  const chartTimezone = !isBoard && data && 'website' in data ? data.website.timezone ?? 'UTC' : siteTimezone;
  const chartData = useMemo(() => {
    if (!data || !('timeseries' in data)) return [];
    const hourly = range ? isHourlyChartRange(range.startAt, range.endAt) : false;
    return data.timeseries.pageviews.map((p) => ({
      ...p,
      x: formatChartTimeLabel(p.x, hourly, chartTimezone),
    }));
  }, [data, range, chartTimezone]);

  if (isLoading) {
    return (
      <div className="page">
        <div className="skeleton" style={{ width: '40%', height: '2rem' }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page">
        <div className="panel empty-state-rich">
          <h3>{t('shareNotFound')}</h3>
          <p className="text-danger">{(error as Error)?.message ?? t('shareExpired')}</p>
        </div>
      </div>
    );
  }

  const title = isBoard ? data.board.name : data.website.name;

  return (
    <div className="page">
      <header className="page-header">
        <div className="shell-brand share-public-brand">
          <BrandLogo />
        </div>
        <h1 className="page-title">
          {isBoard ? (
            title
          ) : (
            <WebsiteNameLabel
              name={data.website.name}
              domain={data.website.domain}
              faviconSize={22}
            />
          )}
        </h1>
        <p className="page-subtitle">
          {t('shared')}: {data.share.name}
        </p>
        <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.75rem' }}>
          {(['24h', '7d', '30d', '90d'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`btn btn-sm${activePreset === p ? ' btn-primary' : ' btn-secondary'}`}
              onClick={() => setPreset(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </header>

      {isBoard ? (
        <BoardWidgets
          widgets={boardConfig?.widgets ?? []}
          rangePreset={(preset === 'default' || preset === 'custom' ? boardConfig?.rangePreset : preset) as BoardRangePreset}
          publicMode
        />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label={t('pageviews')} value={formatNumber(data.pageviews.value)} variant="primary" />
            <StatCard label={t('visitors')} value={formatNumber(data.visitors.value)} />
            <StatCard label={t('visits')} value={formatNumber(data.visits.value)} />
          </div>

          <section className="panel chart-panel section-gap-lg">
            <h2 className="section-title">{t('pageviewsOverTime')}</h2>
            <div className="chart-wrap">
              <AnalyticsChart Chart={LineChart} data={chartData} xAxis={{ dataKey: 'x' }}>
                <Line type="monotone" dataKey="y" stroke={chartColors.accent} strokeWidth={2} dot={false} />
              </AnalyticsChart>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
