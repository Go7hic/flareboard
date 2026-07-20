import { useMemo, useState } from 'react';
import { Bar, BarChart, Legend } from 'recharts';
import type { RealtimeSession, RealtimeWindow30 } from '../lib/api';
import { formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { getCountryLabel } from '../lib/map-format';
import { useChartColors } from '../lib/useChartColors';
import { AnalyticsChart } from './AnalyticsChart';
import { SegmentTabs } from './SegmentTabs';
import { SessionAvatar } from './SessionAvatar';
import { StatCard } from './ui/stat-card';

const BUCKET_MS = 2 * 60 * 1000;
const WINDOW_MS = 30 * 60 * 1000;
const TABLE_LIMIT = 8;
const ACTIVITY_LIMIT = 30;

type ActivityFilter = 'all' | 'pageviews' | 'visitors' | 'events';

type RankRow = { key: string; label: string; count: number; pct: number };

function countCountries(sessions: RealtimeSession[]): number {
  return new Set(sessions.map((s) => s.country).filter(Boolean)).size;
}

function countUniquePages(sessions: RealtimeSession[]): number {
  return new Set(sessions.map((s) => s.urlPath?.trim() || '/')).size;
}

function countUniqueReferrers(sessions: RealtimeSession[]): number {
  return new Set(
    sessions.map((s) => s.referrerDomain?.trim() || t('realtimeGlobeDirect')),
  ).size;
}

function topPages(sessions: RealtimeSession[], limit: number): RankRow[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const path = session.urlPath?.trim() || '/';
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0) || 1;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({
      key: label,
      label,
      count,
      pct: Math.round((count / total) * 100),
    }));
}

function topReferrers(sessions: RealtimeSession[], limit: number): RankRow[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const label = session.referrerDomain?.trim() || t('realtimeGlobeDirect');
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0) || 1;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({
      key: label,
      label,
      count,
      pct: Math.round((count / total) * 100),
    }));
}

function buildTimeBuckets(
  sessions: RealtimeSession[],
  window30: RealtimeWindow30 | undefined,
  now = Date.now(),
) {
  const start = now - WINDOW_MS;
  const bucketCount = Math.ceil(WINDOW_MS / BUCKET_MS);
  const buckets = Array.from({ length: bucketCount }, (_, i) => {
    const bucketStart = start + i * BUCKET_MS;
    return {
      ts: bucketStart,
      label: new Date(bucketStart).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }),
      visitors: 0,
      pageviews: 0,
    };
  });

  for (const session of sessions) {
    if (session.createdAt < start || session.createdAt > now) continue;
    const index = Math.min(
      bucketCount - 1,
      Math.floor((session.createdAt - start) / BUCKET_MS),
    );
    buckets[index].visitors += 1;
  }

  const ratio =
    window30 && window30.visitors > 0 ? window30.pageviews / window30.visitors : 1;

  for (const bucket of buckets) {
    const total = Math.max(bucket.visitors, Math.round(bucket.visitors * ratio));
    bucket.pageviews = Math.max(0, total - bucket.visitors);
  }

  return buckets;
}

function RealtimeRankTable({
  title,
  rows,
  metricLabel,
}: {
  title: string;
  rows: RankRow[];
  metricLabel: string;
}) {
  return (
    <section className="panel realtime-rank-panel">
      <header className="realtime-rank-head">
        <h3 className="realtime-rank-title">{title}</h3>
        <span className="realtime-rank-metric">{metricLabel}</span>
      </header>
      {rows.length ? (
        <table className="data-table realtime-rank-table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="realtime-rank-label">
                  <span className="realtime-path-mono">{row.label}</span>
                </td>
                <td className="num realtime-rank-value">
                  <span>{formatNumber(row.count)}</span>
                  <span className="realtime-rank-pct">{formatPercent(row.pct)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted realtime-rank-empty">{t('realtimeNoActivity')}</p>
      )}
    </section>
  );
}

export function RealtimeBreakdown({
  sessions,
  visitors,
  window30,
  onSelectSession,
  selectedSessionId,
}: {
  sessions: RealtimeSession[];
  visitors: number;
  window30?: RealtimeWindow30;
  onSelectSession: (sessionId: string | null) => void;
  selectedSessionId: string | null;
}) {
  const chartColors = useChartColors();
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');

  const onlineVisitors = visitors;
  const livePages = countUniquePages(sessions);
  const liveReferrers = countUniqueReferrers(sessions);
  const liveCountries = countCountries(sessions);

  const chartData = useMemo(
    () => buildTimeBuckets(sessions, window30),
    [sessions, window30],
  );

  const pages = useMemo(() => topPages(sessions, TABLE_LIMIT), [sessions]);
  const referrers = useMemo(() => topReferrers(sessions, TABLE_LIMIT), [sessions]);

  const activityRows = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt);
    if (activityFilter === 'events') return [];
    return sorted.slice(0, ACTIVITY_LIMIT);
  }, [sessions, activityFilter]);

  const activityFilters: { id: ActivityFilter; label: string }[] = [
    { id: 'all', label: t('realtimeFilterAll') },
    { id: 'pageviews', label: t('realtimeFilterPageviews') },
    { id: 'visitors', label: t('realtimeFilterVisitors') },
    { id: 'events', label: t('realtimeFilterEvents') },
  ];

  const visitorBarColor = chartColors.accent;
  const pageviewBarColor = `color-mix(in srgb, ${chartColors.accent} 50%, white)`;

  return (
    <div className="realtime-breakdown section-gap">
      <div className="stat-grid realtime-kpi-grid">
        <StatCard label={t('realtimeLiveVisitors')} value={formatNumber(onlineVisitors)} />
        <StatCard label={t('realtimeLivePages')} value={formatNumber(livePages)} />
        <StatCard label={t('realtimeLiveReferrers')} value={formatNumber(liveReferrers)} />
        <StatCard label={t('realtimeLiveCountries')} value={formatNumber(liveCountries)} />
      </div>

      <section className="panel realtime-chart-panel">
        <header className="realtime-rank-head">
          <h3 className="realtime-rank-title">{t('realtimeTrend30m')}</h3>
        </header>
        <div className="realtime-chart-wrap">
          <AnalyticsChart
            Chart={BarChart}
            data={chartData}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            responsive={{ width: '100%', height: 220 }}
            xAxis={{
              dataKey: 'label',
              tickLine: false,
              axisLine: { stroke: chartColors.border },
              interval: 'preserveStartEnd',
              minTickGap: 24,
            }}
            yAxis={{ tickLine: false, axisLine: false, width: 32 }}
          >
            <Legend
              verticalAlign="bottom"
              height={28}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: '0.8125rem', color: chartColors.muted }}
            />
            <Bar
              dataKey="visitors"
              name={t('realtimeChartLegendVisitors')}
              stackId="traffic"
              fill={visitorBarColor}
              radius={[0, 0, 0, 0]}
              maxBarSize={28}
            />
            <Bar
              dataKey="pageviews"
              name={t('realtimeChartLegendViews')}
              stackId="traffic"
              fill={pageviewBarColor}
              radius={[2, 2, 0, 0]}
              maxBarSize={28}
            />
          </AnalyticsChart>
        </div>
      </section>

      <section className="panel realtime-activity-panel">
        <header className="realtime-activity-head">
          <h3 className="realtime-activity-title">{t('realtimeActivityLog')}</h3>
          <SegmentTabs
            tabs={activityFilters}
            value={activityFilter}
            onChange={(id) => setActivityFilter(id as ActivityFilter)}
            aria-label={t('realtimeActivityLog')}
          />
        </header>
        <ul className="list-plain realtime-activity-feed">
          {activityRows.map((session) => {
            const isSelected = selectedSessionId === session.sessionId;
            const countryLabel = session.country ? getCountryLabel(session.country) : t('unknown');
            return (
              <li key={session.sessionId} className="realtime-activity-item">
                <button
                  type="button"
                  className={`realtime-activity-btn${isSelected ? ' is-selected' : ''}`}
                  onClick={() =>
                    onSelectSession(isSelected ? null : session.sessionId)
                  }
                >
                  <SessionAvatar
                    seed={session.sessionId}
                    size={28}
                    className="realtime-activity-avatar"
                  />
                  <span className="realtime-activity-body">
                    <span className="realtime-activity-time text-muted">
                      {new Date(session.createdAt).toLocaleTimeString()}
                    </span>
                    <span className="realtime-activity-text">
                      <span className="realtime-path-mono">{session.urlPath || '/'}</span>
                      {session.country ? (
                        <span className="text-muted realtime-activity-meta">
                          {' · '}
                          {t('realtimeVisitorFrom').replace('{country}', countryLabel)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {!activityRows.length ? (
            <li className="text-muted realtime-activity-empty">{t('realtimeNoActivity')}</li>
          ) : null}
        </ul>
      </section>

      <div className="realtime-tables-grid">
        <RealtimeRankTable
          title={t('realtimeTopPages')}
          rows={pages}
          metricLabel={t('views')}
        />
        <RealtimeRankTable
          title={t('realtimeTopReferrers')}
          rows={referrers}
          metricLabel={t('views')}
        />
      </div>
    </div>
  );
}
