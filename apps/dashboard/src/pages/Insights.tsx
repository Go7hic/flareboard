import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  Eye,
  Funnel,
  Lightbulb,
  Mail,
  Pencil,
  Play,
  Plus,
  Repeat,
  Route,
  Share2,
  Table2,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { FunnelActorsResult, InsightQuery, InsightResult, InsightType } from '@flareboard/shared/insight-query';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { InsightAlertsPanel } from '../components/InsightAlertsPanel';
import { InsightQueryEditor, insightQueryProblem } from '../components/InsightQueryEditor';
import { InsightResultView, breakdownLabel, type FunnelDrill } from '../components/InsightResultView';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  ResourceSearchField,
} from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { ShareLinksDialog } from '../components/ShareLinksDialog';
import { SubscriptionsDialog } from '../components/SubscriptionsDialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { RangeSegmented } from '../components/workspace/RangeSegmented';
import { pickWorkspaceWebsite, rememberWorkspaceWebsite } from '../components/workspace/workspaceWebsite';
import { completeFilters } from '../lib/websiteReportApi';
import { api, type Insight, type Website } from '../lib/api';
import { presetToRange, rangeQueryString } from '../lib/dateRange';
import { formatDateTime, formatNumber, formatRelativeTime, shortId } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

const INSIGHT_TYPE_OPTIONS: InsightType[] = ['trend', 'funnel', 'retention', 'lifecycle', 'stickiness', 'path', 'table'];
const RANGE_PRESETS = ['7d', '30d', '90d'] as const;
type InsightRange = (typeof RANGE_PRESETS)[number];

const TYPE_ICONS: Record<InsightType, LucideIcon> = {
  trend: ChartLine,
  funnel: Funnel,
  retention: Repeat,
  lifecycle: ChartColumnStacked,
  stickiness: ChartColumn,
  path: Route,
  table: Table2,
};

type Draft = { name: string; description: string; type: InsightType; query: InsightQuery };

function defaultQuery(type: InsightType): InsightQuery {
  switch (type) {
    case 'trend':
      return { version: 2, interval: 'day', series: [{ kind: 'pageview', math: 'total' }] };
    case 'funnel':
      return {
        version: 2,
        countBy: 'person',
        funnel: {
          steps: [
            { kind: 'pageview' },
            { kind: 'event', event: null },
          ],
          window: { value: 14, unit: 'day' },
          order: 'strict',
        },
      };
    case 'retention':
      return {
        version: 2,
        countBy: 'person',
        retention: { startEvent: { kind: 'pageview' }, returnEvent: { kind: 'pageview' }, period: 'week', periods: 8 },
      };
    case 'lifecycle':
      return { version: 2, interval: 'day', countBy: 'person', series: [{ kind: 'pageview', math: 'total' }] };
    case 'stickiness':
      return { version: 2, countBy: 'person', series: [{ kind: 'all', math: 'total' }] };
    case 'path':
      return { version: 2, path: { steps: [], limit: 20 } };
    case 'table':
      return { version: 2, table: { dimension: 'path', limit: 10 } };
  }
}

function typeLabel(type: InsightType | string) {
  const key = `insightType${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  const label = t(key);
  return label === key ? t('insight') : label;
}

function newDraft(type: InsightType = 'trend'): Draft {
  return { name: typeLabel(type), description: '', type, query: defaultQuery(type) };
}

function draftFrom(insight: Insight): Draft {
  return {
    name: insight.name,
    description: insight.description,
    type: insight.type,
    query: insight.query?.version === 2 ? insight.query : defaultQuery(insight.type),
  };
}

/** Drop incomplete filter rows (still being edited) before sending the query. */
function runnableQuery(query: InsightQuery): InsightQuery {
  const clean = <T extends { filters?: InsightQuery['filters'] }>(item: T): T =>
    item.filters ? { ...item, filters: completeFilters(item.filters) } : item;
  return {
    ...query,
    filters: query.filters ? completeFilters(query.filters) : undefined,
    formula: query.formula?.trim() || null,
    series: query.series?.map(clean),
    funnel: query.funnel ? { ...query.funnel, steps: query.funnel.steps.map(clean) } : undefined,
    retention: query.retention
      ? {
          ...query.retention,
          startEvent: query.retention.startEvent ? clean(query.retention.startEvent) : undefined,
          returnEvent: query.retention.returnEvent ? clean(query.retention.returnEvent) : undefined,
        }
      : undefined,
  };
}

/** Actors shown before "Show all" in a funnel drill-down. */
const ACTOR_PREVIEW = 24;

function FunnelActorsPanel({
  websiteId,
  data,
  drill,
  onClose,
}: {
  websiteId: string;
  data: FunnelActorsResult;
  drill: FunnelDrill;
  onClose: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const actors = showAll ? data.actors : data.actors.slice(0, ACTOR_PREVIEW);
  return (
    <section className="detail-section ws-actors">
      <div className="ws-result-toolbar">
        <div>
          <h4 className="card-title">
            {drill.outcome === 'converted' ? t('insightConverted') : t('insightDroppedOff')} · {t('insightStep')} {drill.step + 1}
            {drill.breakdownValue !== undefined || drill.breakdownOther
              ? ` · ${breakdownLabel(drill.breakdownValue, drill.breakdownOther)}`
              : ''}
          </h4>
          <p className="card-description">
            {t('insightActorsShown').replace('{shown}', formatNumber(data.actors.length)).replace('{total}', formatNumber(data.total))}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('close')} title={t('close')}>
          <X aria-hidden />
        </Button>
      </div>
      {data.actors.length ? (
        <>
          <ul className="ws-actor-list">
            {actors.map((actor) => (
              <li key={actor}>
                {data.countBy === 'session' ? (
                  <Link className="ws-actor" title={actor} to={`/websites/${websiteId}/sessions/${encodeURIComponent(actor)}`}>
                    {shortId(actor, 13)}
                  </Link>
                ) : (
                  <code className="ws-actor" title={actor}>
                    {shortId(actor, 13)}
                  </code>
                )}
              </li>
            ))}
          </ul>
          {data.actors.length > ACTOR_PREVIEW ? (
            <button type="button" className="card-footer-link ws-actors-more" onClick={() => setShowAll((value) => !value)}>
              {showAll ? t('workspaceShowFewer') : `${t('workspaceShowAll')} (${formatNumber(data.actors.length)})`}
            </button>
          ) : null}
        </>
      ) : (
        <EmptyState title={t('noDataInPeriod')} />
      )}
    </section>
  );
}

function ResultSkeleton() {
  return (
    <div className="ws-result" aria-hidden>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-[260px] w-full" />
    </div>
  );
}

export default function InsightsPage() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedInsightId = searchParams.get('insight');
  const [websiteId, setWebsiteId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState<Draft>(() => newDraft());
  const [preset, setPreset] = useState<InsightRange>('30d');
  const [drill, setDrill] = useState<FunnelDrill | null>(null);
  const [dialog, setDialog] = useState<'share' | 'subscribe' | null>(null);
  const [search, setSearch] = useState('');
  /** Last preview result, kept on screen while a new run is in flight. */
  const [lastPreview, setLastPreview] = useState<InsightResult | null>(null);

  const websitesQuery = useQuery({
    queryKey: ['websites'],
    queryFn: () => api<Website[]>('/api/websites'),
  });
  const websites = useMemo(() => websitesQuery.data ?? [], [websitesQuery.data]);
  const website = websites.find((w) => w.id === websiteId);
  const timezone = website?.timezone ?? 'UTC';
  const range = useMemo(() => presetToRange(preset, undefined, undefined, timezone), [preset, timezone]);
  const rangeQs = rangeQueryString(range.startAt, range.endAt);
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId, 'analytics');
  const problem = insightQueryProblem(draft.type, draft.query);

  // Without a remembered choice, open the website whose insight changed most recently.
  const allInsightsQuery = useQuery({
    queryKey: ['insights-all'],
    enabled: websites.length > 1,
    queryFn: () => api<Insight[]>('/api/insights'),
  });

  useEffect(() => {
    if (websiteId || linkedInsightId || !websites.length) return;
    if (websites.length > 1 && allInsightsQuery.isLoading) return;
    const latest = [...(allInsightsQuery.data ?? [])].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
    setWebsiteId(pickWorkspaceWebsite(websites, latest?.websiteId));
  }, [websiteId, websites, linkedInsightId, allInsightsQuery.isLoading, allInsightsQuery.data]);

  const insightsQuery = useQuery({
    queryKey: ['insights', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Insight[]>(`/api/insights?websiteId=${websiteId}`),
  });
  const insights = useMemo(
    () =>
      [...(insightsQuery.data ?? [])].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name)),
    [insightsQuery.data],
  );
  const visibleInsights = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return insights;
    return insights.filter((insight) => insight.name.toLowerCase().includes(needle) || typeLabel(insight.type).toLowerCase().includes(needle));
  }, [insights, search]);

  // Deep links from boards, notebooks and alert emails: /insights?insight=<id>.
  const linkedInsightQuery = useQuery({
    queryKey: ['insight', linkedInsightId],
    enabled: Boolean(linkedInsightId) && linkedInsightId !== selectedId,
    queryFn: () => api<Insight>(`/api/insights/${linkedInsightId}`),
  });

  useEffect(() => {
    const linked = linkedInsightQuery.data;
    if (linked && linked.id === linkedInsightId && linked.id !== selectedId) selectInsight(linked);
    // A link to an insight that is gone (or not ours) falls back to the default website.
    if (linkedInsightQuery.isError) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedInsightQuery.data, linkedInsightQuery.isError, linkedInsightId]);

  const selectedInsight = selectedId ? insights.find((insight) => insight.id === selectedId) : undefined;

  // Lead with an answer: open the most recent insight when nothing is selected.
  useEffect(() => {
    if (mode !== 'view' || selectedId || linkedInsightId || !insights.length) return;
    setSelectedId(insights[0]!.id);
  }, [mode, selectedId, linkedInsightId, insights]);

  const runQuery = useQuery({
    queryKey: ['insight-run', selectedId, rangeQs],
    enabled: mode === 'view' && Boolean(selectedInsight),
    queryFn: () => api<{ data: InsightResult }>(`/api/insights/${selectedId}/run?${rangeQs}`),
    // Keep the chart while the range changes, but never show another insight's result.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === selectedId ? previous : undefined),
  });

  const previewMutation = useMutation({
    mutationFn: (input: { type: InsightType; query: InsightQuery; rangeQs: string }) =>
      api<{ data: InsightResult }>(`/api/insights/preview?websiteId=${websiteId}&${input.rangeQs}`, {
        method: 'POST',
        body: JSON.stringify({ type: input.type, query: runnableQuery(input.query) }),
      }),
    onMutate: () => setDrill(null),
    onSuccess: (response) => setLastPreview(response.data),
  });

  const activeQuery = mode === 'edit' ? draft.query : selectedInsight?.query;
  const actorsMutation = useMutation({
    mutationFn: (next: FunnelDrill) =>
      api<FunnelActorsResult>(`/api/insights/funnel-actors?websiteId=${websiteId}&${rangeQs}`, {
        method: 'POST',
        body: JSON.stringify({ type: 'funnel', query: runnableQuery(activeQuery ?? defaultQuery('funnel')), ...next, limit: 100 }),
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        websiteId,
        name: draft.name,
        description: draft.description,
        type: draft.type,
        query: runnableQuery(draft.query),
      });
      if (selectedId) return api<Insight>(`/api/insights/${selectedId}`, { method: 'PATCH', body });
      return api<Insight>('/api/insights', { method: 'POST', body });
    },
    onSuccess: (insight) => {
      setSelectedId(insight.id);
      setMode('view');
      if (searchParams.get('insight') !== insight.id) setSearchParams({ insight: insight.id }, { replace: true });
      queryClient.invalidateQueries({ queryKey: ['insights', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['insights-all'] });
      queryClient.invalidateQueries({ queryKey: ['insight-run', insight.id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/insights/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSelectedId(null);
      setMode('view');
      if (searchParams.has('insight')) setSearchParams({}, { replace: true });
      queryClient.invalidateQueries({ queryKey: ['insights', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['insights-all'] });
    },
  });

  function resetResults() {
    previewMutation.reset();
    setLastPreview(null);
    actorsMutation.reset();
    saveMutation.reset();
    setDrill(null);
  }

  function selectInsight(insight: Insight) {
    resetResults();
    setSelectedId(insight.id);
    setMode('view');
    if (searchParams.get('insight') !== insight.id) setSearchParams({ insight: insight.id }, { replace: true });
    setWebsiteId(insight.websiteId);
    rememberWorkspaceWebsite(insight.websiteId);
  }

  function runPreview(next: Draft = draft) {
    if (!websiteId || insightQueryProblem(next.type, next.query)) return;
    previewMutation.mutate({ type: next.type, query: next.query, rangeQs });
  }

  function startEdit() {
    if (!selectedInsight) return;
    resetResults();
    const next = draftFrom(selectedInsight);
    setDraft(next);
    setMode('edit');
    runPreview(next);
  }

  function startNew() {
    resetResults();
    setSelectedId(null);
    if (searchParams.has('insight')) setSearchParams({}, { replace: true });
    const next = newDraft();
    setDraft(next);
    setMode('edit');
    runPreview(next);
  }

  function cancelEdit() {
    resetResults();
    setMode('view');
  }

  function changeWebsite(next: string) {
    resetResults();
    setSelectedId(null);
    setMode('view');
    setSearch('');
    if (searchParams.has('insight')) setSearchParams({}, { replace: true });
    setWebsiteId(next);
    rememberWorkspaceWebsite(next);
  }

  function changeType(next: InsightType) {
    resetResults();
    setDraft((current) => ({
      ...current,
      type: next,
      query: defaultQuery(next),
      name: selectedId ? current.name : typeLabel(next),
    }));
  }

  // A new range re-runs the preview that is on screen.
  useEffect(() => {
    if (mode === 'edit' && lastPreview) runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeQs]);

  const drillHandler = (next: FunnelDrill) => {
    setDrill(next);
    actorsMutation.mutate(next);
  };

  const actorsPanel = drill ? (
    <DataViewState
      loading={actorsMutation.isPending}
      error={actorsMutation.isError ? actorsMutation.error : null}
      onRetry={() => actorsMutation.mutate(drill)}
      loadingFallback={<Skeleton className="mt-4 h-24 w-full" />}
    >
      {actorsMutation.data ? (
        <FunnelActorsPanel websiteId={websiteId} data={actorsMutation.data} drill={drill} onClose={() => setDrill(null)} />
      ) : null}
    </DataViewState>
  ) : null;

  const headerActions = websites.length ? (
    <div className="ws-header-controls">
      <select
        className="select ws-header-select"
        aria-label={t('website')}
        value={websiteId}
        onChange={(event) => changeWebsite(event.target.value)}
      >
        {websites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
      {canEdit ? (
        <Button variant="primary" onClick={startNew} disabled={!websiteId}>
          <Plus aria-hidden />
          {t('newInsight')}
        </Button>
      ) : null}
    </div>
  ) : null;

  let detail;
  if (mode === 'edit') {
    detail = (
      <MasterDetailPane
        title={selectedId ? t('editInsight') : t('newInsight')}
        description={t('insightBuilderLead')}
        actions={
          <>
            <Button type="button" variant="ghost" onClick={cancelEdit}>
              {t('cancel')}
            </Button>
            {canEdit ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => saveMutation.mutate()}
                disabled={!websiteId || !draft.name.trim() || Boolean(problem) || saveMutation.isPending}
              >
                {selectedId ? t('saveChanges') : t('saveInsight')}
              </Button>
            ) : null}
          </>
        }
      >
        <div className="ws-insight-fields">
          {canEdit ? (
            <>
              <div className="field">
                <Label htmlFor="insight-name">{t('name')}</Label>
                <Input id="insight-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </div>
              <div className="field">
                <Label htmlFor="insight-description">{t('description')}</Label>
                <Input
                  id="insight-description"
                  value={draft.description}
                  placeholder={t('workspaceOptional')}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>
            </>
          ) : null}
          <div className="field">
            <Label htmlFor="insight-type">{t('type')}</Label>
            <select
              id="insight-type"
              className="select"
              value={draft.type}
              onChange={(event) => changeType(event.target.value as InsightType)}
            >
              {INSIGHT_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {typeLabel(option)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {websiteId ? (
          <InsightQueryEditor
            websiteId={websiteId}
            type={draft.type}
            query={draft.query}
            onChange={(query) => setDraft({ ...draft, query })}
            rangeQs={rangeQs}
          />
        ) : null}

        {problem ? (
          <p className="ws-q-problem" role="status">
            {problem}
          </p>
        ) : null}
        {saveMutation.error ? (
          <p className="text-danger" role="alert">
            {(saveMutation.error as Error).message}
          </p>
        ) : null}

        <section className="detail-section ws-insight-result">
          <div className="ws-result-toolbar">
            <h3 className="card-title">{t('insightPreview')}</h3>
            <div className="ws-result-toolbar-end">
              <RangeSegmented value={preset} options={RANGE_PRESETS} onChange={setPreset} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => runPreview()}
                disabled={!websiteId || Boolean(problem) || previewMutation.isPending}
              >
                <Play aria-hidden />
                {t('workspaceRunQuery')}
              </Button>
            </div>
          </div>
          <DataViewState
            loading={previewMutation.isPending && !lastPreview}
            error={previewMutation.isError ? previewMutation.error : null}
            onRetry={() => runPreview()}
            loadingFallback={<ResultSkeleton />}
          >
            {lastPreview ? (
              <div className={previewMutation.isPending ? 'ws-refreshing' : undefined}>
                <InsightResultView result={lastPreview} onFunnelDrill={drillHandler} />
              </div>
            ) : (
              <EmptyState icon={<Play />} title={t('insightPreviewEmptyTitle')} description={t('workspacePreviewEmptyBody')} />
            )}
          </DataViewState>
          {actorsPanel}
        </section>
      </MasterDetailPane>
    );
  } else if (selectedInsight) {
    const Icon = TYPE_ICONS[selectedInsight.type] ?? Lightbulb;
    detail = (
      <MasterDetailPane
        title={selectedInsight.name}
        description={selectedInsight.description || undefined}
        meta={
          <>
            <span className="ws-type-chip">
              <Icon aria-hidden />
              {typeLabel(selectedInsight.type)}
            </span>
            {website ? <span>{website.name}</span> : null}
            {selectedInsight.updatedAt ? (
              <span title={formatDateTime(selectedInsight.updatedAt)}>
                {t('workspaceUpdatedAgo').replace('{time}', formatRelativeTime(selectedInsight.updatedAt))}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDialog('share')}>
              <Share2 aria-hidden />
              {t('shareInsight')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDialog('subscribe')}>
              <Mail aria-hidden />
              {t('subscribe')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={startEdit}>
              <Pencil aria-hidden />
              {canEdit ? t('edit') : t('workspaceExploreQuery')}
            </Button>
            {canEdit ? (
              <Button
                type="button"
                variant="destructive-ghost"
                size="icon-sm"
                aria-label={t('delete')}
                title={t('delete')}
                onClick={() =>
                  confirm({ title: deleteTitle(selectedInsight.name), onConfirm: () => deleteMutation.mutate(selectedInsight.id) })
                }
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}
          </>
        }
      >
        <div className="ws-result-toolbar">
          <span className="ws-result-range" title={`${formatDateTime(range.startAt)} – ${formatDateTime(range.endAt)}`}>
            {t(`datePreset${preset}`)}
          </span>
          <RangeSegmented value={preset} options={RANGE_PRESETS} onChange={setPreset} />
        </div>
        <DataViewState
          loading={runQuery.isLoading}
          error={runQuery.isError ? runQuery.error : null}
          onRetry={() => runQuery.refetch()}
          loadingFallback={<ResultSkeleton />}
        >
          {runQuery.data?.data ? (
            <div className={runQuery.isPlaceholderData ? 'ws-refreshing' : undefined}>
              <InsightResultView result={runQuery.data.data} onFunnelDrill={drillHandler} />
            </div>
          ) : null}
        </DataViewState>
        {actorsPanel}
        {selectedInsight.type === 'trend' ? <InsightAlertsPanel insight={selectedInsight} canEdit={canEdit} /> : null}
      </MasterDetailPane>
    );
  } else {
    detail = (
      <div className="master-detail-pane ws-pane-empty">
        <EmptyState
          icon={<Lightbulb />}
          title={insights.length ? t('workspacePickInsight') : t('insightsEmptyTitle')}
          description={insights.length ? t('workspacePickInsightBody') : t('insightsEmptyBody')}
          action={
            canEdit ? (
              <Button variant="primary" size="sm" onClick={startNew}>
                <Plus aria-hidden />
                {t('newInsight')}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <Page className="ws-page-insights">
      <PageHeader title={t('insights')} lead={t('workspaceInsightsLead')} actions={headerActions} />

      <PageBody className="stack">
        {viewOnly ? (
          <p className="ws-notice">
            <Eye aria-hidden />
            {t('viewOnlyHint')}
          </p>
        ) : null}

        {!websitesQuery.isLoading && !websites.length ? (
          <EmptyState
            variant="rich"
            icon={<Lightbulb />}
            title={t('noWebsites')}
            description={t('workspaceReportsNoWebsite')}
            action={
              <Button variant="primary" render={<Link to="/websites?new=1" />}>
                {t('addWebsite')}
              </Button>
            }
          />
        ) : (
          <MasterDetailLayout
            listClassName="ws-md-list"
            listHeader={
              <>
                <ResourceSearchField
                  value={search}
                  onChange={setSearch}
                  placeholder={t('workspaceSearchInsights')}
                  aria-label={t('workspaceSearchInsights')}
                />
                <span className="master-detail-list-count">
                  {t('workspaceInsightCount').replace('{count}', formatNumber(insights.length))}
                </span>
              </>
            }
            list={
              <DataViewState
                loading={insightsQuery.isLoading || (!websiteId && websitesQuery.isLoading)}
                error={insightsQuery.isError ? insightsQuery.error : null}
                onRetry={() => insightsQuery.refetch()}
                loadingFallback={
                  <div className="ws-list-skeleton">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                }
              >
                {visibleInsights.length ? (
                  <>
                    {visibleInsights.map((insight) => {
                      const Icon = TYPE_ICONS[insight.type] ?? Lightbulb;
                      return (
                        <MasterDetailListItem
                          key={insight.id}
                          selected={selectedId === insight.id}
                          onSelect={() => selectInsight(insight)}
                          icon={<Icon aria-hidden />}
                          title={insight.name}
                          subtitle={typeLabel(insight.type)}
                          meta={
                            insight.updatedAt ? (
                              <span title={formatDateTime(insight.updatedAt)}>{formatRelativeTime(insight.updatedAt)}</span>
                            ) : undefined
                          }
                        />
                      );
                    })}
                  </>
                ) : (
                  <EmptyState
                    icon={<Lightbulb />}
                    title={insights.length ? t('workspaceNoMatches') : t('insightsEmptyTitle')}
                    description={insights.length ? t('workspaceNoMatchesHint') : t('workspaceInsightsEmptyShort')}
                  />
                )}
              </DataViewState>
            }
            detail={detail}
          />
        )}
      </PageBody>

      {dialog === 'share' && selectedInsight ? (
        <ShareLinksDialog
          entityType="insight"
          entityId={selectedInsight.id}
          entityName={selectedInsight.name}
          canEdit={canEdit}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'subscribe' && selectedInsight ? (
        <SubscriptionsDialog
          targetType="insight"
          targetId={selectedInsight.id}
          targetName={selectedInsight.name}
          canEdit={canEdit}
          timezone={timezone}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Page>
  );
}
