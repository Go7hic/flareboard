import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
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
  durationMs: number;
  pageviews: number;
  customEvents: number;
  errors: number;
  logs: number;
  aiCalls: number;
  lastIssueAt: number | null;
}

interface ReplayDetail {
  visitId: string;
  chunks: unknown[];
  events: unknown[];
}

interface SavedReplay {
  id: string;
  name: string;
  visitId: string;
  createdAt: number | string;
  sessionId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  eventCount: number;
  chunks: number;
  durationMs: number;
  pageviews: number;
  customEvents: number;
  errors: number;
  logs: number;
  aiCalls: number;
  lastIssueAt: number | null;
}

type ReplayFilter = 'all' | 'issues' | 'errors' | 'logs' | 'ai';

function formatDuration(value: number | null | undefined) {
  const seconds = Math.max(0, Math.round((value ?? 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function replayMatchesFilter(replay: ReplayRow | SavedReplay, filter: ReplayFilter) {
  if (filter === 'errors') return replay.errors > 0;
  if (filter === 'logs') return replay.logs > 0;
  if (filter === 'ai') return replay.aiCalls > 0;
  if (filter === 'issues') return replay.errors > 0 || replay.logs > 0;
  return true;
}

function ReplayMetaBadges({ replay }: { replay: ReplayRow | SavedReplay }) {
  return (
    <div className="replay-meta-badges">
      <span className="badge">{formatDuration(replay.durationMs)}</span>
      <span className="badge">{replay.pageviews.toLocaleString()} {t('pageviews')}</span>
      {replay.errors ? <span className="badge log-level-error">{replay.errors.toLocaleString()} {t('errors')}</span> : null}
      {replay.logs ? <span className="badge log-level-warn">{replay.logs.toLocaleString()} {t('logs')}</span> : null}
      {replay.aiCalls ? <span className="badge badge-accent">{replay.aiCalls.toLocaleString()} {t('aiCalls')}</span> : null}
    </div>
  );
}

export default function ReplaysPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { range, setRange } = useWebsiteRange(websiteId, '24h');
  const [selectedVisit, setSelectedVisit] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [replayFilter, setReplayFilter] = useState<ReplayFilter>('all');
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

  const savedQuery = useQuery({
    queryKey: ['saved-replays', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<SavedReplay[]>(`/api/websites/${websiteId}/replays/saved`),
  });

  const detailQuery = useQuery({
    queryKey: ['replay', websiteId, selectedVisit],
    enabled: Boolean(websiteId && selectedVisit),
    queryFn: () => api<ReplayDetail>(`/api/websites/${websiteId}/replays/${selectedVisit}`),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      api<SavedReplay>(`/api/websites/${websiteId}/replays/saved`, {
        method: 'POST',
        body: JSON.stringify({
          visitId: selectedVisit,
          name: saveName.trim(),
        }),
      }),
    onSuccess: () => {
      setSaveName('');
      queryClient.invalidateQueries({ queryKey: ['saved-replays', websiteId] });
    },
  });

  const deleteSavedMutation = useMutation({
    mutationFn: (savedReplayId: string) =>
      api(`/api/websites/${websiteId}/replays/saved/${savedReplayId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-replays', websiteId] }),
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
        (row) =>
          row.startedAt >= range.startAt &&
          row.startedAt <= range.endAt &&
          replayMatchesFilter(row, replayFilter),
      ),
    [listQuery.data, range.startAt, range.endAt, replayFilter],
  );
  const savedReplays = useMemo(() => savedQuery.data ?? [], [savedQuery.data]);
  const savedVisitIds = useMemo(
    () => new Set(savedReplays.map((replay) => replay.visitId)),
    [savedReplays],
  );
  const selectedReplay = useMemo(
    () =>
      visits.find((row) => row.visitId === selectedVisit) ??
      savedReplays.find((row) => row.visitId === selectedVisit) ??
      null,
    [savedReplays, selectedVisit, visits],
  );

  useEffect(() => {
    if (!selectedReplay || savedVisitIds.has(selectedReplay.visitId)) {
      setSaveName('');
      return;
    }
    setSaveName(`Replay ${new Date(selectedReplay.startedAt ?? Date.now()).toLocaleString()}`);
  }, [selectedReplay, savedVisitIds]);

  return (
    <div className="page page-replays">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <WebsiteDateExportControls range={range} onRangeChange={setRange} />
        }
      />

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
            <div className="replays-filter-row">
              <select
                className="select"
                value={replayFilter}
                onChange={(event) => setReplayFilter(event.target.value as ReplayFilter)}
                aria-label={t('replayFilter')}
              >
                <option value="all">{t('allReplays')}</option>
                <option value="issues">{t('replaysWithIssues')}</option>
                <option value="errors">{t('replaysWithErrors')}</option>
                <option value="logs">{t('replaysWithLogs')}</option>
                <option value="ai">{t('replaysWithAi')}</option>
              </select>
            </div>
            {savedReplays.length ? (
              <div className="replays-saved-list">
                <h3 className="section-title experiment-title">{t('savedReplays')}</h3>
                {savedReplays.map((saved) => (
                  <div key={saved.id} className="replays-saved-item">
                    <button
                      type="button"
                      className="replays-saved-open"
                      onClick={() => setSelectedVisit(saved.visitId)}
                    >
                      <strong>{saved.name}</strong>
                      <span className="text-muted">
                        {saved.eventCount.toLocaleString()} {t('replayEventsLabel')} ·{' '}
                        {new Date(saved.startedAt ?? saved.createdAt).toLocaleString()}
                      </span>
                      <ReplayMetaBadges replay={saved} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-danger-text"
                      onClick={() => deleteSavedMutation.mutate(saved.id)}
                    >
                      {t('delete')}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
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
                  <ReplayMetaBadges replay={r} />
                </li>
              ))}
            </ul>
            {!listQuery.isLoading && !visits.length ? (
              <p className="text-muted">{t('noReplaysYet')}</p>
            ) : null}
          </section>

          <section className="panel replays-player-panel">
            <header className="panel-header">
              <div>
                <h2 className="section-title">{t('replayViewer')}</h2>
                {selectedReplay ? (
                  <p className="text-muted">
                    {selectedReplay.eventCount.toLocaleString()} {t('replayEventsLabel')} ·{' '}
                    {selectedReplay.chunks.toLocaleString()} {t('replayChunksLabel')} ·{' '}
                    {formatDuration(selectedReplay.durationMs)}
                  </p>
                ) : null}
              </div>
            </header>
            {selectedReplay && !savedVisitIds.has(selectedReplay.visitId) ? (
              <div className="replay-save-row">
                <Input
                  value={saveName}
                  placeholder={t('replayNamePlaceholder')}
                  onChange={(event) => setSaveName(event.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!saveName.trim() || saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? t('saving') : t('saveReplay')}
                </Button>
              </div>
            ) : null}
            {selectedReplay && savedVisitIds.has(selectedReplay.visitId) ? (
              <p className="text-muted replay-saved-note">{t('replayAlreadySaved')}</p>
            ) : null}
            {saveMutation.error ? (
              <p className="text-danger">{(saveMutation.error as Error).message}</p>
            ) : null}
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
