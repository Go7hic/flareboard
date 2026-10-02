import { useQuery } from '@tanstack/react-query';
import { api, type RealtimeData, type Website } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { DataViewState } from './DataViewState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from './KpiStrip';
import { RealtimeBreakdown, RealtimeLiveFeed, topPages } from './RealtimeBreakdown';
import { RealtimeGeoMap } from './RealtimeGeoMap';
import { SectionCard } from './SectionCard';
import { Skeleton } from './ui/skeleton';

/**
 * Realtime report body: who is online now (KPI strip), where they are (map), what they are
 * doing (live sessions) and the ranked breakdowns. Data comes from useRealtimeData (SSE with
 * a polling fallback), owned by the page so the header can show the connection state.
 */
export function RealtimeWidget({
  websiteId,
  data,
  isLoading,
  error,
  onRetry,
}: {
  websiteId: string;
  data: RealtimeData | null | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    queryFn: () => api<Website>(`/api/websites/${websiteId}`),
  });

  const sessions = data?.sessions ?? [];
  const visitors = data?.visitors ?? 0;
  const window30 = data?.window30;
  const siteName = websiteQuery.data?.name?.trim() || websiteQuery.data?.domain;
  const top = topPages(sessions, 1)[0];

  return (
    <DataViewState
      loading={isLoading && !data}
      error={!data ? error : null}
      onRetry={onRetry}
      loadingFallback={
        <div className="stack">
          <KpiStripSkeleton cells={4} />
          <div className="layout-grid">
            <Skeleton className="span-8 h-[460px] w-full rounded-[var(--radius-md)]" />
            <Skeleton className="span-4 h-[460px] w-full rounded-[var(--radius-md)]" />
          </div>
        </div>
      }
    >
      <div className="stack">
        <KpiStrip columns={4}>
          <KpiCell label={t('trafficOnlineNow')} value={formatNumber(visitors)} hint={t('trafficLast5Min')} />
          <KpiCell
            label={t('pageviews')}
            value={window30 ? formatNumber(window30.pageviews) : '-'}
            hint={t('trafficLast30Min')}
          />
          <KpiCell
            label={t('visitors')}
            value={window30 ? formatNumber(window30.visitors) : '-'}
            hint={
              window30
                ? `${t('trafficLast30Min')} · ${t('trafficVisitsCountInline').replace('{count}', formatNumber(window30.visits))}`
                : t('trafficLast30Min')
            }
          />
          <KpiCell
            label={t('trafficTopPage')}
            value={top ? <span className="traffic-kpi-path">{top.label}</span> : '-'}
            title={top?.label}
            hint={
              top
                ? t('trafficTopPageHint')
                    .replace('{count}', formatNumber(top.count))
                    .replace('{total}', formatNumber(Math.max(visitors, sessions.length)))
                : t('realtimeEmptyTitle')
            }
          />
        </KpiStrip>

        <div className="layout-grid layout-grid--stretch">
          <SectionCard flush className="span-8 traffic-map-card" bodyClassName="traffic-map-body" as="div">
            <RealtimeGeoMap sessions={sessions} visitors={visitors} siteName={siteName} />
          </SectionCard>
          <RealtimeLiveFeed
            className="span-4"
            websiteId={websiteId}
            sessions={sessions}
            visitors={visitors}
            window30={window30}
          />
          {sessions.length ? <RealtimeBreakdown sessions={sessions} /> : null}
        </div>
      </div>
    </DataViewState>
  );
}
