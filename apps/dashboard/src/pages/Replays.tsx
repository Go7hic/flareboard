import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  Link2,
  Monitor,
  Play,
  PlayCircle,
  Share2,
  Smartphone,
  Tablet,
  Video,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { PropertyFilterBuilder } from '../components/PropertyFilterBuilder';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { ReplayShareDialog } from '../components/ReplayShareDialog';
import { StatusBadge } from '../components/StatusBadge';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { InlineSelect, Segmented } from '../components/behavior/QueryCard';
import { SaveReplayDialog } from '../components/behavior/SaveReplayDialog';
import { MasterDetailLayout, MasterDetailListItem } from '../components/master-detail';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { api, type Website } from '../lib/api';
import {
  formatDateTime,
  formatDurationMs,
  formatNumber,
  formatRelativeTime,
  formatShortDateTime,
  shortId,
} from '../lib/format';
import { t } from '../lib/i18n';
import { getCountryLabel } from '../lib/map-format';
import { linkAtTime, parseStartParam, type AnalyticsEvent } from '../lib/replay-timeline';
import { countryFlagEmoji, formatDeviceLabel } from '../lib/session-display';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { cn } from '../lib/utils';

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
type ListTab = 'visits' | 'saved';

function replayMatchesFilter(replay: ReplayRow | SavedReplay, filter: ReplayFilter) {
  if (filter === 'logs') return replay.logs > 0;
  if (filter === 'ai') return replay.aiCalls > 0;
  if (filter === 'issues') return replay.errors > 0 || replay.logs > 0 || Boolean('consoleErrorCount' in replay && replay.consoleErrorCount);
  return true;
}

/**
 * Errors seen in the visit. An uncaught exception is usually both an error event and a recorded
 * console error, so the larger of the two counts stands in for both instead of their sum.
 */
function errorCount(replay: ReplayRow | SavedReplay) {
  return Math.max(replay.errors, (replay as ReplayRow).consoleErrorCount ?? 0);
}

function countLabel(n: number, one: string, many: string) {
  return (n === 1 ? t(one) : t(many)).replace('{n}', formatNumber(n));
}

/** "40s · 2 pages · 3 clicks" */
function replayStats(replay: ReplayRow | SavedReplay) {
  const parts = [formatDurationMs(replay.durationMs), countLabel(replay.pageviews, 'behaviorReplayPageOne', 'behaviorReplayPagesN')];
  const clicks = (replay as ReplayRow).clickCount;
  if (clicks != null) parts.push(countLabel(clicks, 'behaviorReplayClickOne', 'behaviorReplayClicksN'));
  return parts.join(' · ');
}

function DeviceIcon({ device }: { device?: string | null }) {
  const key = device?.toLowerCase();
  if (key === 'mobile') return <Smartphone aria-hidden strokeWidth={2} />;
  if (key === 'tablet') return <Tablet aria-hidden strokeWidth={2} />;
  return <Monitor aria-hidden strokeWidth={2} />;
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
  const [replayFilter, setReplayFilter] = useState<ReplayFilter>('all');
  const [sort, setSort] = useState<ReplaySort>('newest');
  const [minDuration, setMinDuration] = useState(0);
  const [person, setPerson] = useState('');
  const [eventName, setEventName] = useState('');
  const [url, setUrl] = useState('');
  const [filters, setFilters] = useState<PropertyFilter[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [listTab, setListTab] = useState<ListTab>('visits');
  const [shareAt, setShareAt] = useState<number | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const playheadRef = useRef(0);

  const debouncedPerson = useDebouncedValue(person.trim(), 400);
  const debouncedEvent = useDebouncedValue(eventName.trim(), 400);
  const debouncedUrl = useDebouncedValue(url.trim(), 400);

  const selectVisit = (visitId: string | null) => {
    playheadRef.current = 0;
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
    placeholderData: keepPreviousData,
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
    mutationFn: (name: string) =>
      api<SavedReplay>(`/api/websites/${websiteId}/replays/saved`, {
        method: 'POST',
        body: JSON.stringify({ visitId: selectedVisit, name }),
      }),
    onSuccess: () => {
      setSaveOpen(false);
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
  const savedByVisit = useMemo(() => new Map(savedReplays.map((replay) => [replay.visitId, replay])), [savedReplays]);
  const selectedRow = visits.find((row) => row.visitId === selectedVisit) ?? null;
  const selectedSaved = selectedVisit ? (savedByVisit.get(selectedVisit) ?? null) : null;
  const selectedReplay: ReplayRow | SavedReplay | null = selectedRow ?? selectedSaved;
  const selectedSessionId = selectedReplay?.sessionId ?? null;
  const withErrors = visits.filter((row) => errorCount(row) > 0).length;

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

  const extraFilterCount = [eventName, url].filter(Boolean).length + filters.length;
  const events = detailQuery.data?.events ?? [];

  const toolbar = replayEnabled ? (
    <div className="behavior-toolbar">
      <InlineSelect
        label={t('behaviorReplayShow')}
        value={replayFilter}
        onChange={(value) => setReplayFilter(value as ReplayFilter)}
        options={[
          { value: 'all', label: t('allReplays') },
          { value: 'issues', label: t('replaysWithIssues') },
          { value: 'errors', label: t('replaysWithErrors') },
          { value: 'logs', label: t('replaysWithLogs') },
          { value: 'ai', label: t('replaysWithAi') },
        ]}
      />
      <InlineSelect
        label={t('behaviorReplaySort')}
        value={sort}
        onChange={(value) => setSort(value as ReplaySort)}
        options={SORTS.map((value) => ({ value, label: t(`replaySort_${value}`) }))}
      />
      <InlineSelect
        label={t('behaviorReplayDuration')}
        value={String(minDuration)}
        onChange={(value) => setMinDuration(Number(value))}
        options={MIN_DURATIONS.map((value) => ({
          value: String(value),
          label: value ? `≥ ${formatDurationMs(value)}` : t('replayAnyDuration'),
        }))}
      />
      <Input
        className="behavior-toolbar-input"
        value={person}
        onChange={(event) => setPerson(event.target.value)}
        placeholder={t('replayPersonPlaceholder')}
        aria-label={t('replayPersonPlaceholder')}
      />
      <Button type="button" variant="ghost" size="sm" onClick={() => setShowMore((value) => !value)} aria-expanded={showMore}>
        {showMore ? t('replayFewerFilters') : t('replayMoreFilters')}
        {!showMore && extraFilterCount ? ` (${extraFilterCount})` : ''}
      </Button>
      {showMore ? (
        <div className="behavior-toolbar-more">
          <Input
            className="behavior-toolbar-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t('replayUrlPlaceholder')}
            aria-label={t('replayUrlPlaceholder')}
          />
          <Input
            className="behavior-toolbar-input"
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
        </div>
      ) : null}
    </div>
  ) : null;

  const listHeader = (
    <div className="behavior-replay-list-head">
      {savedReplays.length ? (
        <Segmented
          value={listTab}
          onChange={setListTab}
          label={t('replaysVisits')}
          options={[
            { value: 'visits', label: `${t('replaysVisits')} ${formatNumber(visits.length)}` },
            { value: 'saved', label: `${t('behaviorReplaySavedTab')} ${formatNumber(savedReplays.length)}` },
          ]}
        />
      ) : (
        <span className="master-detail-list-count">
          {listQuery.isLoading ? t('loading') : countLabel(visits.length, 'behaviorReplayVisitOne', 'behaviorReplayVisitsN')}
        </span>
      )}
    </div>
  );

  const showSaved = listTab === 'saved' && savedReplays.length > 0;

  const list = showSaved ? (
    <div className="behavior-replay-list">
      {savedReplays.map((saved) => (
        <MasterDetailListItem
          key={saved.id}
          selected={selectedVisit === saved.visitId}
          onSelect={() => selectVisit(saved.visitId)}
          icon={<Bookmark aria-hidden strokeWidth={2} />}
          title={saved.name}
          subtitle={replayStats(saved)}
          meta={
            <span title={formatDateTime(saved.startedAt ?? saved.createdAt)}>
              {formatRelativeTime(saved.startedAt ?? saved.createdAt)}
            </span>
          }
        />
      ))}
    </div>
  ) : (
    <div className={cn('behavior-replay-list', listQuery.isPlaceholderData && 'behavior-refetching')}>
      {listQuery.isLoading ? (
        <div className="behavior-replay-list-skeleton" aria-hidden>
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row}>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : listQuery.error ? (
        <EmptyState
          title={t('dataLoadFailed')}
          description={(listQuery.error as Error).message}
          tone="danger"
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => listQuery.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : visits.length ? (
        visits.map((row) => {
          const errors = errorCount(row);
          return (
            <MasterDetailListItem
              key={row.visitId}
              selected={selectedVisit === row.visitId}
              onSelect={() => selectVisit(row.visitId)}
              icon={<DeviceIcon device={row.device} />}
              title={<span className="mono">{row.entryPath || '/'}</span>}
              subtitle={replayStats(row)}
              meta={
                <>
                  <span title={formatDateTime(row.startedAt)}>{formatRelativeTime(row.startedAt)}</span>
                  {errors ? (
                    <StatusBadge tone="danger" dot={false}>
                      {countLabel(errors, 'behaviorReplayErrorOne', 'behaviorReplayErrorsN')}
                    </StatusBadge>
                  ) : null}
                </>
              }
            />
          );
        })
      ) : (
        <EmptyState
          icon={<Video strokeWidth={2} />}
          title={t('behaviorReplaysNone')}
          description={t('behaviorReplaysNoneHint')}
        />
      )}
    </div>
  );

  let detail: ReactNode;
  if (!selectedVisit) {
    detail = (
      <div className="master-detail-pane behavior-replay-empty">
        <EmptyState
          icon={<PlayCircle strokeWidth={2} />}
          title={t('behaviorReplayPickTitle')}
          description={
            <>
              {visits.length ? (
                <span className="behavior-replay-empty-summary">
                  {countLabel(visits.length, 'behaviorReplayInPeriodOne', 'behaviorReplayInPeriodN')}
                  {withErrors ? ` · ${countLabel(withErrors, 'behaviorReplayWithErrorsOne', 'behaviorReplayWithErrorsN')}` : ''}
                </span>
              ) : null}
              {t('behaviorReplayPickHint')}
            </>
          }
          action={
            visits[0] ? (
              <Button type="button" variant="primary" onClick={() => selectVisit(visits[0]!.visitId)}>
                <Play aria-hidden />
                {t('behaviorReplayWatchLatest')}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  } else {
    detail = (
      <section className="master-detail-pane behavior-replay-detail" aria-label={t('replayViewer')}>
        <ReplayDetailHeader
          row={selectedRow}
          saved={selectedSaved}
          replay={selectedReplay}
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copyLinkAt(playheadRef.current)}
                title={t('replayCopyLinkAtTime')}
                disabled={!events.length}
              >
                <Link2 aria-hidden />
                {copiedLink ? t('copied') : t('behaviorReplayCopyLink')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShareAt(playheadRef.current)}
                disabled={!events.length}
              >
                <Share2 aria-hidden />
                {t('replayShare')}
              </Button>
              {selectedSaved ? (
                canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title={t('behaviorReplayRemoveSaved')}
                    onClick={() =>
                      confirm({
                        title: deleteTitle(selectedSaved.name),
                        onConfirm: () => deleteSavedMutation.mutate(selectedSaved.id),
                      })
                    }
                  >
                    <BookmarkCheck aria-hidden />
                    {t('behaviorReplaySaved')}
                  </Button>
                ) : (
                  <StatusBadge tone="neutral" dot={false}>
                    {t('behaviorReplaySaved')}
                  </StatusBadge>
                )
              ) : canEdit ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setSaveOpen(true)} disabled={!events.length}>
                  <Bookmark aria-hidden />
                  {t('behaviorReplaySave')}
                </Button>
              ) : null}
              {selectedSessionId ? (
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/websites/${websiteId}/sessions/${selectedSessionId}`}>
                    {t('viewSession')}
                    <ArrowUpRight aria-hidden />
                  </Link>
                </Button>
              ) : null}
            </>
          }
        />
        {detailQuery.isLoading ? (
          <div className="behavior-replay-stage-skeleton">
            <Skeleton className="h-full w-full" />
          </div>
        ) : detailQuery.isError ? (
          <EmptyState
            title={t('dataLoadFailed')}
            description={(detailQuery.error as Error).message}
            tone="danger"
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => detailQuery.refetch()}>
                {t('retry')}
              </Button>
            }
          />
        ) : events.length ? (
          <ReplayPlayer
            key={selectedVisit}
            events={events}
            analytics={analytics}
            initialOffsetMs={selectedVisit === linkStart.visit ? linkStart.ms : 0}
            playheadRef={playheadRef}
          />
        ) : (
          <EmptyState icon={<Video strokeWidth={2} />} title={t('behaviorReplayNoEvents')} description={t('noReplayEvents')} />
        )}
      </section>
    );
  }

  return (
    <Page className="page-replays">
      <PageHeader
        title={t('sessionReplays')}
        lead={t('behaviorReplaysLead')}
        actions={<WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />}
        toolbar={toolbar}
      />

      <PageBody>
        {websiteQuery.isLoading ? (
          <div className="master-detail-layout behavior-replays" aria-hidden>
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : !replayEnabled && websiteQuery.data ? (
          <EmptyState
            variant="rich"
            icon={<Video strokeWidth={2} />}
            title={t('replayDisabledHint')}
            description={t('behaviorReplayDisabledBody')}
            action={
              <Button asChild variant="primary">
                <Link to={`/websites/${websiteId}/settings`}>{t('goToReplaySettings')}</Link>
              </Button>
            }
          />
        ) : replayEnabled ? (
          <MasterDetailLayout className="master-detail-layout behavior-replays" listHeader={listHeader} list={list} detail={detail} />
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
        {saveOpen && selectedVisit ? (
          <SaveReplayDialog
            defaultName={
              selectedRow
                ? `${selectedRow.entryPath || '/'} · ${formatShortDateTime(selectedRow.startedAt)}`
                : `${t('sessionReplay')} · ${formatShortDateTime(Date.now())}`
            }
            pending={saveMutation.isPending}
            error={saveMutation.error ? (saveMutation.error as Error).message : null}
            onSave={(name) => saveMutation.mutate(name)}
            onClose={() => {
              setSaveOpen(false);
              saveMutation.reset();
            }}
          />
        ) : null}
      </PageBody>
    </Page>
  );
}

/** Title (entry page or saved name) and who / where / when of the visit, with its actions. */
function ReplayDetailHeader({
  row,
  saved,
  replay,
  actions,
}: {
  row: ReplayRow | null;
  saved: SavedReplay | null;
  replay: ReplayRow | SavedReplay | null;
  actions: ReactNode;
}) {
  const startedAt = replay?.startedAt ?? null;
  const errors = replay ? errorCount(replay) : 0;
  const facts: ReactNode[] = [];
  if (startedAt) {
    facts.push(
      <span key="when" title={formatDateTime(startedAt)}>
        {formatShortDateTime(startedAt)}
      </span>,
    );
  }
  if (replay) facts.push(<span key="duration">{formatDurationMs(replay.durationMs)}</span>);
  if (row?.country) {
    facts.push(
      <span key="country">
        {countryFlagEmoji(row.country)} {getCountryLabel(row.country)}
      </span>,
    );
  }
  const tech = [row?.browser, row?.os, row?.device ? formatDeviceLabel(row.device) : null].filter(Boolean);
  if (tech.length) facts.push(<span key="tech">{tech.join(' · ')}</span>);
  if (row?.distinctId) {
    facts.push(
      <span key="person" className="mono" title={row.distinctId}>
        {shortId(row.distinctId, 16)}
      </span>,
    );
  }

  const activity: ReactNode[] = [];
  if (replay) {
    activity.push(<span key="pages">{countLabel(replay.pageviews, 'behaviorReplayPageOne', 'behaviorReplayPagesN')}</span>);
    if (row?.clickCount != null) {
      activity.push(<span key="clicks">{countLabel(row.clickCount, 'behaviorReplayClickOne', 'behaviorReplayClicksN')}</span>);
    }
    if (replay.customEvents) {
      activity.push(<span key="events">{countLabel(replay.customEvents, 'behaviorReplayEventOne', 'behaviorReplayEventsN')}</span>);
    }
    if (replay.aiCalls) activity.push(<span key="ai">{formatNumber(replay.aiCalls)} {t('aiCalls')}</span>);
  }

  return (
    <header className="behavior-replay-head">
      <div className="behavior-replay-head-copy">
        <h2 className="behavior-replay-title">
          {saved ? (
            saved.name
          ) : row ? (
            <>
              <span className="behavior-replay-title-label">{t('behaviorReplayEntry')}</span>
              <span className="mono">{row.entryPath || '/'}</span>
            </>
          ) : (
            t('sessionReplay')
          )}
        </h2>
        {facts.length ? <div className="meta-line">{facts}</div> : null}
        {activity.length || errors || row?.networkErrorCount || replay?.logs ? (
          <div className="behavior-replay-activity">
            {activity.length ? <span className="meta-line">{activity}</span> : null}
            {errors ? (
              <StatusBadge tone="danger" dot={false}>
                {countLabel(errors, 'behaviorReplayErrorOne', 'behaviorReplayErrorsN')}
              </StatusBadge>
            ) : null}
            {row?.networkErrorCount ? (
              <StatusBadge tone="warning" dot={false}>
                {formatNumber(row.networkErrorCount)} {t('replayFailedRequests')}
              </StatusBadge>
            ) : null}
            {replay?.logs ? (
              <StatusBadge tone="neutral" dot={false}>
                {countLabel(replay.logs, 'behaviorReplayLogOne', 'behaviorReplayLogsN')}
              </StatusBadge>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="behavior-replay-actions">{actions}</div>
    </header>
  );
}
