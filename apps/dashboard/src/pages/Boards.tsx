import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BoardEditorForm } from '../components/BoardEditorForm';
import {
  BoardWidgets,
  emptyStatsWidgetDraft,
  parseBoardWidgets,
  statsWidgetsToDrafts,
} from '../components/BoardWidgets';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { api, getToken, type Website } from '../lib/api';
import { t } from '../lib/i18n';

interface Board {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export default function BoardsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createFormKey, setCreateFormKey] = useState(0);

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

  const websitesQuery = useQuery({
    queryKey: ['websites'],
    queryFn: () => api<Website[]>('/api/websites'),
  });

  const boardsQuery = useQuery({
    queryKey: ['boards'],
    queryFn: () => api<Board[]>('/api/boards'),
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
    onSuccess: () => {
      setCreateFormKey((k) => k + 1);
      queryClient.invalidateQueries({ queryKey: ['boards'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      name: string;
      parameters: Record<string, unknown>;
    }) =>
      api<Board>(`/api/boards/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: payload.name,
          parameters: payload.parameters,
        }),
      }),
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ['boards'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/boards/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      if (editingId) setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ['boards'] });
    },
  });

  const [shareUrls, setShareUrls] = useState<Record<string, string>>({});
  const [shareCopiedId, setShareCopiedId] = useState<string | null>(null);

  const shareMutation = useMutation({
    mutationFn: (boardId: string) =>
      api<{ slug: string }>(`/api/boards/${boardId}/share`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: (share, boardId) => {
      const url = `${window.location.origin}/share/${share.slug}`;
      setShareUrls((prev) => ({ ...prev, [boardId]: url }));
    },
  });

  async function copyShareLink(boardId: string) {
    const url = shareUrls[boardId];
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setShareCopiedId(boardId);
    } catch {
      setShareCopiedId(null);
    }
  }

  const websites = websitesQuery.data ?? [];
  const boards = boardsQuery.data ?? [];
  const hasBoards = boards.length > 0;

  return (
    <div className="page page-boards">
      <PageHeader
        title={t('boards')}
        subtitle={t('boardsSubtitle')}
        backTo="/websites"
        backLabel={t('websites')}
      />

      {hasBoards ? (
        <CollapsibleSection title={t('collapseNewBoard')} summary={t('newBoardLead')}>
          <BoardEditorForm
            key={`create-board-${createFormKey}`}
            websites={websites}
            initialName=""
            initialWidgets={[emptyStatsWidgetDraft()]}
            submitLabel={t('createBoard')}
            isPending={createMutation.isPending}
            onSubmit={(payload) => createMutation.mutate(payload)}
          />
          {createMutation.error ? (
            <p className="text-danger">{(createMutation.error as Error).message}</p>
          ) : null}
        </CollapsibleSection>
      ) : (
        <section className="panel">
          <h2 className="section-title">{t('newBoard')}</h2>
          <p className="section-lead">{t('newBoardLead')}</p>
          <BoardEditorForm
            key={`create-board-${createFormKey}`}
            websites={websites}
            initialName=""
            initialWidgets={[emptyStatsWidgetDraft()]}
            submitLabel={t('createBoard')}
            isPending={createMutation.isPending}
            onSubmit={(payload) => createMutation.mutate(payload)}
          />
          {createMutation.error ? (
            <p className="text-danger">{(createMutation.error as Error).message}</p>
          ) : null}
        </section>
      )}

      <ul className="board-grid section-gap-lg">
        {boards.map((b) => {
          const isEditing = editingId === b.id;
          const widgets = parseBoardWidgets(b.parameters);

          return (
            <li
              key={b.id}
              className={`panel board-card${isEditing ? ' board-card--editing' : ''}`}
            >
              {isEditing ? (
                <>
                  <h3 className="section-title">{t('editBoard')}</h3>
                  <BoardEditorForm
                    key={`edit-${b.id}`}
                    websites={websites}
                    initialName={b.name}
                    initialWidgets={statsWidgetsToDrafts(widgets)}
                    submitLabel={t('saveBoard')}
                    isPending={updateMutation.isPending}
                    onCancel={() => setEditingId(null)}
                    onSubmit={(payload) => updateMutation.mutate({ id: b.id, ...payload })}
                  />
                  {updateMutation.error ? (
                    <p className="text-danger">{(updateMutation.error as Error).message}</p>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="board-card-header">
                    <h3 className="board-card-title">{b.name}</h3>
                    <div className="board-card-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={shareMutation.isPending}
                        onClick={() => shareMutation.mutate(b.id)}
                      >
                        {t('shareBoard')}
                      </Button>
                      {shareUrls[b.id] ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => copyShareLink(b.id)}
                        >
                          {shareCopiedId === b.id ? t('shareCopied') : t('copyShareLink')}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditingId(b.id)}
                      >
                        {t('edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => deleteMutation.mutate(b.id)}
                      >
                        {t('delete')}
                      </Button>
                    </div>
                  </div>
                  <BoardWidgets widgets={widgets} />
                  {shareUrls[b.id] ? (
                    <p className="text-muted board-share-url">
                      <a href={shareUrls[b.id]} target="_blank" rel="noreferrer">
                        {shareUrls[b.id]}
                      </a>
                    </p>
                  ) : null}
                  {shareMutation.isError && shareMutation.variables === b.id ? (
                    <p className="text-danger">{(shareMutation.error as Error).message}</p>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
        {!boardsQuery.isLoading && !hasBoards ? (
          <li className="panel empty-state-rich">
            <h3>{t('noBoards')}</h3>
            <p className="text-muted">{t('noBoardsHint')}</p>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
