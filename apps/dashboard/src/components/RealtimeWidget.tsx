import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Website } from '../lib/api';
import { useRealtimeData } from '../hooks/useRealtimeData';
import { t } from '../lib/i18n';
import { Button } from './ui/button';
import { RealtimeBreakdown } from './RealtimeBreakdown';
import { RealtimeGeoMap } from './RealtimeGeoMap';

type ActivityRow = { urlPath: string; eventName: string | null; createdAt: number };

export function RealtimeWidget({ websiteId }: { websiteId: string }) {
  const { data, isLoading, sseConnected } = useRealtimeData(websiteId);
  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    queryFn: () => api<Website>(`/api/websites/${websiteId}`),
  });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSessionId(null);
  }, [websiteId]);

  const activityQuery = useQuery({
    queryKey: ['realtime-activity', websiteId, selectedSessionId],
    enabled: Boolean(selectedSessionId),
    queryFn: () =>
      api<ActivityRow[]>(`/api/websites/${websiteId}/sessions/${selectedSessionId}/activity`),
  });

  const sessions = data?.sessions?.length ? data.sessions : [];
  const selected = sessions.find((s) => s.sessionId === selectedSessionId);
  const window30 = data?.window30;
  const siteName = websiteQuery.data?.name?.trim() || websiteQuery.data?.domain;

  return (
    <div className="realtime-widget section-gap">
      <header className="realtime-widget-head">
        <p className="text-muted realtime-widget-lead">{t('realtimeLeadLive')}</p>
        <p className="realtime-connection" aria-live="polite">
          <span
            className={`live-dot${sseConnected ? '' : ' live-dot--muted'}`}
            aria-hidden="true"
          />
          <span className="text-muted">{sseConnected ? t('realtimeConnected') : t('realtimePolling')}</span>
        </p>
      </header>

      {isLoading ? <div className="skeleton skeleton-block realtime-map-skeleton" aria-hidden /> : null}

      {data ? (
        <>
          <div className="realtime-globe-stage">
            <RealtimeGeoMap
              sessions={sessions}
              visitors={data.visitors}
              siteName={siteName}
            />
          </div>

          <RealtimeBreakdown
            sessions={sessions}
            visitors={data.visitors}
            window30={window30}
            onSelectSession={setSelectedSessionId}
            selectedSessionId={selectedSessionId}
          />
        </>
      ) : null}

      {selectedSessionId && selected ? (
        <div className="realtime-session-drawer panel section-gap">
          <div className="realtime-drawer-head">
            <h3 className="section-title">{t('realtimeSessionDetail')}</h3>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedSessionId(null)}>
              {t('cancel')}
            </Button>
          </div>
          <p className="text-muted realtime-drawer-meta">
            {selected.country ?? t('unknown')} · {selected.urlPath || '/'}
          </p>
          {activityQuery.isLoading ? (
            <p className="text-muted">{t('loading')}</p>
          ) : (
            <ol className="realtime-timeline list-plain">
              {(activityQuery.data ?? []).slice(0, 20).map((row, i) => (
                <li key={i} className="list-item">
                  <span className="text-muted">{new Date(row.createdAt).toLocaleTimeString()}</span>{' '}
                  <span className="realtime-path-mono">{row.urlPath}</span>
                  {row.eventName ? <span className="badge">{row.eventName}</span> : null}
                </li>
              ))}
            </ol>
          )}
          <Link
            to={`/websites/${websiteId}/sessions/${selectedSessionId}`}
            className="btn btn-secondary btn-sm"
          >
            {t('realtimeViewFullSession')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
