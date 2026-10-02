import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ChartLine,
  CirclePlay,
  Eye,
  NotebookPen,
  NotebookText,
  Pencil,
  Plus,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { InsightResultView } from '../components/InsightResultView';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  ResourceSearchField,
} from '../components/master-detail';
import { NotebookMarkdown } from '../components/NotebookMarkdown';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Textarea } from '../components/ui/textarea';
import { pickWorkspaceWebsite, rememberWorkspaceWebsite } from '../components/workspace/workspaceWebsite';
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
import { formatDateTime, formatNumber, formatRelativeTime } from '../lib/format';
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

const BLOCK_ICONS = { text: Type, insight: ChartLine, replay: CirclePlay } as const;

function InsightBlockView({ insight, rangePreset }: { insight: Insight | undefined; rangePreset: BoardRangePreset }) {
  const range = presetToRange(rangePreset);
  const run = useQuery({
    queryKey: ['notebook-insight', insight?.id, rangePreset],
    enabled: Boolean(insight),
    queryFn: () => api<{ data: InsightResult }>(`/api/insights/${insight!.id}/run?${rangeQueryString(range.startAt, range.endAt)}`),
  });
  if (!insight) return <p className="ws-muted-line">{t('notebookInsightMissing')}</p>;
  return (
    <figure className="ws-nb-insight">
      <figcaption className="ws-nb-insight-head">
        <ChartLine aria-hidden />
        <Link to={`/insights?insight=${insight.id}`} className="ws-nb-insight-title">
          {insight.name}
        </Link>
        <span className="ws-nb-insight-range">{t(`boardWidgetPeriod${rangePreset}`)}</span>
      </figcaption>
      <DataViewState
        loading={run.isLoading}
        error={run.isError ? run.error : null}
        onRetry={() => run.refetch()}
        loadingFallback={<Skeleton className="h-48 w-full" />}
      >
        {run.data?.data ? <InsightResultView result={run.data.data} compact /> : null}
      </DataViewState>
    </figure>
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
        className="ws-nb-text-input"
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
          <div className="ws-nb-fields">
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
        <div className="ws-nb-fields">
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
        <Link className="ws-nb-replay" to={`/websites/${websiteId}/sessions/${encodeURIComponent(sessionId)}`}>
          <CirclePlay aria-hidden />
          <span>{block.label?.trim() || t('notebookReplayLink').replace('{id}', sessionId)}</span>
        </Link>
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
      setEditing(false);
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
    <MasterDetailPane
      title={
        editing ? (
          <span className="ws-nb-title-field">
            <Label htmlFor="notebook-title" className="visually-hidden">
              {t('notebookTitle')}
            </Label>
            <Input id="notebook-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </span>
        ) : (
          title
        )
      }
      meta={
        <>
          <span>{t('notebookBlockCount').replace('{count}', formatNumber(blocks.length))}</span>
          {notebook.updatedAt ? (
            <span title={formatDateTime(notebook.updatedAt)}>
              {t('workspaceUpdatedAgo').replace('{time}', formatRelativeTime(notebook.updatedAt))}
            </span>
          ) : null}
        </>
      }
      actions={
        canEdit ? (
          <>
            <Button type="button" variant={editing ? 'ghost' : 'outline'} size="sm" onClick={() => setEditing((value) => !value)}>
              {editing ? <Eye aria-hidden /> : <Pencil aria-hidden />}
              {editing ? t('notebookPreview') : t('edit')}
            </Button>
            {editing || dirty ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!dirty || !title.trim() || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                {t('saveChanges')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="destructive-ghost"
              size="icon-sm"
              aria-label={t('delete')}
              title={t('delete')}
              onClick={() => confirm({ title: deleteTitle(notebook.title), onConfirm: () => deleteMutation.mutate() })}
            >
              <Trash2 aria-hidden />
            </Button>
          </>
        ) : null
      }
    >
      {saveMutation.error ? (
        <p className="text-danger" role="alert">
          {(saveMutation.error as Error).message}
        </p>
      ) : null}

      {!blocks.length && !editing ? (
        <EmptyState icon={<NotebookPen />} title={t('notebookEmptyTitle')} description={t('notebookEmptyBody')} />
      ) : null}

      <ol className={editing ? 'ws-nb-blocks is-editing' : 'ws-nb-blocks'}>
        {blocks.map((block, index) => {
          const Icon = BLOCK_ICONS[block.type];
          return (
            <li key={block.id} className={`ws-nb-block ws-nb-block--${block.type}`}>
              {editing ? (
                <div className="ws-nb-block-toolbar">
                  <span className="ws-nb-block-kind">
                    <Icon aria-hidden />
                    {t(`notebookBlock_${block.type}`)}
                  </span>
                  <span className="ws-nb-block-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === 0}
                      aria-label={t('moveWidgetUp')}
                      title={t('moveWidgetUp')}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === blocks.length - 1}
                      aria-label={t('moveWidgetDown')}
                      title={t('moveWidgetDown')}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('notebookRemoveBlock')}
                      title={t('notebookRemoveBlock')}
                      onClick={() => setBlocks((current) => current.filter((_, i) => i !== index))}
                    >
                      <X aria-hidden />
                    </Button>
                  </span>
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
          );
        })}
      </ol>
      {editing ? (
        <div className="ws-nb-add">
          <Button type="button" variant="outline" size="sm" onClick={() => setBlocks((current) => [...current, newBlock('text')])}>
            <Type aria-hidden />
            {t('notebookAddText')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setBlocks((current) => [...current, newBlock('insight')])}>
            <ChartLine aria-hidden />
            {t('notebookAddInsight')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setBlocks((current) => [...current, newBlock('replay')])}>
            <CirclePlay aria-hidden />
            {t('notebookAddReplay')}
          </Button>
        </div>
      ) : null}
    </MasterDetailPane>
  );
}

export default function NotebooksPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [websiteId, setWebsiteId] = useState(searchParams.get('website') ?? '');
  const [search, setSearch] = useState('');
  const selectedId = searchParams.get('notebook');
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId, 'analytics');

  const websitesQuery = useQuery({ queryKey: ['websites'], queryFn: () => api<Website[]>('/api/websites') });
  const websites = useMemo(() => websitesQuery.data ?? [], [websitesQuery.data]);

  useEffect(() => {
    if (!websiteId && websites.length) setWebsiteId(pickWorkspaceWebsite(websites));
  }, [websiteId, websites]);

  const listQuery = useQuery({
    queryKey: ['notebooks', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<NotebookSummary[]>(`/api/websites/${websiteId}/notebooks`),
  });
  const notebooks = useMemo(
    () => [...(listQuery.data ?? [])].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [listQuery.data],
  );
  const visibleNotebooks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? notebooks.filter((notebook) => notebook.title.toLowerCase().includes(needle)) : notebooks;
  }, [notebooks, search]);

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

  // Lead with a notebook: open the most recently updated one when none is selected.
  useEffect(() => {
    if (!selectedId && notebooks.length) select(notebooks[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, notebooks]);

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

  const newButton = canEdit ? (
    <Button variant="primary" disabled={!websiteId || createMutation.isPending} onClick={() => createMutation.mutate()}>
      <Plus aria-hidden />
      {t('notebookNew')}
    </Button>
  ) : null;

  const headerActions = websites.length ? (
    <div className="ws-header-controls">
      <select
        className="select ws-header-select"
        aria-label={t('website')}
        value={websiteId}
        onChange={(event) => {
          setWebsiteId(event.target.value);
          rememberWorkspaceWebsite(event.target.value);
          setSearch('');
          setSearchParams({ website: event.target.value }, { replace: true });
        }}
      >
        {websites.map((website) => (
          <option key={website.id} value={website.id}>
            {website.name}
          </option>
        ))}
      </select>
      {newButton}
    </div>
  ) : null;

  const listLoading = listQuery.isLoading || (!websiteId && websitesQuery.isLoading);
  const empty = Boolean(websiteId) && !listLoading && !listQuery.isError && !notebooks.length;

  return (
    <Page className="ws-page-notebooks">
      <PageHeader title={t('notebooks')} lead={t('notebooksLead')} actions={headerActions} />
      <PageBody className="stack">
        {viewOnly ? (
          <p className="ws-notice">
            <Eye aria-hidden />
            {t('viewOnlyHint')}
          </p>
        ) : null}
        {createMutation.error ? (
          <p className="text-danger" role="alert">
            {(createMutation.error as Error).message}
          </p>
        ) : null}

        {!websitesQuery.isLoading && !websites.length ? (
          <EmptyState
            variant="rich"
            icon={<NotebookPen />}
            title={t('noWebsites')}
            description={t('workspaceReportsNoWebsite')}
            action={
              <Button variant="primary" render={<Link to="/websites?new=1" />}>
                {t('addWebsite')}
              </Button>
            }
          />
        ) : empty ? (
          <EmptyState
            variant="rich"
            icon={<NotebookPen />}
            title={t('notebooksEmptyTitle')}
            description={t('notebooksEmptyBody')}
            action={newButton ?? undefined}
          />
        ) : (
          <MasterDetailLayout
            listClassName="ws-md-list"
            listHeader={
              <>
                <ResourceSearchField
                  value={search}
                  onChange={setSearch}
                  placeholder={t('workspaceSearchNotebooks')}
                  aria-label={t('workspaceSearchNotebooks')}
                />
                <span className="master-detail-list-count">
                  {t('workspaceNotebookCount').replace('{count}', formatNumber(notebooks.length))}
                </span>
              </>
            }
            list={
              <DataViewState
                loading={listLoading}
                error={listQuery.isError ? listQuery.error : null}
                onRetry={() => listQuery.refetch()}
                loadingFallback={
                  <div className="ws-list-skeleton">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                }
              >
                {visibleNotebooks.length ? (
                  <>
                    {visibleNotebooks.map((notebook) => (
                      <MasterDetailListItem
                        key={notebook.id}
                        selected={selectedId === notebook.id}
                        onSelect={() => select(notebook.id)}
                        icon={<NotebookText aria-hidden />}
                        title={notebook.title}
                        subtitle={t('notebookBlockCount').replace('{count}', formatNumber(notebook.blockCount))}
                        meta={
                          notebook.updatedAt ? (
                            <span title={formatDateTime(notebook.updatedAt)}>{formatRelativeTime(notebook.updatedAt)}</span>
                          ) : undefined
                        }
                      />
                    ))}
                  </>
                ) : (
                  <EmptyState title={t('workspaceNoMatches')} description={t('workspaceNoMatchesHint')} />
                )}
              </DataViewState>
            }
            detail={
              selectedId ? (
                <DataViewState
                  loading={notebookQuery.isLoading}
                  error={notebookQuery.isError ? notebookQuery.error : null}
                  onRetry={() => notebookQuery.refetch()}
                  loadingFallback={
                    <div className="master-detail-pane">
                      <Skeleton className="h-6 w-1/3" />
                      <Skeleton className="mt-6 h-40 w-full" />
                    </div>
                  }
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
                <div className="master-detail-pane ws-pane-empty">
                  <EmptyState
                    icon={<NotebookText />}
                    title={t('notebookPickTitle')}
                    description={t('notebookPickBody')}
                    action={newButton ?? undefined}
                  />
                </div>
              )
            }
          />
        )}
      </PageBody>
    </Page>
  );
}
