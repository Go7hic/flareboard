import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type RealtimeData } from '../lib/api';
import { subscribeRealtimeStream } from '../lib/realtime-stream';
import { t } from '../lib/i18n';
import { Button } from './ui/button';

/** Fallback poll when SSE is unavailable. */
const REALTIME_POLL_MS = 3_000;

type ActivityRow = { urlPath: string; eventName: string | null; createdAt: number };

export function RealtimeWidget({ websiteId }: { websiteId: string }) {
  const [sseData, setSseData] = useState<RealtimeData | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [sseLoading, setSseLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  useEffect(() => {
    setSseData(null);
    setSseConnected(false);
    setSseLoading(true);
    setSelectedSessionId(null);

    const stop = subscribeRealtimeStream(
      websiteId,
      (payload) => {
        setSseData(payload);
        setSseConnected(true);
        setSseLoading(false);
      },
      () => {
        setSseConnected(false);
        setSseLoading(false);
      },
    );

    return stop;
  }, [websiteId]);

  const poll = useQuery({
    queryKey: ['realtime', websiteId],
    queryFn: () => api<RealtimeData>(`/api/realtime/${websiteId}`),
    refetchInterval: REALTIME_POLL_MS,
    enabled: !sseConnected,
  });

  const activityQuery = useQuery({
    queryKey: ['realtime-activity', websiteId, selectedSessionId],
    enabled: Boolean(selectedSessionId),
    queryFn: () =>
      api<ActivityRow[]>(`/api/websites/${websiteId}/sessions/${selectedSessionId}/activity`),
  });

  const data = sseConnected ? sseData : poll.data;
  const isLoading = sseConnected ? sseLoading && !data : poll.isLoading;

  const sessions = data?.sessions?.length ? data.sessions : [];
  const selected = sessions.find((s) => s.sessionId === selectedSessionId);

  return (
    <section className="panel realtime-panel section-gap">
      <h2 className="section-title">
        <span className="live-dot" aria-hidden="true" />
        {t('realtime')}
        <span className="text-muted realtime-window-label">{t('realtimeWindow')}</span>
      </h2>
      {isLoading ? <div className="skeleton skeleton-block skeleton-inline" aria-hidden /> : null}
      {data ? (
        <>
          <p className="realtime-value">
            {data.visitors}
            <span className="realtime-value-unit">{t('activeVisitors')}</span>
          </p>
          <ul className="list-plain realtime-feed">
            {sessions.slice(0, 25).map((s) => (
              <li key={s.sessionId} className="list-item realtime-feed-item">
                <button
                  type="button"
                  className="realtime-session-btn"
                  onClick={() =>
                    setSelectedSessionId(selectedSessionId === s.sessionId ? null : s.sessionId)
                  }
                >
                  <div className="list-row">
                    <span>
                      <span className="text-muted">{new Date(s.createdAt).toLocaleTimeString()}</span>{' '}
                      <span className="realtime-path-mono">{s.urlPath || '/'}</span>
                      {s.referrerDomain ? (
                        <span className="text-muted realtime-referrer">← {s.referrerDomain}</span>
                      ) : null}
                    </span>
                    {s.country ? (
                      <span className="list-row-value text-muted">{s.country}</span>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
            {!sessions.length ? (
              <li className="text-muted list-item realtime-feed-item">{t('noActiveSessions')}</li>
            ) : null}
          </ul>
        </>
      ) : null}

      {selectedSessionId && selected ? (
        <div className="realtime-session-drawer panel">
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
    </section>
  );
}
