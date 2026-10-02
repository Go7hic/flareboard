import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, LayoutTemplate, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BoardEditorForm } from '../components/BoardEditorForm';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { ModalDialog } from '../components/ModalDialog';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { pickWorkspaceWebsite, rememberWorkspaceWebsite } from '../components/workspace/workspaceWebsite';
import { emptyStatsWidgetDraft, normalizeBoardWidgetWidth, parseBoardConfig, type BoardWidget } from '../lib/board-config';
import { api, type Board, type BoardTemplateSummary, type Insight, type Website } from '../lib/api';
import { formatDateTime, formatNumber, formatRelativeTime } from '../lib/format';
import { t } from '../lib/i18n';
import { useDemoSession } from '../lib/useDemoSession';

/** Localized template text, falling back to the API's English copy. */
function templateText(key: string, fallback: string) {
  const value = t(key);
  return value === key ? fallback : value;
}

/** The board's widget layout in miniature (12 columns: small 4, medium 6, large 8, full 12). */
function BoardLayoutPreview({ widgets }: { widgets: BoardWidget[] }) {
  if (!widgets.length) {
    return (
      <div className="ws-board-preview is-empty" aria-hidden>
        <span className="ws-board-preview-cell ws-board-preview-cell--full" />
      </div>
    );
  }
  return (
    <div className="ws-board-preview" aria-hidden>
      {widgets.slice(0, 9).map((widget, index) => (
        <span
          key={index}
          className={`ws-board-preview-cell ws-board-preview-cell--${normalizeBoardWidgetWidth(widget.width)}${
            widget.type === 'stats' ? ' is-stats' : ''
          }`}
        />
      ))}
    </div>
  );
}

function NewBoardDialog({
  websites,
  insights,
  onClose,
}: {
  websites: Website[];
  insights: Insight[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'template' | 'blank'>(websites.length ? 'template' : 'blank');
  const [websiteId, setWebsiteId] = useState(() => pickWorkspaceWebsite(websites));

  const templatesQuery = useQuery({
    queryKey: ['board-templates'],
    queryFn: () => api<BoardTemplateSummary[]>('/api/boards/templates'),
    staleTime: Infinity,
  });

  const fromTemplate = useMutation({
    mutationFn: (template: BoardTemplateSummary) =>
      api<Board>(`/api/boards/templates/${template.id}`, {
        method: 'POST',
        body: JSON.stringify({
          websiteId,
          name: templateText(`boardTemplate_${template.id}`, template.name),
          description: templateText(`boardTemplateLead_${template.id}`, template.description),
          names: Object.fromEntries(
            template.widgets.map((widget) => [widget.key, templateText(`boardTemplateWidget_${widget.key}`, widget.name)]),
          ),
        }),
      }),
    onSuccess: (board) => {
      queryClient.invalidateQueries({ queryKey: ['boards'] });
      queryClient.invalidateQueries({ queryKey: ['insights-all'] });
      navigate(`/boards/${board.id}`);
    },
  });

  const blank = useMutation({
    mutationFn: (payload: { name: string; parameters: Record<string, unknown> }) =>
      api<Board>('/api/boards', {
        method: 'POST',
        body: JSON.stringify({ type: 'dashboard', name: payload.name, description: '', parameters: payload.parameters }),
      }),
    onSuccess: (board) => {
      queryClient.invalidateQueries({ queryKey: ['boards'] });
      navigate(`/boards/${board.id}`);
    },
  });

  return (
    <ModalDialog className="ws-dialog--lg" aria-label={t('newBoard')} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{t('newBoard')}</h2>
        <p>{tab === 'template' ? t('boardTemplatesLead') : t('newBoardLead')}</p>
        <div className="segmented ws-dialog-tabs" role="tablist" aria-label={t('newBoard')}>
          <button type="button" role="tab" aria-selected={tab === 'template'} onClick={() => setTab('template')}>
            {t('boardTemplatesTitle')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'blank'} onClick={() => setTab('blank')}>
            {t('workspaceBlankBoard')}
          </button>
        </div>
      </header>

      {tab === 'template' ? (
        <>
          <div className="dialog-body">
            {websites.length ? (
              <div className="field ws-field-inline">
                <Label htmlFor="board-template-website">{t('website')}</Label>
                <select
                  id="board-template-website"
                  className="select"
                  value={websiteId}
                  onChange={(event) => {
                    setWebsiteId(event.target.value);
                    rememberWorkspaceWebsite(event.target.value);
                  }}
                >
                  {websites.map((website) => (
                    <option key={website.id} value={website.id}>
                      {website.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="ws-muted-line">{t('boardNoWebsites')}</p>
            )}
            <DataViewState
              loading={templatesQuery.isLoading}
              error={templatesQuery.isError ? templatesQuery.error : null}
              onRetry={() => templatesQuery.refetch()}
              loadingFallback={<Skeleton className="h-40 w-full" />}
            >
              <ul className="ws-dialog-list ws-template-options">
                {(templatesQuery.data ?? []).map((template) => (
                  <li key={template.id} className="ws-dialog-row ws-template-option">
                    <span className="ws-template-option-icon" aria-hidden>
                      <LayoutTemplate />
                    </span>
                    <div className="ws-dialog-row-main">
                      <span className="ws-dialog-row-title">{templateText(`boardTemplate_${template.id}`, template.name)}</span>
                      <span className="ws-dialog-row-meta">
                        {templateText(`boardTemplateLead_${template.id}`, template.description)}
                      </span>
                      <span className="ws-template-option-widgets">
                        {template.widgets.map((widget) => templateText(`boardTemplateWidget_${widget.key}`, widget.name)).join(' · ')}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!websiteId || fromTemplate.isPending}
                      onClick={() => fromTemplate.mutate(template)}
                    >
                      {t('boardTemplateUse')}
                    </Button>
                  </li>
                ))}
              </ul>
            </DataViewState>
            {fromTemplate.error ? (
              <p className="text-danger" role="alert">
                {(fromTemplate.error as Error).message}
              </p>
            ) : null}
          </div>
          <footer className="dialog-footer">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('cancel')}
            </Button>
          </footer>
        </>
      ) : (
        <BoardEditorForm
          websites={websites}
          insights={insights}
          initialName=""
          initialWidgets={[emptyStatsWidgetDraft()]}
          initialRangePreset="7d"
          submitLabel={t('createBoard')}
          isPending={blank.isPending}
          onSubmit={(payload) => blank.mutate(payload)}
          onCancel={onClose}
          error={blank.error ? (blank.error as Error).message : null}
        />
      )}
    </ModalDialog>
  );
}

export default function BoardsPage() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  // The read-only demo browses boards but cannot create them.
  const { isDemo } = useDemoSession();

  const websitesQuery = useQuery({
    queryKey: ['websites'],
    queryFn: () => api<Website[]>('/api/websites'),
  });

  const boardsQuery = useQuery({
    queryKey: ['boards'],
    queryFn: () => api<Board[]>('/api/boards'),
  });

  const insightsQuery = useQuery({
    queryKey: ['insights-all'],
    queryFn: () => api<Insight[]>('/api/insights'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/boards/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['boards'] }),
  });

  const boards = boardsQuery.data ?? [];

  const newButton = isDemo ? null : (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <Plus aria-hidden />
      {t('newBoard')}
    </Button>
  );

  return (
    <Page className="ws-page-boards">
      <PageHeader title={t('boards')} lead={t('workspaceBoardsLead')} actions={boards.length ? newButton : null} />

      <PageBody className="stack">
        <DataViewState
          loading={boardsQuery.isLoading}
          error={boardsQuery.isError ? boardsQuery.error : null}
          onRetry={() => boardsQuery.refetch()}
          loadingFallback={
            <div className="ws-board-grid" aria-hidden>
              {[0, 1, 2].map((key) => (
                <div key={key} className="ws-board-card">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="mt-4 h-4 w-1/2" />
                  <Skeleton className="mt-2 h-3 w-3/4" />
                </div>
              ))}
            </div>
          }
        >
          {boards.length ? (
            <ul className="ws-board-grid">
              {boards.map((board) => {
                const config = parseBoardConfig(board.parameters);
                return (
                  <li key={board.id} className="ws-board-card">
                    <BoardLayoutPreview widgets={config.widgets} />
                    <h2 className="ws-board-card-title">
                      <Link to={`/boards/${board.id}`} className="ws-stretched-link">
                        {board.name}
                      </Link>
                    </h2>
                    {board.description ? <p className="ws-board-card-desc">{board.description}</p> : null}
                    <p className="meta-line ws-board-card-meta">
                      <span>{t('boardWidgetCount').replace('{count}', formatNumber(config.widgets.length))}</span>
                      <span>{t(`boardWidgetPeriod${config.rangePreset}`)}</span>
                      {config.filters.length ? (
                        <span>{t('boardFilterCount').replace('{count}', formatNumber(config.filters.length))}</span>
                      ) : null}
                      {board.updatedAt ? (
                        <span title={formatDateTime(board.updatedAt)}>
                          {t('workspaceUpdatedAgo').replace('{time}', formatRelativeTime(board.updatedAt))}
                        </span>
                      ) : null}
                    </p>
                    {board.canEdit && !isDemo ? (
                      <Button
                        type="button"
                        variant="destructive-ghost"
                        size="icon-sm"
                        className="ws-board-card-delete"
                        aria-label={`${t('delete')} · ${board.name}`}
                        title={t('delete')}
                        onClick={() => confirm({ title: deleteTitle(board.name), onConfirm: () => deleteMutation.mutate(board.id) })}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              variant="rich"
              icon={<LayoutGrid />}
              title={t('noBoards')}
              description={t('workspaceBoardsEmpty')}
              action={newButton ?? undefined}
            />
          )}
        </DataViewState>
      </PageBody>

      {creating ? (
        <NewBoardDialog
          websites={websitesQuery.data ?? []}
          insights={insightsQuery.data ?? []}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </Page>
  );
}
