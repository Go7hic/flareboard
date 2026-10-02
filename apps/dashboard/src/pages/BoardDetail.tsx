import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Ellipsis, LayoutGrid, Link2, Mail, Pencil, Share2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { BoardEditorForm } from '../components/BoardEditorForm';
import { BoardWidgets } from '../components/BoardWidgets';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { ModalDialog } from '../components/ModalDialog';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { PropertyFilterBuilder } from '../components/PropertyFilterBuilder';
import { ShareLinksDialog } from '../components/ShareLinksDialog';
import { SubscriptionsDialog } from '../components/SubscriptionsDialog';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Skeleton } from '../components/ui/skeleton';
import { RangeSegmented } from '../components/workspace/RangeSegmented';
import {
  BOARD_RANGE_PRESET_OPTIONS,
  boardConfigToDrafts,
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
  const copiedTimer = useRef<number | undefined>(undefined);
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

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

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

  const websiteNames = useMemo(
    () => Object.fromEntries((websitesQuery.data ?? []).map((site) => [site.id, site.name])),
    [websitesQuery.data],
  );
  const insightNames = useMemo(
    () => Object.fromEntries((insightsQuery.data ?? []).map((insight) => [insight.id, insight.name])),
    [insightsQuery.data],
  );

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
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setLinkCopied(false);
    }
  }

  const widgets = pendingWidgets ?? saved.widgets;

  const actions = board ? (
    <div className="ws-header-controls">
      {linkCopied ? (
        <span className="ws-inline-status" role="status">
          <Check aria-hidden />
          {t('shareCopied')}
        </span>
      ) : null}
      <Button type="button" variant="outline" onClick={() => setDialog('share')}>
        <Share2 aria-hidden />
        {t('shareBoard')}
      </Button>
      {canEdit ? (
        <Button type="button" variant="outline" onClick={() => setEditing(true)}>
          <Pencil aria-hidden />
          {t('editBoard')}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" variant="outline" size="icon" aria-label={t('workspaceMoreActions')} title={t('workspaceMoreActions')} />}
        >
          <Ellipsis aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="ws-menu">
          <DropdownMenuItem onClick={() => void copyViewLink()}>
            <Link2 aria-hidden />
            {t('boardCopyViewLink')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog('subscribe')}>
            <Mail aria-hidden />
            {t('subscribe')}
          </DropdownMenuItem>
          {canEdit ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => confirm({ title: deleteTitle(board.name), onConfirm: () => deleteMutation.mutate() })}
              >
                <Trash2 aria-hidden />
                {t('workspaceDeleteBoard')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : null;

  const toolbar = board ? (
    <div className="ws-board-toolbar">
      <RangeSegmented
        value={rangePreset}
        options={BOARD_RANGE_PRESET_OPTIONS}
        onChange={(next) => updateUrl({ rangePreset: next })}
      />
      <div className="ws-board-filters">
        <PropertyFilterBuilder
          websiteId={insightWebsite}
          value={draftFilters}
          onChange={onFiltersChange}
          rangeQs={rangeQs}
          addLabel={t('boardFilterAdd')}
        />
      </div>
      {dirty ? (
        <div className="ws-board-dirty">
          <span>{t('boardFiltersUnsaved')}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSearchParams({}, { replace: true })}>
            {t('boardFiltersReset')}
          </Button>
          {canEdit ? (
            <Button type="button" variant="outline" size="sm" disabled={saveMutation.isPending} onClick={saveDefaults}>
              {t('boardFiltersSave')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <Page className="ws-page-board">
      <PageHeader
        title={board?.name ?? t('boards')}
        lead={board?.description || undefined}
        backTo="/boards"
        backLabel={t('boards')}
        actions={actions}
        toolbar={toolbar}
      />

      <PageBody className="stack">
        <DataViewState
          loading={boardQuery.isLoading}
          error={boardQuery.isError ? boardQuery.error : null}
          onRetry={() => boardQuery.refetch()}
          loadingFallback={
            <div className="ws-widgets" aria-hidden>
              <div className="ws-widget ws-widget--full">
                <Skeleton className="h-64 w-full" />
              </div>
              <div className="ws-widget ws-widget--medium">
                <Skeleton className="h-48 w-full" />
              </div>
              <div className="ws-widget ws-widget--medium">
                <Skeleton className="h-48 w-full" />
              </div>
            </div>
          }
        >
          {board ? (
            <>
              <p className="ws-muted-line ws-board-note">{t('boardFiltersNote')}</p>
              {saveMutation.error ? (
                <p className="text-danger" role="alert">
                  {(saveMutation.error as Error).message}
                </p>
              ) : null}
              {widgets.length ? (
                <>
                  <BoardWidgets
                    widgets={widgets}
                    rangePreset={rangePreset}
                    filters={appliedFilters}
                    onLayoutChange={canEdit ? saveLayout : undefined}
                    websiteNames={websiteNames}
                    insightNames={insightNames}
                  />
                  {canEdit ? <p className="ws-muted-line">{t('boardLayoutHint')}</p> : null}
                </>
              ) : (
                <EmptyState
                  variant="rich"
                  icon={<LayoutGrid />}
                  title={t('boardEmptyTitle')}
                  description={t('boardEmptyBody')}
                  action={
                    canEdit ? (
                      <Button variant="primary" onClick={() => setEditing(true)}>
                        <Pencil aria-hidden />
                        {t('editBoard')}
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </>
          ) : null}
        </DataViewState>
      </PageBody>

      {editing && board ? (
        <ModalDialog className="ws-dialog--lg" aria-label={t('editBoard')} onClose={() => setEditing(false)}>
          <header className="dialog-header">
            <h2 className="dialog-title">{t('editBoard')}</h2>
          </header>
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
            error={saveMutation.error ? (saveMutation.error as Error).message : null}
            onSubmit={(payload) =>
              saveMutation.mutate(
                { name: payload.name, parameters: { ...board.parameters, ...payload.parameters } },
                { onSuccess: () => setEditing(false) },
              )
            }
          />
        </ModalDialog>
      ) : null}

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
