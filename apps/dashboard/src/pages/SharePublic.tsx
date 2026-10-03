import { useQuery } from '@tanstack/react-query';
import { Link2Off } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Area, AreaChart } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { BoardWidgets } from '../components/BoardWidgets';
import { BrandLogo } from '../components/BrandLogo';
import { EmptyState } from '../components/EmptyState';
import { InsightResultView } from '../components/InsightResultView';
import { KpiStripSkeleton } from '../components/KpiStrip';
import { OverviewDimensionCard } from '../components/OverviewDimensionCard';
import { OverviewKpiStrip } from '../components/OverviewKpiStrip';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { Skeleton } from '../components/ui/skeleton';
import { RangeSegmented } from '../components/workspace/RangeSegmented';
import { SiteAvatar } from '../components/workspace/SiteIdentity';
import { formatChartTimeLabel, isHourlyChartRange } from '../lib/chartTimeseries';
import { areaMark } from '../lib/chartMarks';
import { API_URL, type InsightResult, type MetricRow, type WebsiteStats } from '../lib/api';
import { parseBoardConfig, type BoardRangePreset } from '../lib/board-config';
import { type DateRangePreset, presetToRange, rangeQueryString } from '../lib/dateRange';
import { formatMetricLabel } from '../lib/metric-labels';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import '../styles/console-pages';

type PublicWebsiteShare = WebsiteStats & {
  website: { id: string; name: string; domain?: string; timezone?: string };
  share: { name: string; slug: string };
  timeseries: { pageviews: { x: string; y: number }[] };
};

type PublicBoardShare = {
  board: {
    id: string;
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
  share: { name: string; slug: string };
};

type PublicInsightShare = {
  insight: { id: string; name: string; description: string; type: string };
  website: { name: string; domain?: string | null; timezone?: string };
  result: InsightResult | null;
  share: { name: string; slug: string };
};

type PublicShare = PublicWebsiteShare | PublicBoardShare | PublicInsightShare;

const SHARE_PRESETS = ['24h', '7d', '30d', '90d'] as const;
type SharePreset = (typeof SHARE_PRESETS)[number];

/** The overview's dimension cards (same tabs), fed by the public share endpoint. */
const DIMENSION_CARDS = [
  { titleKey: 'overviewCardPages', tabs: [['path', 'segmentField_path'], ['entry', 'overviewTabEntry'], ['exit', 'overviewTabExit']] },
  { titleKey: 'overviewCardSources', tabs: [['referrer', 'segmentField_referrer'], ['channel', 'overviewTabChannel']] },
  { titleKey: 'overviewCardEnvironment', tabs: [['browser', 'browser'], ['os', 'os'], ['device', 'device']] },
  { titleKey: 'overviewCardLocation', tabs: [['country', 'country'], ['region', 'segmentField_region'], ['city', 'segmentField_city']] },
] as const;

async function fetchShare<T>(slug: string, query: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/share/${slug}${query ? `?${query}` : ''}`);
  if (!res.ok) throw new Error(t('shareNotFound'));
  return res.json() as Promise<T>;
}

function ShareDimensionCard({
  slug,
  rangeQs,
  card,
}: {
  slug: string;
  rangeQs: string;
  card: (typeof DIMENSION_CARDS)[number];
}) {
  const [tab, setTab] = useState<string>(card.tabs[0][0]);
  const query = useQuery({
    queryKey: ['public-share-metrics', slug, tab, rangeQs],
    queryFn: () => fetchShare<MetricRow[]>(slug, `type=${tab}${rangeQs ? `&${rangeQs}` : ''}`),
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === tab ? previous : undefined),
  });
  const rows = (query.data ?? []).map((row) => ({ ...row, x: formatMetricLabel(tab, row.x) }));
  return (
    <OverviewDimensionCard
      title={t(card.titleKey)}
      tabs={card.tabs.map(([id, labelKey]) => ({ id, label: t(labelKey) }))}
      activeTab={tab}
      onTabChange={setTab}
      rows={rows}
      loading={query.isLoading}
      error={query.isError ? query.error : null}
      onRetry={() => query.refetch()}
    />
  );
}

function ShareSkeleton() {
  return (
    <div className="page ws-share" aria-busy>
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-6 h-8 w-64" />
      <div className="stack mt-6">
        <KpiStripSkeleton cells={5} />
        <Skeleton className="h-[300px] w-full" />
      </div>
    </div>
  );
}

export default function SharePublic() {
  const chartColors = useChartColors();
  const { slug = '' } = useParams<{ slug: string }>();
  const [preset, setPreset] = useState<DateRangePreset | 'default'>('default');
  const [siteTimezone, setSiteTimezone] = useState('UTC');
  const range = useMemo(
    () => (preset === 'default' ? null : presetToRange(preset, undefined, undefined, siteTimezone)),
    [preset, siteTimezone],
  );
  // Ask for hourly points on short ranges; without `unit` the API bucketed by day.
  const rangeQs = range
    ? `${rangeQueryString(range.startAt, range.endAt)}&unit=${isHourlyChartRange(range.startAt, range.endAt) ? 'hour' : 'day'}`
    : '';

  const { data, isLoading, error, isPlaceholderData } = useQuery({
    queryKey: ['public-share', slug, range],
    enabled: Boolean(slug),
    queryFn: () => fetchShare<PublicShare>(slug, rangeQs),
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    if (data && 'website' in data && data.website.timezone) {
      setSiteTimezone(data.website.timezone);
    }
  }, [data]);

  const isBoard = Boolean(data && 'board' in data);
  const isInsight = Boolean(data && 'insight' in data);
  const boardConfig = data && 'board' in data ? parseBoardConfig(data.board.parameters) : null;
  const activePreset = (preset === 'default' ? (boardConfig?.rangePreset ?? (isInsight ? '30d' : '24h')) : preset) as SharePreset;
  const chartTimezone = !isBoard && data && 'website' in data ? data.website.timezone ?? 'UTC' : siteTimezone;
  const hourly = range ? isHourlyChartRange(range.startAt, range.endAt) : activePreset === '24h';
  const chartData = useMemo(() => {
    if (!data || !('timeseries' in data)) return [];
    return data.timeseries.pageviews.map((p) => ({
      ...p,
      x: formatChartTimeLabel(p.x, hourly, chartTimezone),
    }));
  }, [data, hourly, chartTimezone]);

  if (isLoading) return <ShareSkeleton />;

  if (error || !data) {
    return (
      <div className="page ws-share">
        <EmptyState
          variant="rich"
          tone="danger"
          icon={<Link2Off />}
          title={t('shareNotFound')}
          description={(error as Error)?.message === t('shareNotFound') ? t('shareExpired') : ((error as Error)?.message ?? t('shareExpired'))}
        />
      </div>
    );
  }

  let title: ReactNode;
  let lead: string;
  let body: ReactNode;

  if ('board' in data) {
    title = data.board.name;
    lead = data.board.description || t('workspaceSharedBoardLead');
    body = (
      <BoardWidgets
        widgets={boardConfig?.widgets ?? []}
        rangePreset={(preset === 'default' || preset === 'custom' ? boardConfig?.rangePreset : preset) as BoardRangePreset}
        publicMode
      />
    );
  } else if ('insight' in data) {
    title = data.insight.name;
    lead = data.insight.description || data.website.name;
    body = (
      <SectionCard>
        {data.result ? (
          <InsightResultView result={data.result} />
        ) : (
          <EmptyState title={t('boardWidgetError')} />
        )}
      </SectionCard>
    );
  } else {
    title = (
      <span className="ws-share-title">
        <SiteAvatar name={data.website.name} domain={data.website.domain} size="lg" />
        {data.website.name}
      </span>
    );
    lead = t('workspaceSharedWebsiteLead');
    body = (
      <>
        <OverviewKpiStrip
          stats={data}
          compareLabel=""
          pageviewsColor={chartColors.series.pageviews}
          visitorsColor=""
        />
        <SectionCard title={t('pageviewsOverTime')}>
          {chartData.length > 1 ? (
            <div className="overview-trend-chart">
              <AnalyticsChart
                Chart={AreaChart}
                data={chartData}
                responsive={{ height: 300 }}
                xAxis={{ dataKey: 'x', interval: 'preserveStartEnd', minTickGap: hourly ? 32 : 24 }}
              >
                <Area
                  dataKey="y"
                  name={t('pageviews')}
                  stroke={chartColors.series.pageviews}
                  fill={chartColors.series.pageviews}
                  {...areaMark(chartColors.panel)}
                />
              </AnalyticsChart>
            </div>
          ) : (
            <EmptyState title={t('chartNoData')} description={t('noDataInPeriodHint')} />
          )}
        </SectionCard>
        <section className="layout-grid layout-grid--stretch overview-dimensions-grid" aria-label={t('breakdownMetrics')}>
          {DIMENSION_CARDS.map((card) => (
            <ShareDimensionCard key={card.titleKey} slug={slug} rangeQs={rangeQs} card={card} />
          ))}
        </section>
      </>
    );
  }

  return (
    <div className="page ws-share">
      <div className="ws-share-top">
        <a href="/" className="ws-share-brand" aria-label="Flareboard">
          <BrandLogo size={22} />
        </a>
        <span className="ws-share-badge">{t('workspaceSharedReadOnly')}</span>
      </div>
      <PageHeader
        title={title}
        lead={lead}
        meta={<p className="ws-share-meta">{`${t('shared')}: ${data.share.name}`}</p>}
        actions={
          <RangeSegmented
            value={activePreset}
            options={SHARE_PRESETS}
            onChange={(next) => setPreset(next)}
          />
        }
      />
      <div className={isPlaceholderData ? 'stack ws-refreshing' : 'stack'}>{body}</div>
      <footer className="ws-share-footer">
        {t('workspacePoweredBy')
          .split('{brand}')
          .flatMap((part, index) =>
            index === 0
              ? [part]
              : [
                  <a key="brand" href="/" className="ws-share-footer-link">
                    Flareboard
                  </a>,
                  part,
                ],
          )}
      </footer>
    </div>
  );
}
