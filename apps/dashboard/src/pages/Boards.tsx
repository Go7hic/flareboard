import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BoardEditorForm } from '../components/BoardEditorForm';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { ProductLineCrossLinks } from '../components/ProductLineCrossLinks';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { emptyStatsWidgetDraft, parseBoardConfig } from '../lib/board-config';
import { api, type Board, type BoardTemplateSummary, type Insight, type Website } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';

/** Localized template text, falling back to the API's English copy. */
function templateText(key: string, fallback: string) {
  const value = t(key);
  return value === key ? fallback : value;
}

function TemplateGallery({ websites }: { websites: Website[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [websiteId, setWebsiteId] = useState('');

  useEffect(() => {
    if (!websiteId && websites.length) setWebsiteId(websites[0]!.id);
  }, [websiteId, websites]);

  const templatesQuery = useQuery({
    queryKey: ['board-templates'],
    queryFn: () => api<BoardTemplateSummary[]>('/api/boards/templates'),
    staleTime: Infinity,
  });

  const createMutation = useMutation({
    mutationFn: (template: BoardTemplateSummary) =>
      api<Board>(`/api/boards/templates/${template.id}`, {
        method: 'POST',
        body: JSON.stringify({
          websiteId,
          name: templateText(`boardTemplate_${template.id}`, template.name),
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

  if (!websites.length) return null;

  return (
    <section className="panel board-templates">
      <div className="panel-header compact-panel-header">
        <div>
          <h2 className="section-title">{t('boardTemplatesTitle')}</h2>
          <p className="section-lead">{t('boardTemplatesLead')}</p>
        </div>
        <div className="field board-templates-website">
          <Label htmlFor="board-template-website">{t('website')}</Label>
          <select
            id="board-template-website"
            className="select"
            value={websiteId}
            onChange={(event) => setWebsiteId(event.target.value)}
          >
            {websites.map((website) => (
              <option key={website.id} value={website.id}>
                {website.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ul className="list-plain board-template-grid">
        {(templatesQuery.data ?? []).map((template) => (
          <li key={template.id} className="board-template-card">
            <h3 className="board-card-title">{templateText(`boardTemplate_${template.id}`, template.name)}</h3>
            <p className="text-muted">{templateText(`boardTemplateLead_${template.id}`, template.description)}</p>
            <p className="text-muted board-template-widgets">
              {template.widgets.map((widget) => templateText(`boardTemplateWidget_${widget.key}`, widget.name)).join(' · ')}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!websiteId || createMutation.isPending}
              onClick={() => createMutation.mutate(template)}
            >
              {t('boardTemplateUse')}
            </Button>
          </li>
        ))}
      </ul>
      {createMutation.error ? <p className="text-danger">{(createMutation.error as Error).message}</p> : null}
    </section>
  );
}

export default function BoardsPage() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createFormKey, setCreateFormKey] = useState(0);

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

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; parameters: Record<string, unknown> }) =>
      api<Board>('/api/boards', {
        method: 'POST',
        body: JSON.stringify({
          type: 'dashboard',
          name: payload.name,
          description: '',
          parameters: payload.parameters,
        }),
      }),
    onSuccess: (board) => {
      setCreateFormKey((k) => k + 1);
      queryClient.invalidateQueries({ queryKey: ['boards'] });
      navigate(`/boards/${board.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/boards/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['boards'] }),
  });

  const websites = websitesQuery.data ?? [];
  const boards = boardsQuery.data ?? [];
  const insights = insightsQuery.data ?? [];
  const hasBoards = boards.length > 0;

  const editor = (
    <>
      <BoardEditorForm
        key={`create-board-${createFormKey}`}
        websites={websites}
        insights={insights}
        initialName=""
        initialWidgets={[emptyStatsWidgetDraft()]}
        initialRangePreset="7d"
        submitLabel={t('createBoard')}
        isPending={createMutation.isPending}
        onSubmit={(payload) => createMutation.mutate(payload)}
      />
      {createMutation.error ? <p className="text-danger">{(createMutation.error as Error).message}</p> : null}
    </>
  );

  return (
    <Page className="page-boards">
      <PageHeader
        title={t('boards')}
        lead={t('boardsSubtitle')}
        backTo="/websites"
        backLabel={t('websites')}
        meta={<ProductLineCrossLinks surface="boards" />}
      />

      <PageBody>
        <TemplateGallery websites={websites} />

        {hasBoards ? (
          <CollapsibleSection title={t('collapseNewBoard')} summary={t('newBoardLead')}>
            {editor}
          </CollapsibleSection>
        ) : (
          <section className="panel section-gap">
            <h2 className="section-title">{t('newBoard')}</h2>
            <p className="section-lead">{t('newBoardLead')}</p>
            {editor}
          </section>
        )}

        <ul className="board-grid section-gap-lg">
          {boards.map((board) => {
            const config = parseBoardConfig(board.parameters);
            return (
              <li key={board.id} className="panel board-card">
                <div className="board-card-header">
                  <h3 className="board-card-title">
                    <Link to={`/boards/${board.id}`}>{board.name}</Link>
                  </h3>
                  <div className="board-card-actions">
                    <Button variant="secondary" size="sm" render={<Link to={`/boards/${board.id}`} />}>
                      {t('boardOpen')}
                    </Button>
                    {board.canEdit ? (
                      <Button
                        type="button"
                        variant="destructive-ghost"
                        size="sm"
                        onClick={() => confirm({ title: deleteTitle(board.name), onConfirm: () => deleteMutation.mutate(board.id) })}
                      >
                        {t('delete')}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {board.description ? <p className="text-muted board-card-description">{board.description}</p> : null}
                <p className="text-muted board-card-meta">
                  {t('boardWidgetCount').replace('{count}', String(config.widgets.length))}
                  {' · '}
                  {t(`boardWidgetPeriod${config.rangePreset}`)}
                  {config.filters.length ? ` · ${t('boardFilterCount').replace('{count}', String(config.filters.length))}` : ''}
                  {board.updatedAt ? ` · ${formatDateTime(board.updatedAt)}` : ''}
                </p>
              </li>
            );
          })}
          {!boardsQuery.isLoading && !hasBoards ? (
            <EmptyState as="li" variant="rich" title={t('noBoards')} description={t('noBoardsHint')} />
          ) : null}
        </ul>
      </PageBody>
    </Page>
  );
}
