import { useQuery } from '@tanstack/react-query';
import { api, type Website } from '../lib/api';
import { useRealtimeData } from '../hooks/useRealtimeData';
import { t } from '../lib/i18n';
import { DataViewState } from './DataViewState';
import { EmptyState } from './EmptyState';
import { RealtimeBreakdown } from './RealtimeBreakdown';
import { RealtimeGeoMap } from './RealtimeGeoMap';

export function RealtimeWidget({ websiteId }: { websiteId: string }) {
  const { data, isLoading, sseConnected, error, refetch } = useRealtimeData(websiteId);
  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    queryFn: () => api<Website>(`/api/websites/${websiteId}`),
  });

  const sessions = data?.sessions?.length ? data.sessions : [];
  const window30 = data?.window30;
  const siteName = websiteQuery.data?.name?.trim() || websiteQuery.data?.domain;
  const visitors = data?.visitors ?? 0;
  const isLiveEmpty = Boolean(data) && visitors === 0 && sessions.length === 0;

  return (
    <div className="realtime-widget section-gap">
      <header className="realtime-widget-head">
        <p className="text-muted realtime-widget-lead">{t('realtimeLeadLive')}</p>
        <p
          className={`realtime-connection${sseConnected ? ' realtime-connection--live' : ''}`}
          aria-live="polite"
        >
          <span
            className={`live-dot${sseConnected ? ' live-dot--accent' : ' live-dot--muted'}`}
            aria-hidden="true"
          />
          <span className="realtime-connection-label">
            {sseConnected ? t('realtimeConnected') : t('realtimePolling')}
          </span>
        </p>
      </header>

      <DataViewState
        loading={isLoading && !data}
        error={error}
        onRetry={() => refetch()}
        isEmpty={!isLoading && !data}
        emptyTitle={t('noDataInPeriod')}
        loadingFallback={<div className="skeleton skeleton-block realtime-map-skeleton" aria-hidden />}
      >
        {data ? (
          <>
            <div className="realtime-globe-stage">
              <RealtimeGeoMap
                sessions={sessions}
                visitors={data.visitors}
                siteName={siteName}
              />
            </div>

            {isLiveEmpty ? (
              <div className="panel realtime-empty-panel section-gap">
                <EmptyState
                  title={t('realtimeEmptyTitle')}
                  description={t('realtimeEmptyHint')}
                />
              </div>
            ) : (
              <RealtimeBreakdown
                websiteId={websiteId}
                sessions={sessions}
                visitors={data.visitors}
                window30={window30}
              />
            )}
          </>
        ) : null}
      </DataViewState>
    </div>
  );
}
