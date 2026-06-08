import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { api, getToken, type Website } from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsiteRange } from '../lib/useWebsiteRange';

interface ReplayRow {
  visitId: string;
  sessionId: string;
  startedAt: number;
  endedAt: number;
  eventCount: number;
  chunks: number;
}

interface ReplayDetail {
  visitId: string;
  chunks: unknown[];
  events: unknown[];
}

export default function ReplaysPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const navigate = useNavigate();
  const { range, setRange } = useWebsiteRange(websiteId, '24h');
  const [selectedVisit, setSelectedVisit] = useState<string | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const playerInstance = useRef<unknown>(null);

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<Website & { replayEnabled?: boolean }>(`/api/websites/${websiteId}`),
  });

  const listQuery = useQuery({
    queryKey: ['replays', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<ReplayRow[]>(`/api/websites/${websiteId}/replays`),
  });

  const detailQuery = useQuery({
    queryKey: ['replay', websiteId, selectedVisit],
    enabled: Boolean(websiteId && selectedVisit),
    queryFn: () => api<ReplayDetail>(`/api/websites/${websiteId}/replays/${selectedVisit}`),
  });

  useEffect(() => {
    if (!playerRef.current) return;
    playerRef.current.innerHTML = '';
    playerInstance.current = null;

    const events = detailQuery.data?.events;
    if (!events?.length) return;

    let cancelled = false;

    (async () => {
      const [{ default: rrwebPlayer }] = await Promise.all([
        import('rrweb-player'),
        import('rrweb-player/dist/style.css'),
      ]);
      if (cancelled || !playerRef.current) return;

      playerInstance.current = new rrwebPlayer({
        target: playerRef.current,
        props: {
          events: events as never[],
          width: Math.min(1024, playerRef.current.clientWidth || 1024),
          height: 576,
          autoPlay: false,
          showController: true,
        },
      });
    })();

    return () => {
      cancelled = true;
      playerInstance.current = null;
    };
  }, [detailQuery.data]);

  const replayEnabled = Boolean(websiteQuery.data?.replayEnabled);
  const visits = useMemo(
    () =>
      (listQuery.data ?? []).filter(
        (row) => row.startedAt >= range.startAt && row.startedAt <= range.endAt,
      ),
    [listQuery.data, range.startAt, range.endAt],
  );

  return (
    <div className="page page-replays">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <WebsiteDateExportControls range={range} onRangeChange={setRange} />
        }
      />

      <h2 className="section-title website-page-heading">{t('sessionReplays')}</h2>

      {!replayEnabled && websiteQuery.data ? (
        <div className="panel empty-state-rich section-gap">
          <EmptyState title={t('replayDisabledHint')} description={t('replaysVisitsLead')}>
            <Button asChild variant="primary">
              <Link to={`/websites/${websiteId}/settings`}>{t('goToReplaySettings')}</Link>
            </Button>
          </EmptyState>
        </div>
      ) : null}

      {replayEnabled ? (
        <div className="replays-layout section-gap">
          <section className="panel">
            <h2 className="section-title">{t('replaysVisits')}</h2>
            <p className="section-lead">{t('replaysVisitsLead')}</p>
            {listQuery.isLoading ? <Skeleton className="h-6 w-1/2" /> : null}
            <ul className="replays-list">
              {visits.map((r) => (
                <li
                  key={r.visitId}
                  className={`replays-list-item${selectedVisit === r.visitId ? ' selected' : ''}`}
                  onClick={() => setSelectedVisit(r.visitId)}
                >
                  <div>{new Date(r.startedAt).toLocaleString()}</div>
                  <div className="text-muted" style={{ fontSize: '0.8125rem', marginTop: '0.2rem' }}>
                    {r.eventCount} {t('replayEventsLabel')} · {r.chunks} {t('replayChunksLabel')}
                  </div>
                </li>
              ))}
            </ul>
            {!listQuery.isLoading && !visits.length ? (
              <p className="text-muted">{t('noReplaysYet')}</p>
            ) : null}
          </section>

          <section className="panel replays-player-panel">
            <h2 className="section-title">{t('replayViewer')}</h2>
            {!selectedVisit ? (
              <p className="text-muted">{t('replaysVisitsLead')}</p>
            ) : null}
            {selectedVisit && detailQuery.isLoading ? (
              <div className="skeleton" style={{ height: '3rem' }} />
            ) : null}
            {selectedVisit && detailQuery.data && !detailQuery.data.events?.length ? (
              <p className="text-muted">{t('noReplayEvents')}</p>
            ) : null}
            <div ref={playerRef} className="replay-player-wrap" />
          </section>
        </div>
      ) : null}
    </div>
  );
}
