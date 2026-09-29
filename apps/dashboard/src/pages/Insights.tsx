import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FunnelActorsResult, InsightQuery, InsightResult, InsightType } from '@flareboard/shared/insight-query';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { InsightQueryEditor, insightQueryProblem } from '../components/InsightQueryEditor';
import { InsightResultView, breakdownLabel, type FunnelDrill } from '../components/InsightResultView';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
} from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { ProductLineCrossLinks } from '../components/ProductLineCrossLinks';
import { completeFilters } from '../lib/websiteReportApi';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, type Insight, type Website } from '../lib/api';
import { presetToRange, rangeQueryString, type DateRangePreset } from '../lib/dateRange';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';

const INSIGHT_TYPE_OPTIONS: InsightType[] = ['trend', 'funnel', 'retention', 'lifecycle', 'stickiness', 'path', 'table'];
const RANGE_PRESETS: DateRangePreset[] = ['7d', '30d', '90d'];

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
  return (
    <div className="panel insight-actors-panel">
      <div className="panel-header compact-panel-header">
        <div>
          <h4 className="section-title">
            {drill.outcome === 'converted' ? t('insightConverted') : t('insightDroppedOff')} · {t('insightStep')} {drill.step + 1}
            {drill.breakdownValue !== undefined || drill.breakdownOther
              ? ` · ${breakdownLabel(drill.breakdownValue, drill.breakdownOther)}`
              : ''}
          </h4>
          <p className="text-muted">
            {t('insightActorsShown').replace('{shown}', formatNumber(data.actors.length)).replace('{total}', formatNumber(data.total))}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t('close')}
        </Button>
      </div>
      {data.actors.length ? (
        <ul className="list-plain insight-actors-list">
          {data.actors.map((actor) => (
            <li key={actor} className="list-item">
              {data.countBy === 'session' ? (
                <Link to={`/websites/${websiteId}/sessions/${encodeURIComponent(actor)}`}>{actor}</Link>
              ) : (
                <code>{actor}</code>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{t('noDataInPeriod')}</p>
      )}
    </div>
  );
}

export default function InsightsPage() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [websiteId, setWebsiteId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(typeLabel('trend'));
  const [description, setDescription] = useState('');
  const [type, setType] = useState<InsightType>('trend');
  const [query, setQuery] = useState<InsightQuery>(() => defaultQuery('trend'));
  const [preset, setPreset] = useState<DateRangePreset>('30d');
  const [drill, setDrill] = useState<FunnelDrill | null>(null);

  const websitesQuery = useQuery({
    queryKey: ['websites'],
    queryFn: () => api<Website[]>('/api/websites'),
  });

  const websites = websitesQuery.data ?? [];
  const timezone = websites.find((w) => w.id === websiteId)?.timezone ?? 'UTC';
  const range = useMemo(() => presetToRange(preset, undefined, undefined, timezone), [preset, timezone]);
  const rangeQs = rangeQueryString(range.startAt, range.endAt);
  const { canEdit } = useWebsitePermissions(websiteId, 'analytics');
  const problem = insightQueryProblem(type, query);

  useEffect(() => {
    if (!websiteId && websites.length) {
      setWebsiteId(websites[0].id);
    }
  }, [websiteId, websites]);

  const insightsQuery = useQuery({
    queryKey: ['insights', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Insight[]>(`/api/insights?websiteId=${websiteId}`),
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      api<{ data: InsightResult }>(`/api/insights/preview?websiteId=${websiteId}&${rangeQs}`, {
        method: 'POST',
        body: JSON.stringify({ type, query: runnableQuery(query) }),
      }),
    onMutate: () => setDrill(null),
  });

  const actorsMutation = useMutation({
    mutationFn: (next: FunnelDrill) =>
      api<FunnelActorsResult>(`/api/insights/funnel-actors?websiteId=${websiteId}&${rangeQs}`, {
        method: 'POST',
        body: JSON.stringify({ type: 'funnel', query: runnableQuery(query), ...next, limit: 100 }),
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({ websiteId, name, description, type, query: runnableQuery(query) });
      if (selectedId) {
        return api<Insight>(`/api/insights/${selectedId}`, { method: 'PATCH', body });
      }
      return api<Insight>('/api/insights', { method: 'POST', body });
    },
    onSuccess: (insight) => {
      setSelectedId(insight.id);
      queryClient.invalidateQueries({ queryKey: ['insights', websiteId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/insights/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSelectedId(null);
      setName(typeLabel(type));
      queryClient.invalidateQueries({ queryKey: ['insights', websiteId] });
    },
  });

  function reset() {
    previewMutation.reset();
    actorsMutation.reset();
    setDrill(null);
  }

  function selectInsight(insight: Insight) {
    reset();
    setSelectedId(insight.id);
    setWebsiteId(insight.websiteId);
    setName(insight.name);
    setDescription(insight.description);
    setType(insight.type);
    setQuery(insight.query?.version === 2 ? insight.query : defaultQuery(insight.type));
  }

  function newInsight(nextType: InsightType = 'trend') {
    reset();
    setSelectedId(null);
    setType(nextType);
    setName(typeLabel(nextType));
    setDescription('');
    setQuery(defaultQuery(nextType));
  }

  return (
    <Page className="page-insights">
      <PageHeader
        title={t('insights')}
        lead={t('insightsSubtitle')}
        backTo="/websites"
        backLabel={t('websites')}
        meta={<ProductLineCrossLinks surface="insights" />}
      />

      <PageBody>
      {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

      <section className="section-gap">
        <MasterDetailLayout
          list={
            <DataViewState
              loading={insightsQuery.isLoading}
              error={insightsQuery.isError ? insightsQuery.error : null}
              onRetry={() => insightsQuery.refetch()}
              isEmpty={!insightsQuery.isLoading && !(insightsQuery.data ?? []).length}
              emptyTitle={t('insightsEmptyTitle')}
              emptyDescription={t('insightsEmptyBody')}
            >
              <>
                {(insightsQuery.data ?? []).map((insight) => (
                  <MasterDetailListItem
                    key={insight.id}
                    selected={selectedId === insight.id}
                    onSelect={() => selectInsight(insight)}
                    title={insight.name}
                    subtitle={typeLabel(insight.type)}
                  />
                ))}
              </>
            </DataViewState>
          }
          detail={
            <MasterDetailPane
              title={selectedId ? t('editInsight') : t('createInsight')}
              description={t('insightBuilderLead')}
              actions={
                canEdit ? (
                  <Button type="button" variant="secondary" onClick={() => newInsight()}>
                    {t('newInsight')}
                  </Button>
                ) : null
              }
            >
            <div className="workflow-insights-grid">
              <div className="field">
                <Label htmlFor="insight-website">{t('website')}</Label>
                <select
                  id="insight-website"
                  className="select"
                  value={websiteId}
                  onChange={(event) => {
                    reset();
                    setWebsiteId(event.target.value);
                  }}
                >
                  {websites.map((website) => (
                    <option key={website.id} value={website.id}>{website.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <Label htmlFor="insight-type">{t('type')}</Label>
                <select
                  id="insight-type"
                  className="select"
                  value={type}
                  onChange={(event) => {
                    const next = event.target.value as InsightType;
                    reset();
                    setType(next);
                    setQuery(defaultQuery(next));
                    if (!selectedId) setName(typeLabel(next));
                  }}
                >
                  {INSIGHT_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {typeLabel(option)}
                    </option>
                  ))}
                </select>
              </div>
              {canEdit ? (
                <>
                  <div className="field">
                    <Label htmlFor="insight-name">{t('name')}</Label>
                    <Input id="insight-name" value={name} onChange={(event) => setName(event.target.value)} />
                  </div>
                  <div className="field">
                    <Label htmlFor="insight-description">{t('description')}</Label>
                    <Input id="insight-description" value={description} onChange={(event) => setDescription(event.target.value)} />
                  </div>
                </>
              ) : null}
            </div>

            {websiteId ? (
              <InsightQueryEditor websiteId={websiteId} type={type} query={query} onChange={setQuery} rangeQs={rangeQs} />
            ) : null}

            {problem ? <p className="text-muted insight-problem" role="status">{problem}</p> : null}

            <div className="form-actions">
              <select
                className="select insight-range-select"
                aria-label={t('dateRange')}
                value={preset}
                onChange={(event) => {
                  reset();
                  setPreset(event.target.value as DateRangePreset);
                }}
              >
                {RANGE_PRESETS.map((option) => (
                  <option key={option} value={option}>
                    {t(`datePreset${option}`)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                onClick={() => previewMutation.mutate()}
                disabled={!websiteId || Boolean(problem) || previewMutation.isPending}
              >
                {t('previewInsight')}
              </Button>
              {canEdit ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => saveMutation.mutate()}
                  disabled={!websiteId || !name.trim() || Boolean(problem) || saveMutation.isPending}
                >
                  {selectedId ? t('saveChanges') : t('saveInsight')}
                </Button>
              ) : null}
              {canEdit && selectedId ? (
                <Button type="button" variant="danger" onClick={() => confirm({ title: deleteTitle(name), onConfirm: () => deleteMutation.mutate(selectedId) })}>
                  {t('delete')}
                </Button>
              ) : null}
            </div>
            {saveMutation.error ? <p className="text-danger">{(saveMutation.error as Error).message}</p> : null}
            {canEdit ? (
              <p className="text-muted insight-save-share-hint">
                {t('insightSaveShareHintBeforeBoards')}{' '}
                <Link to="/boards">{t('boards')}</Link>
                {t('insightSaveShareHintBeforeReports')}{' '}
                <Link to="/reports">{t('reports')}</Link>
                {t('insightSaveShareHintEnd')}
              </p>
            ) : null}

            <div className="detail-section">
              <div className="panel-header compact-panel-header">
                <div>
                  <h3 className="section-title experiment-title">{t('insightPreview')}</h3>
                  <p className="text-muted">{t('insightPreviewLeadRange').replace('{range}', t(`datePreset${preset}`))}</p>
                </div>
              </div>
              <DataViewState
                loading={previewMutation.isPending}
                error={previewMutation.isError ? previewMutation.error : null}
                onRetry={() => previewMutation.mutate()}
              >
                {previewMutation.data?.data ? (
                  <InsightResultView
                    result={previewMutation.data.data}
                    onFunnelDrill={(next) => {
                      setDrill(next);
                      actorsMutation.mutate(next);
                    }}
                  />
                ) : (
                  <EmptyState title={t('insightPreviewEmptyTitle')} description={t('insightPreviewEmptyBody')} />
                )}
              </DataViewState>
              {drill ? (
                <DataViewState
                  loading={actorsMutation.isPending}
                  error={actorsMutation.isError ? actorsMutation.error : null}
                  onRetry={() => actorsMutation.mutate(drill)}
                >
                  {actorsMutation.data ? (
                    <FunnelActorsPanel
                      websiteId={websiteId}
                      data={actorsMutation.data}
                      drill={drill}
                      onClose={() => setDrill(null)}
                    />
                  ) : null}
                </DataViewState>
              ) : null}
            </div>
            </MasterDetailPane>
          }
        />
      </section>
      </PageBody>
    </Page>
  );
}
