import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { EmptyState } from '../components/EmptyState';
import { MasterDetailLayout, MasterDetailSelectableItem } from '../components/master-detail';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { PropertyFilterBuilder } from '../components/PropertyFilterBuilder';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { ReplayShareDialog } from '../components/ReplayShareDialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { api, type Website } from '../lib/api';
import { formatDateTime, formatDurationMs, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { linkAtTime, parseStartParam, type AnalyticsEvent } from '../lib/replay-timeline';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';

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
  clickCount?: number;
  inputCount?: number;
  consoleErrorCount?: number;
  consoleWarnCount?: number;
  networkErrorCount?: number;
  entryPath?: string | null;
  distinctId?: string | null;
  country?: string | null;
  browser?: string | null;
  os?: string | null;
  device?: string | null;
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

/** `errors` is filtered by the API (error events or console errors); the others on the loaded rows. */
type ReplayFilter = 'all' | 'issues' | 'errors' | 'logs' | 'ai';
const SORTS = ['newest', 'oldest', 'longest', 'shortest', 'most_active', 'most_errors'] as const;
type ReplaySort = (typeof SORTS)[number];
const MIN_DURATIONS = [0, 10_000, 30_000, 60_000, 300_000] as const;

function replayMatchesFilter(replay: ReplayRow | SavedReplay, filter: ReplayFilter) {
  if (filter === 'logs') return replay.logs > 0;
  if (filter === 'ai') return replay.aiCalls > 0;
  if (filter === 'issues') return replay.errors > 0 || replay.logs > 0 || Boolean('consoleErrorCount' in replay && replay.consoleErrorCount);
  return true;
}

function ReplayMetaBadges({ replay }: { replay: ReplayRow | SavedReplay }) {
  const row = replay as ReplayRow;
  const errors = replay.errors + (row.consoleErrorCount ?? 0);
  return (
    <div className="replay-meta-badges">
      <span className="badge">{formatDurationMs(replay.durationMs)}</span>
      <span className="badge">{formatNumber(replay.pageviews)} {t('pageviews')}</span>
      {row.clickCount ? <span className="badge">{formatNumber(row.clickCount)} {t('replayClicks')}</span> : null}
      {errors ? <span className="badge log-level-error">{formatNumber(errors)} {t('errors')}</span> : null}
      {replay.logs ? <span className="badge log-level-warn">{formatNumber(replay.logs)} {t('logs')}</span> : null}
      {row.networkErrorCount ? (
        <span className="badge log-level-warn">{formatNumber(row.networkErrorCount)} {t('replayFailedRequests')}</span>
      ) : null}
      {replay.aiCalls ? <span className="badge badge-accent">{formatNumber(replay.aiCalls)} {t('aiCalls')}</span> : null}
    </div>
  );
}

function replayWho(row: ReplayRow) {
  return [row.distinctId, row.country, row.browser, row.device].filter(Boolean).join(' · ');
}

export default function ReplaysPage() {
  const confirm = useConfirm();
  const { websiteId } = useParams<{ websiteId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { canEdit } = useWebsitePermissions(websiteId);
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const selectedVisit = searchParams.get('visit');
  // A shared link (`?visit=…&t=…`) starts that replay at its timestamp; other replays start at 0.
  const [linkStart] = useState(() => ({ visit: searchParams.get('visit'), ms: parseStartParam(searchParams.get('t')) }));
  const [saveName, setSaveName] = useState('');
  const [replayFilter, setReplayFilter] = useState<ReplayFilter>('all');
  const [sort, setSort] = useState<ReplaySort>('newest');
  const [minDuration, setMinDuration] = useState(0);
  const [person, setPerson] = useState('');
  const [eventName, setEventName] = useState('');
  const [url, setUrl] = useState('');
  const [filters, setFilters] = useState<PropertyFilter[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [shareAt, setShareAt] = useState<number | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const debouncedPerson = useDebouncedValue(person.trim(), 400);
  const debouncedEvent = useDebouncedValue(eventName.trim(), 400);
  const debouncedUrl = useDebouncedValue(url.trim(), 400);

  const selectVisit = (visitId: string | null) => {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        if (visitId) next.set('visit', visitId);
        else next.delete('visit');
        next.delete('t');
        return next;
      },
      { replace: true },
    );
  };

  const listQs = useMemo(() => {
    const params = new URLSearchParams(rangeQs);
    params.set('sort', sort);
    if (replayFilter === 'errors') params.set('hasErrors', 'true');
    if (minDuration) params.set('minDurationMs', String(minDuration));
    if (debouncedPerson) params.set('distinctId', debouncedPerson);
    if (debouncedEvent) params.set('event', debouncedEvent);
    if (debouncedUrl) params.set('url', debouncedUrl);
    if (filters.length) params.set('filters', JSON.stringify(filters));
    return params.toString();
  }, [rangeQs, sort, replayFilter, minDuration, debouncedPerson, debouncedEvent, debouncedUrl, filters]);

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Website & { replayEnabled?: boolean }>(`/api/websites/${websiteId}`),
  });

  const listQuery = useQuery({
    queryKey: ['replays', websiteId, listQs],
    enabled: Boolean(websiteId),
    queryFn: () => api<ReplayRow[]>(`/api/websites/${websiteId}/replays?${listQs}`),
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

  const replayEnabled = Boolean(websiteQuery.data?.replayEnabled);
  const visits = useMemo(
    () => (listQuery.data ?? []).filter((row) => replayMatchesFilter(row, replayFilter)),
    [listQuery.data, replayFilter],
  );
  const savedReplays = useMemo(() => savedQuery.data ?? [], [savedQuery.data]);
  const savedVisitIds = useMemo(() => new Set(savedReplays.map((replay) => replay.visitId)), [savedReplays]);
  const selectedReplay = useMemo(
    () =>
      visits.find((row) => row.visitId === selectedVisit) ??
      savedReplays.find((row) => row.visitId === selectedVisit) ??
      null,
    [savedReplays, selectedVisit, visits],
  );
  const selectedSessionId = selectedReplay?.sessionId ?? null;

  // Custom events, errors and logs of the visit, shown on the player timeline.
  const activityQuery = useQuery({
    queryKey: ['replay-activity', websiteId, selectedSessionId],
    enabled: Boolean(websiteId && selectedSessionId),
    staleTime: 60_000,
    queryFn: () => api<AnalyticsEvent[]>(`/api/websites/${websiteId}/sessions/${selectedSessionId}/activity`),
  });
  const analytics = useMemo(
    () => (activityQuery.data ?? []).filter((event) => !event.visitId || event.visitId === selectedVisit),
    [activityQuery.data, selectedVisit],
  );

  useEffect(() => {
    if (!selectedReplay || savedVisitIds.has(selectedReplay.visitId)) {
      setSaveName('');
      return;
    }
    setSaveName(`Replay ${formatDateTime(selectedReplay.startedAt ?? Date.now())}`);
  }, [selectedReplay, savedVisitIds]);

  async function copyLinkAt(ms: number) {
    if (!selectedVisit) return;
    const base = new URL(`${window.location.origin}/websites/${websiteId}/replays`);
    base.searchParams.set('visit', selectedVisit);
    try {
      await navigator.clipboard.writeText(linkAtTime(base.toString(), ms));
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1500);
    } catch {
      setCopiedLink(false);
    }
  }

  const events = detailQuery.data?.events ?? [];

  return (
    <Page className="page-replays">
      <PageHeader
        title={t('sessionReplays')}
        lead={t('replaysVisitsLead')}
        actions={<WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />}
      />

      <PageBody>
        {!replayEnabled && websiteQuery.data ? (
          <div className="section-gap">
            <EmptyState title={t('replayDisabledHint')} description={t('replaysVisitsLead')}>
              <Button asChild variant="primary">
                <Link to={`/websites/${websiteId}/settings`}>{t('goToReplaySettings')}</Link>
              </Button>
            </EmptyState>
          </div>
        ) : null}

        {replayEnabled ? (
          <MasterDetailLayout
            className="master-detail-layout--replays section-gap"
            wrapList={false}
            list={
              <section className="panel">
                <h2 className="section-title">{t('replaysVisits')}</h2>
                <div className="replays-filters">
                  <div className="replays-filters-grid">
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
                    <select
                      className="select"
                      value={sort}
                      onChange={(event) => setSort(event.target.value as ReplaySort)}
                      aria-label={t('replaySort')}
                    >
                      {SORTS.map((value) => (
                        <option key={value} value={value}>
                          {t(`replaySort_${value}`)}
                        </option>
                      ))}
                    </select>
                    <select
                      className="select"
                      value={String(minDuration)}
                      onChange={(event) => setMinDuration(Number(event.target.value))}
                      aria-label={t('replayMinDuration')}
                    >
                      {MIN_DURATIONS.map((value) => (
                        <option key={value} value={String(value)}>
                          {value ? `≥ ${formatDurationMs(value)}` : t('replayAnyDuration')}
                        </option>
                      ))}
                    </select>
                    <Input
                      value={person}
                      onChange={(event) => setPerson(event.target.value)}
                      placeholder={t('replayPersonPlaceholder')}
                      aria-label={t('replayPersonPlaceholder')}
                    />
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowMore((value) => !value)}>
                    {showMore ? t('replayFewerFilters') : t('replayMoreFilters')}
                    {!showMore && (eventName || url || filters.length) ? ` (${[eventName, url].filter(Boolean).length + filters.length})` : ''}
                  </Button>
                  {showMore ? (
                    <>
                      <Input
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder={t('replayUrlPlaceholder')}
                        aria-label={t('replayUrlPlaceholder')}
                      />
                      <Input
                        value={eventName}
                        onChange={(event) => setEventName(event.target.value)}
                        placeholder={t('replayEventPlaceholder')}
                        aria-label={t('replayEventPlaceholder')}
                      />
                      <PropertyFilterBuilder
                        websiteId={websiteId}
                        rangeQs={rangeQs}
                        value={filters}
                        onChange={setFilters}
                        addLabel={t('replayAddPropertyFilter')}
                      />
                    </>
                  ) : null}
                  {listQuery.error ? <p className="text-danger">{(listQuery.error as Error).message}</p> : null}
                </div>
                {savedReplays.length ? (
                  <div className="replays-saved-list">
                    <h3 className="section-title experiment-title">{t('savedReplays')}</h3>
                    {savedReplays.map((saved) => (
                      <div key={saved.id} className="replays-saved-item">
                        <button type="button" className="replays-saved-open" onClick={() => selectVisit(saved.visitId)}>
                          <strong>{saved.name}</strong>
                          <span className="text-muted">
                            {formatNumber(saved.eventCount)} {t('replayEventsLabel')} ·{' '}
                            {formatDateTime(saved.startedAt ?? saved.createdAt)}
                          </span>
                          <ReplayMetaBadges replay={saved} />
                        </button>
                        <Button
                          type="button"
                          variant="destructive-ghost"
                          size="sm"
                          onClick={() =>
                            confirm({ title: deleteTitle(saved.name), onConfirm: () => deleteSavedMutation.mutate(saved.id) })
                          }
                        >
                          {t('delete')}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {listQuery.isLoading ? <Skeleton className="h-6 w-1/2" /> : null}
                <ul className="replays-list">
                  {visits.map((r) => (
                    <MasterDetailSelectableItem
                      key={r.visitId}
                      as="li"
                      className="replays-list-item"
                      selectedClassName="selected"
                      selected={selectedVisit === r.visitId}
                      onSelect={() => selectVisit(r.visitId)}
                    >
                      <div>{formatDateTime(r.startedAt)}</div>
                      {r.entryPath ? <div className="field-hint replays-list-meta">{r.entryPath}</div> : null}
                      {replayWho(r) ? <div className="field-hint replays-list-meta">{replayWho(r)}</div> : null}
                      <ReplayMetaBadges replay={r} />
                    </MasterDetailSelectableItem>
                  ))}
                </ul>
                {!listQuery.isLoading && !visits.length ? <p className="text-muted">{t('noReplaysYet')}</p> : null}
              </section>
            }
            detail={
              <section className="panel replays-player-panel">
                <header className="panel-header">
                  <div>
                    <h2 className="section-title">{t('replayViewer')}</h2>
                    {selectedReplay ? (
                      <p className="text-muted">
                        {formatDateTime(selectedReplay.startedAt ?? Date.now())} · {formatDurationMs(selectedReplay.durationMs)} ·{' '}
                        {formatNumber(selectedReplay.eventCount)} {t('replayEventsLabel')}
                      </p>
                    ) : null}
                  </div>
                </header>
                {selectedVisit && !savedVisitIds.has(selectedVisit) && canEdit ? (
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
                {selectedVisit && savedVisitIds.has(selectedVisit) ? (
                  <p className="text-muted replay-saved-note">{t('replayAlreadySaved')}</p>
                ) : null}
                {saveMutation.error ? <p className="text-danger">{(saveMutation.error as Error).message}</p> : null}
                {!selectedVisit ? <p className="text-muted">{t('replaysVisitsLead')}</p> : null}
                {selectedVisit && detailQuery.isLoading ? <div className="skeleton" style={{ height: '3rem' }} /> : null}
                {selectedVisit && detailQuery.data && !events.length ? (
                  <p className="text-muted">{t('noReplayEvents')}</p>
                ) : null}
                {selectedVisit && events.length ? (
                  <ReplayPlayer
                    key={selectedVisit}
                    events={events}
                    analytics={analytics}
                    initialOffsetMs={selectedVisit === linkStart.visit ? linkStart.ms : 0}
                    actions={(currentMs) => (
                      <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => void copyLinkAt(currentMs)}>
                          {copiedLink ? t('copied') : t('replayCopyLinkAtTime')}
                        </Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setShareAt(currentMs)}>
                          {t('replayShare')}
                        </Button>
                      </>
                    )}
                  />
                ) : null}
              </section>
            }
          />
        ) : null}
        {shareAt !== null && selectedVisit && websiteId ? (
          <ReplayShareDialog
            websiteId={websiteId}
            visitId={selectedVisit}
            currentMs={shareAt}
            canEdit={canEdit}
            onClose={() => setShareAt(null)}
          />
        ) : null}
      </PageBody>
    </Page>
  );
}
