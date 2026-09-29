import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { InsightResultView } from '../components/InsightResultView';
import { MasterDetailLayout, MasterDetailListItem, MasterDetailPane } from '../components/master-detail';
import { NotebookMarkdown } from '../components/NotebookMarkdown';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  api,
  type Insight,
  type InsightResult,
  type Notebook,
  type NotebookBlock,
  type NotebookSummary,
  type Website,
} from '../lib/api';
import { BOARD_RANGE_PRESET_OPTIONS, normalizeBoardRangePreset, type BoardRangePreset } from '../lib/board-config';
import { presetToRange, rangeQueryString } from '../lib/dateRange';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

function blockId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function newBlock(type: NotebookBlock['type']): NotebookBlock {
  if (type === 'text') return { id: blockId(), type: 'text', text: '' };
  if (type === 'insight') return { id: blockId(), type: 'insight', insightId: '', rangePreset: '30d' };
  return { id: blockId(), type: 'replay', sessionId: '', label: '' };
}

/** Insight blocks with no insight picked yet (and empty replay ids) are not saved. */
function savableBlocks(blocks: NotebookBlock[]) {
  return blocks.filter((block) =>
    block.type === 'insight' ? Boolean(block.insightId) : block.type === 'replay' ? Boolean(block.sessionId.trim()) : true,
  );
}

function InsightBlockView({ insight, rangePreset }: { insight: Insight | undefined; rangePreset: BoardRangePreset }) {
  const range = presetToRange(rangePreset);
  const run = useQuery({
    queryKey: ['notebook-insight', insight?.id, rangePreset],
    enabled: Boolean(insight),
    queryFn: () => api<{ data: InsightResult }>(`/api/insights/${insight!.id}/run?${rangeQueryString(range.startAt, range.endAt)}`),
  });
  if (!insight) return <p className="text-muted">{t('notebookInsightMissing')}</p>;
  return (
    <div className="notebook-insight">
      <div className="notebook-insight-head">
        <Link to={`/insights?insight=${insight.id}`} className="notebook-insight-title">
          {insight.name}
        </Link>
        <span className="text-muted">{t(`boardWidgetPeriod${rangePreset}`)}</span>
      </div>
      <DataViewState loading={run.isLoading} error={run.isError ? run.error : null} onRetry={() => run.refetch()}>
        {run.data?.data ? <InsightResultView result={run.data.data} compact /> : null}
      </DataViewState>
    </div>
  );
}

function BlockEditor({
  block,
  websiteId,
  insights,
  editing,
  onChange,
}: {
  block: NotebookBlock;
  websiteId: string;
  insights: Insight[];
  editing: boolean;
  onChange: (next: NotebookBlock) => void;
}) {
  if (block.type === 'text') {
    return editing ? (
      <Textarea
        className="notebook-text-input"
        rows={Math.min(16, Math.max(3, block.text.split('\n').length + 1))}
        value={block.text}
        placeholder={t('notebookTextPlaceholder')}
        aria-label={t('notebookBlockText')}
        onChange={(event) => onChange({ ...block, text: event.target.value })}
      />
    ) : block.text.trim() ? (
      <NotebookMarkdown source={block.text} />
    ) : null;
  }

  if (block.type === 'insight') {
    const insight = insights.find((row) => row.id === block.insightId);
    const rangePreset = normalizeBoardRangePreset(block.rangePreset ?? '30d');
    return (
      <>
        {editing ? (
          <div className="notebook-block-fields">
            <select
              className="select"
              aria-label={t('insight')}
              value={block.insightId}
              onChange={(event) => onChange({ ...block, insightId: event.target.value })}
            >
              <option value="">{t('selectInsight')}</option>
              {insights.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            <select
              className="select"
              aria-label={t('dateRange')}
              value={rangePreset}
              onChange={(event) => onChange({ ...block, rangePreset: normalizeBoardRangePreset(event.target.value) })}
            >
              {BOARD_RANGE_PRESET_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`boardWidgetPeriod${option}`)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {block.insightId ? <InsightBlockView insight={insight} rangePreset={rangePreset} /> : null}
      </>
    );
  }

  const sessionId = block.sessionId.trim();
  return (
    <>
      {editing ? (
        <div className="notebook-block-fields">
          <Input
            aria-label={t('notebookSessionId')}
            placeholder={t('notebookSessionId')}
            value={block.sessionId}
            onChange={(event) => onChange({ ...block, sessionId: event.target.value })}
          />
          <Input
            aria-label={t('widgetLabel')}
            placeholder={t('widgetLabelOptional')}
            value={block.label ?? ''}
            onChange={(event) => onChange({ ...block, label: event.target.value })}
          />
        </div>
      ) : null}
      {sessionId && /^[A-Za-z0-9._:-]{1,128}$/.test(sessionId) ? (
        <p className="notebook-replay-link">
          <Link to={`/websites/${websiteId}/sessions/${encodeURIComponent(sessionId)}`}>
            {block.label?.trim() || t('notebookReplayLink').replace('{id}', sessionId)}
          </Link>
        </p>
      ) : sessionId ? (
        <p className="text-danger">{t('notebookSessionInvalid')}</p>
      ) : null}
    </>
  );
}

function NotebookEditor({
  notebook,
  insights,
  canEdit,
  onDeleted,
}: {
  notebook: Notebook;
  insights: Insight[];
  canEdit: boolean;
  onDeleted: () => void;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(notebook.title);
  const [blocks, setBlocks] = useState<NotebookBlock[]>(notebook.content.blocks);
  const [editing, setEditing] = useState(canEdit && !notebook.content.blocks.length);
  const dirty = title !== notebook.title || JSON.stringify(savableBlocks(blocks)) !== JSON.stringify(notebook.content.blocks);

  const saveMutation = useMutation({
    mutationFn: () =>
      api<Notebook>(`/api/websites/${notebook.websiteId}/notebooks/${notebook.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title.trim(), content: { blocks: savableBlocks(blocks) } }),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['notebook', notebook.websiteId, notebook.id], saved);
      queryClient.invalidateQueries({ queryKey: ['notebooks', notebook.websiteId] });
      setBlocks(saved.content.blocks);
      setTitle(saved.title);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/api/websites/${notebook.websiteId}/notebooks/${notebook.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notebooks', notebook.websiteId] });
      onDeleted();
    },
  });

  function update(index: number, next: NotebookBlock) {
    setBlocks((current) => current.map((block, i) => (i === index ? next : block)));
  }

  function move(index: number, delta: number) {
    setBlocks((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <div className="notebook-editor">
      <div className="notebook-editor-head">
        {editing ? (
          <div className="field notebook-title-field">
            <Label htmlFor="notebook-title">{t('notebookTitle')}</Label>
            <Input id="notebook-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
        ) : (
          <h2 className="notebook-title">{title}</h2>
        )}
        <p className="text-muted notebook-meta">
          {t('notebookUpdated').replace('{date}', formatDateTime(notebook.updatedAt))}
        </p>
        {canEdit ? (
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setEditing((value) => !value)}>
              {editing ? t('notebookPreview') : t('edit')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!dirty || !title.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {t('saveChanges')}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => confirm({ title: deleteTitle(notebook.title), onConfirm: () => deleteMutation.mutate() })}
            >
              {t('delete')}
            </Button>
          </div>
        ) : null}
        {saveMutation.error ? <p className="text-danger">{(saveMutation.error as Error).message}</p> : null}
      </div>

      {!blocks.length && !editing ? <EmptyState title={t('notebookEmptyTitle')} description={t('notebookEmptyBody')} /> : null}
      <ol className="list-plain notebook-blocks">
        {blocks.map((block, index) => (
          <li key={block.id} className={`notebook-block notebook-block--${block.type}${editing ? ' notebook-block--editing' : ''}`}>
            {editing ? (
              <div className="notebook-block-toolbar">
                <span className="text-muted notebook-block-kind">{t(`notebookBlock_${block.type}`)}</span>
                <Button type="button" variant="ghost" size="sm" disabled={index === 0} aria-label={t('moveWidgetUp')} onClick={() => move(index, -1)}>
                  <ArrowUp size={14} strokeWidth={2} aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={index === blocks.length - 1}
                  aria-label={t('moveWidgetDown')}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={14} strokeWidth={2} aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="destructive-ghost"
                  size="sm"
                  aria-label={t('notebookRemoveBlock')}
                  onClick={() => setBlocks((current) => current.filter((_, i) => i !== index))}
                >
                  <X size={14} strokeWidth={2} aria-hidden />
                </Button>
              </div>
            ) : null}
            <BlockEditor
              block={block}
              websiteId={notebook.websiteId}
              insights={insights}
              editing={editing}
              onChange={(next) => update(index, next)}
            />
          </li>
        ))}
      </ol>
      {editing ? (
        <div className="notebook-add">
          <Button type="button" variant="ghost" size="sm" onClick={() => setBlocks((current) => [...current, newBlock('text')])}>
            {t('notebookAddText')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setBlocks((current) => [...current, newBlock('insight')])}>
            {t('notebookAddInsight')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setBlocks((current) => [...current, newBlock('replay')])}>
            {t('notebookAddReplay')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function NotebooksPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [websiteId, setWebsiteId] = useState(searchParams.get('website') ?? '');
  const selectedId = searchParams.get('notebook');
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId, 'analytics');

  const websitesQuery = useQuery({ queryKey: ['websites'], queryFn: () => api<Website[]>('/api/websites') });
  const websites = useMemo(() => websitesQuery.data ?? [], [websitesQuery.data]);

  useEffect(() => {
    if (!websiteId && websites.length) setWebsiteId(websites[0]!.id);
  }, [websiteId, websites]);

  const listQuery = useQuery({
    queryKey: ['notebooks', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<NotebookSummary[]>(`/api/websites/${websiteId}/notebooks`),
  });
  const notebookQuery = useQuery({
    queryKey: ['notebook', websiteId, selectedId],
    enabled: Boolean(websiteId && selectedId),
    queryFn: () => api<Notebook>(`/api/websites/${websiteId}/notebooks/${selectedId}`),
  });
  const insightsQuery = useQuery({
    queryKey: ['insights', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Insight[]>(`/api/insights?websiteId=${websiteId}`),
  });

  function select(id: string | null) {
    const params = new URLSearchParams();
    if (websiteId) params.set('website', websiteId);
    if (id) params.set('notebook', id);
    setSearchParams(params, { replace: true });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api<Notebook>(`/api/websites/${websiteId}/notebooks`, {
        method: 'POST',
        body: JSON.stringify({ title: t('notebookUntitled'), content: { blocks: [{ id: blockId(), type: 'text', text: '' }] } }),
      }),
    onSuccess: (notebook) => {
      queryClient.invalidateQueries({ queryKey: ['notebooks', websiteId] });
      select(notebook.id);
    },
  });

  return (
    <Page className="page-notebooks">
      <PageHeader title={t('notebooks')} lead={t('notebooksLead')} backTo="/websites" backLabel={t('websites')} />
      <PageBody>
        {viewOnly ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}
        <div className="field notebooks-website">
          <Label htmlFor="notebooks-website">{t('website')}</Label>
          <select
            id="notebooks-website"
            className="select"
            value={websiteId}
            onChange={(event) => {
              setWebsiteId(event.target.value);
              setSearchParams({ website: event.target.value }, { replace: true });
            }}
          >
            {websites.map((website) => (
              <option key={website.id} value={website.id}>
                {website.name}
              </option>
            ))}
          </select>
        </div>
        <section className="section-gap">
          <MasterDetailLayout
            list={
              <DataViewState
                loading={listQuery.isLoading}
                error={listQuery.isError ? listQuery.error : null}
                onRetry={() => listQuery.refetch()}
                isEmpty={!listQuery.isLoading && !(listQuery.data ?? []).length}
                emptyTitle={t('notebooksEmptyTitle')}
                emptyDescription={t('notebooksEmptyBody')}
              >
                <>
                  {(listQuery.data ?? []).map((notebook) => (
                    <MasterDetailListItem
                      key={notebook.id}
                      selected={selectedId === notebook.id}
                      onSelect={() => select(notebook.id)}
                      title={notebook.title}
                      subtitle={`${t('notebookBlockCount').replace('{count}', String(notebook.blockCount))} · ${formatDateTime(notebook.updatedAt)}`}
                    />
                  ))}
                </>
              </DataViewState>
            }
            detail={
              <MasterDetailPane
                title={notebookQuery.data?.title ?? t('notebooks')}
                description={t('notebookDetailLead')}
                actions={
                  canEdit ? (
                    <Button type="button" variant="secondary" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
                      {t('notebookNew')}
                    </Button>
                  ) : null
                }
              >
                {selectedId ? (
                  <DataViewState
                    loading={notebookQuery.isLoading}
                    error={notebookQuery.isError ? notebookQuery.error : null}
                    onRetry={() => notebookQuery.refetch()}
                  >
                    {notebookQuery.data ? (
                      <NotebookEditor
                        key={notebookQuery.data.id}
                        notebook={notebookQuery.data}
                        insights={insightsQuery.data ?? []}
                        canEdit={canEdit}
                        onDeleted={() => select(null)}
                      />
                    ) : null}
                  </DataViewState>
                ) : (
                  <EmptyState title={t('notebookPickTitle')} description={t('notebookPickBody')} />
                )}
                {createMutation.error ? <p className="text-danger">{(createMutation.error as Error).message}</p> : null}
              </MasterDetailPane>
            }
          />
        </section>
      </PageBody>
    </Page>
  );
}
