import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { BoardEditorForm } from '../components/BoardEditorForm';
import { BoardWidgets } from '../components/BoardWidgets';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { PropertyFilterBuilder } from '../components/PropertyFilterBuilder';
import { ShareLinksDialog } from '../components/ShareLinksDialog';
import { SubscriptionsDialog } from '../components/SubscriptionsDialog';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import {
  BOARD_RANGE_PRESET_OPTIONS,
  boardConfigToDrafts,
  normalizeBoardRangePreset,
  parseBoardConfig,
  parseBoardUrlState,
  withBoardWidgets,
  type BoardRangePreset,
  type BoardWidget,
} from '../lib/board-config';
import { api, type Board, type Insight, type Website } from '../lib/api';
import { presetToRange, rangeQueryString } from '../lib/dateRange';
import { t } from '../lib/i18n';
import { completeFilters } from '../lib/websiteReportApi';

const sameFilters = (a: PropertyFilter[], b: PropertyFilter[]) => JSON.stringify(a) === JSON.stringify(b);

export default function BoardDetailPage() {
  const { boardId = '' } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<'share' | 'subscribe' | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  /** Widget order / sizes while a layout save is in flight (optimistic). */
  const [pendingWidgets, setPendingWidgets] = useState<BoardWidget[] | null>(null);

  const boardQuery = useQuery({
    queryKey: ['board', boardId],
    queryFn: () => api<Board>(`/api/boards/${boardId}`),
  });
  const websitesQuery = useQuery({ queryKey: ['websites'], queryFn: () => api<Website[]>('/api/websites') });
  const insightsQuery = useQuery({ queryKey: ['insights-all'], queryFn: () => api<Insight[]>('/api/insights') });

  const board = boardQuery.data;
  const saved = useMemo(() => parseBoardConfig(board?.parameters ?? {}), [board?.parameters]);
  const urlState = useMemo(() => parseBoardUrlState(searchParams), [searchParams]);
  const rangePreset: BoardRangePreset = urlState.rangePreset ?? saved.rangePreset;
  const appliedFilters = urlState.filters ?? saved.filters;
  const canEdit = Boolean(board?.canEdit);

  // Filter rows being edited (incomplete rows stay local; complete ones go to the URL).
  const [draftFilters, setDraftFilters] = useState<PropertyFilter[]>(appliedFilters);
  useEffect(() => {
    setDraftFilters((current) => (sameFilters(completeFilters(current), appliedFilters) ? current : appliedFilters));
  }, [appliedFilters]);

  function updateUrl(next: { rangePreset?: BoardRangePreset; filters?: PropertyFilter[] }) {
    const params = new URLSearchParams(searchParams);
    const range = next.rangePreset ?? rangePreset;
    const filters = next.filters ?? appliedFilters;
    if (range === saved.rangePreset) params.delete('range');
    else params.set('range', range);
    if (sameFilters(filters, saved.filters)) params.delete('filters');
    else params.set('filters', JSON.stringify(filters));
    setSearchParams(params, { replace: true });
  }

  function onFiltersChange(next: PropertyFilter[]) {
    setDraftFilters(next);
    const complete = completeFilters(next);
    if (!sameFilters(complete, appliedFilters)) updateUrl({ filters: complete });
  }

  const insightWebsite = useMemo(() => {
    const byId = new Map((insightsQuery.data ?? []).map((insight) => [insight.id, insight.websiteId]));
    for (const widget of saved.widgets) {
      if (widget.type === 'insight' && byId.has(widget.insightId)) return byId.get(widget.insightId);
      if (widget.type === 'stats') return widget.websiteId;
    }
    return undefined;
  }, [insightsQuery.data, saved.widgets]);
  const range = presetToRange(rangePreset);
  const rangeQs = rangeQueryString(range.startAt, range.endAt);
  const dirty = rangePreset !== saved.rangePreset || !sameFilters(appliedFilters, saved.filters);

  const saveMutation = useMutation({
    mutationFn: (payload: { name?: string; parameters: Record<string, unknown> }) =>
      api<Board>(`/api/boards/${boardId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['board', boardId], { ...updated, canEdit: board?.canEdit });
      queryClient.invalidateQueries({ queryKey: ['boards'] });
    },
    onSettled: () => setPendingWidgets(null),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/api/boards/${boardId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boards'] });
      navigate('/boards');
    },
  });

  function saveDefaults() {
    if (!board) return;
    saveMutation.mutate(
      { parameters: { ...board.parameters, rangePreset, filters: appliedFilters } },
      { onSuccess: () => setSearchParams({}, { replace: true }) },
    );
  }

  function saveLayout(widgets: BoardWidget[]) {
    if (!board) return;
    setPendingWidgets(widgets);
    saveMutation.mutate({ parameters: withBoardWidgets(board.parameters, widgets) });
  }

  async function copyViewLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setLinkCopied(false);
    }
  }

  const widgets = pendingWidgets ?? saved.widgets;

  return (
    <Page className="page-board-detail">
      <PageHeader
        title={board?.name ?? t('boards')}
        lead={board?.description || undefined}
        backTo="/boards"
        backLabel={t('boards')}
        actions={
          board ? (
            <>
              <Button type="button" variant="ghost" onClick={copyViewLink}>
                {linkCopied ? t('shareCopied') : t('boardCopyViewLink')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDialog('subscribe')}>
                {t('subscribe')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setDialog('share')}>
                {t('shareBoard')}
              </Button>
              {canEdit ? (
                <Button type="button" variant="secondary" onClick={() => setEditing((value) => !value)}>
                  {editing ? t('cancel') : t('editBoard')}
                </Button>
              ) : null}
              {canEdit ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => confirm({ title: deleteTitle(board.name), onConfirm: () => deleteMutation.mutate() })}
                >
                  {t('delete')}
                </Button>
              ) : null}
            </>
          ) : null
        }
        toolbar={
          board ? (
            <div className="board-filter-bar">
              <div className="field board-filter-range">
                <Label htmlFor="board-range">{t('dateRange')}</Label>
                <select
                  id="board-range"
                  className="select"
                  value={rangePreset}
                  onChange={(event) => updateUrl({ rangePreset: normalizeBoardRangePreset(event.target.value) })}
                >
                  {BOARD_RANGE_PRESET_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`boardWidgetPeriod${option}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field board-filter-properties">
                <Label>{t('boardFilters')}</Label>
                <PropertyFilterBuilder
                  websiteId={insightWebsite}
                  value={draftFilters}
                  onChange={onFiltersChange}
                  rangeQs={rangeQs}
                  addLabel={t('boardFilterAdd')}
                />
              </div>
              {dirty ? (
                <div className="board-filter-actions">
                  <span className="text-muted">{t('boardFiltersUnsaved')}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSearchParams({}, { replace: true })}>
                    {t('boardFiltersReset')}
                  </Button>
                  {canEdit ? (
                    <Button type="button" variant="secondary" size="sm" disabled={saveMutation.isPending} onClick={saveDefaults}>
                      {t('boardFiltersSave')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null
        }
      />

      <PageBody>
        <DataViewState
          loading={boardQuery.isLoading}
          error={boardQuery.isError ? boardQuery.error : null}
          onRetry={() => boardQuery.refetch()}
        >
          {board ? (
            <>
              <p className="text-muted board-filter-note">{t('boardFiltersNote')}</p>
              {editing ? (
                <section className="panel section-gap">
                  <h2 className="section-title">{t('editBoard')}</h2>
                  <BoardEditorForm
                    key={`edit-${board.id}-${String(board.updatedAt)}`}
                    websites={websitesQuery.data ?? []}
                    insights={insightsQuery.data ?? []}
                    initialName={board.name}
                    initialWidgets={boardConfigToDrafts(saved)}
                    initialRangePreset={saved.rangePreset}
                    initialFilters={saved.filters}
                    submitLabel={t('saveBoard')}
                    isPending={saveMutation.isPending}
                    onCancel={() => setEditing(false)}
                    onSubmit={(payload) =>
                      saveMutation.mutate(
                        { name: payload.name, parameters: { ...board.parameters, ...payload.parameters } },
                        { onSuccess: () => setEditing(false) },
                      )
                    }
                  />
                </section>
              ) : null}
              {saveMutation.error ? <p className="text-danger">{(saveMutation.error as Error).message}</p> : null}
              {widgets.length ? (
                <>
                  {canEdit ? <p className="text-muted board-layout-hint">{t('boardLayoutHint')}</p> : null}
                  <BoardWidgets
                    widgets={widgets}
                    rangePreset={rangePreset}
                    filters={appliedFilters}
                    onLayoutChange={canEdit ? saveLayout : undefined}
                  />
                </>
              ) : (
                <EmptyState variant="rich" title={t('boardEmptyTitle')} description={t('boardEmptyBody')} />
              )}
            </>
          ) : null}
        </DataViewState>
      </PageBody>

      {dialog === 'share' && board ? (
        <ShareLinksDialog
          entityType="board"
          entityId={board.id}
          entityName={board.name}
          canEdit={canEdit}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'subscribe' && board ? (
        <SubscriptionsDialog
          targetType="board"
          targetId={board.id}
          targetName={board.name}
          canEdit={canEdit}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Page>
  );
}
