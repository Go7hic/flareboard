import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type RealtimeData } from '../lib/api';
import { subscribeRealtimeStream } from '../lib/realtime-stream';
import { t } from '../lib/i18n';

/** Fallback poll when SSE is unavailable. */
const REALTIME_POLL_MS = 3_000;

export function RealtimeWidget({ websiteId }: { websiteId: string }) {
  const [sseData, setSseData] = useState<RealtimeData | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [sseLoading, setSseLoading] = useState(true);

  useEffect(() => {
    setSseData(null);
    setSseConnected(false);
    setSseLoading(true);

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

  const data = sseConnected ? sseData : poll.data;
  const isLoading = sseConnected ? sseLoading && !data : poll.isLoading;

  const sessions = data?.sessions?.length ? data.sessions : [];

  return (
    <section className="panel realtime-panel section-gap">
      <h2 className="section-title">
        <span className="live-dot" aria-hidden="true" />
        {t('realtime')}
        <span className="text-muted" style={{ fontWeight: 400, marginLeft: '0.35rem', fontSize: '0.8125rem' }}>
          {t('realtimeWindow')}
        </span>
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
                <div className="list-row">
                  <span>
                    <span className="text-muted">{new Date(s.createdAt).toLocaleTimeString()}</span>{' '}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                      {s.urlPath || '/'}
                    </span>
                    {s.referrerDomain ? (
                      <span className="text-muted" style={{ marginLeft: '0.35rem', fontSize: '0.75rem' }}>
                        ← {s.referrerDomain}
                      </span>
                    ) : null}
                  </span>
                  {s.country ? (
                    <span className="list-row-value text-muted">{s.country}</span>
                  ) : null}
                </div>
              </li>
            ))}
            {!sessions.length ? (
              <li className="text-muted list-item realtime-feed-item">{t('noActiveSessions')}</li>
            ) : null}
          </ul>
        </>
      ) : null}
    </section>
  );
}
