import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { CalendarClock, Download, History, Play, Plug, Plus, Save, Table2 } from 'lucide-react';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge, type StatusTone } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { PageTabs } from '../components/quality/PageTabs';
import { RelativeTime } from '../components/quality/RelativeTime';
import { TableSkeleton } from '../components/quality/TableSkeleton';
import {
  DataSourceDialog,
  ReplaceKeyDialog,
  SaveQueryDialog,
  ScheduleDialog,
  WAREHOUSE_SOURCE_TYPES,
  warehouseSourceLabel,
  type DataSourceDraft,
} from '../components/quality/WarehouseDialogs';
import { WarehouseSchemaPanel } from '../components/quality/WarehouseSchemaPanel';
import {
  api,
  type WarehouseDataSource,
  type WarehouseQueryHistoryEntry,
  type WarehouseQueryResponse,
  type WarehouseSavedQuery,
  type WarehouseScheduledQuery,
  type WarehouseSchemaResponse,
} from '../lib/api';
import { downloadCsv } from '../lib/downloadCsv';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

const EXAMPLE_SQL = `SELECT event_name as eventName, url_path as urlPath, created_at as createdAt
FROM website_event
WHERE website_id = ?1
ORDER BY created_at DESC
LIMIT 50`;

const WAREHOUSE_TABS = ['query', 'saved', 'history', 'schedules', 'sources'] as const;
type WarehouseTab = (typeof WAREHOUSE_TABS)[number];
type Dialog = 'save' | 'schedule' | 'source' | { replaceKey: WarehouseDataSource } | null;

function isSupportedSource(type: string) {
  return WAREHOUSE_SOURCE_TYPES.some((item) => item.id === type);
}

function displayValue(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Columns whose non-null values are all numbers read right-aligned with tabular figures. */
function numericColumns(result: WarehouseQueryResponse) {
  const out = new Set<string>();
  for (const column of result.columns) {
    let seen = false;
    let numeric = true;
    for (const row of result.rows) {
      const value = row[column];
      if (value == null) continue;
      seen = true;
      if (typeof value !== 'number') {
        numeric = false;
        break;
      }
    }
    if (seen && numeric) out.add(column);
  }
  return out;
}

function sqlPreview(sql: string, max = 140) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export default function WebsiteWarehousePage() {
  const confirm = useConfirm();
  const { websiteId = '' } = useParams<{ websiteId: string }>();
  const queryClient = useQueryClient();
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId, 'warehouse');
  const [tab, setTab] = useState<WarehouseTab>('query');
  const [sql, setSql] = useState(EXAMPLE_SQL);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [exportState, setExportState] = useState<{ pending: boolean; error: string | null; truncatedAt: number | null }>({
    pending: false,
    error: null,
    truncatedAt: null,
  });

  const schemaQuery = useQuery({
    queryKey: ['warehouse-schema', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<WarehouseSchemaResponse>(`/api/websites/${websiteId}/warehouse/schema`),
  });

  const savedQuery = useQuery({
    queryKey: ['warehouse-saved', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<{ savedQueries: WarehouseSavedQuery[] }>(`/api/websites/${websiteId}/warehouse/saved-queries`),
  });

  const historyQuery = useQuery({
    queryKey: ['warehouse-history', websiteId],
    enabled: Boolean(websiteId) && tab === 'history',
    queryFn: () => api<{ history: WarehouseQueryHistoryEntry[] }>(`/api/websites/${websiteId}/warehouse/history?limit=50`),
  });

  const schedulesQuery = useQuery({
    queryKey: ['warehouse-schedules', websiteId],
    enabled: Boolean(websiteId) && tab === 'schedules',
    queryFn: () => api<{ schedules: WarehouseScheduledQuery[] }>(`/api/websites/${websiteId}/warehouse/schedules`),
  });

  const sourcesQuery = useQuery({
    queryKey: ['warehouse-sources', websiteId],
    enabled: Boolean(websiteId) && tab === 'sources',
    queryFn: () => api<{ dataSources: WarehouseDataSource[] }>(`/api/websites/${websiteId}/warehouse/data-sources`),
  });

  const queryMutation = useMutation({
    mutationFn: () =>
      api<WarehouseQueryResponse>(`/api/websites/${websiteId}/warehouse/query`, {
        method: 'POST',
        body: JSON.stringify({ sql }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-history', websiteId] });
    },
  });

  const saveQueryMutation = useMutation({
    mutationFn: (name: string) =>
      api<WarehouseSavedQuery>(`/api/websites/${websiteId}/warehouse/saved-queries`, {
        method: 'POST',
        body: JSON.stringify({ name, sql }),
      }),
    onSuccess: () => {
      setDialog(null);
      queryClient.invalidateQueries({ queryKey: ['warehouse-saved', websiteId] });
    },
  });

  const deleteSavedMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/warehouse/saved-queries/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-saved', websiteId] }),
  });

  const createScheduleMutation = useMutation({
    mutationFn: (draft: { name: string; intervalMinutes: number }) =>
      api<WarehouseScheduledQuery>(`/api/websites/${websiteId}/warehouse/schedules`, {
        method: 'POST',
        body: JSON.stringify({ name: draft.name, sql, intervalMinutes: draft.intervalMinutes, enabled: true }),
      }),
    onSuccess: () => {
      setDialog(null);
      queryClient.invalidateQueries({ queryKey: ['warehouse-schedules', websiteId] });
    },
  });

  const runSchedulesMutation = useMutation({
    mutationFn: () => api(`/api/websites/${websiteId}/warehouse/schedules/run-due`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-schedules', websiteId] }),
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/warehouse/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-schedules', websiteId] }),
  });

  const updateScheduleMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<WarehouseScheduledQuery> }) =>
      api<WarehouseScheduledQuery>(`/api/websites/${websiteId}/warehouse/schedules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-schedules', websiteId] }),
  });

  const createSourceMutation = useMutation({
    mutationFn: (draft: DataSourceDraft) => {
      let config: Record<string, unknown> = {};
      if (draft.type === 'stripe') {
        // The key goes to the API once; it is stored encrypted and never returned.
        config = { apiKey: draft.apiKey.trim() };
      } else {
        try {
          config = JSON.parse(draft.configText) as Record<string, unknown>;
        } catch {
          throw new Error(t('warehouseInvalidJsonConfig'));
        }
      }
      return api<WarehouseDataSource>(`/api/websites/${websiteId}/warehouse/data-sources`, {
        method: 'POST',
        body: JSON.stringify({ name: draft.name.trim(), type: draft.type, enabled: true, config }),
      });
    },
    onSuccess: () => {
      setDialog(null);
      queryClient.invalidateQueries({ queryKey: ['warehouse-sources', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-schema', websiteId] });
    },
  });

  const replaceKeyMutation = useMutation({
    mutationFn: ({ id, apiKey }: { id: string; apiKey: string }) =>
      api<WarehouseDataSource>(`/api/websites/${websiteId}/warehouse/data-sources/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ config: { apiKey: apiKey.trim() } }),
      }),
    onSuccess: () => {
      setDialog(null);
      queryClient.invalidateQueries({ queryKey: ['warehouse-sources', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-schema', websiteId] });
    },
  });

  const deleteSourceMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/warehouse/data-sources/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-sources', websiteId] }),
  });

  // Why the last Sync now did nothing, per source (a skip changes nothing the list would show).
  const [syncNotice, setSyncNotice] = useState<Record<string, string>>({});
  const syncSourceMutation = useMutation({
    mutationFn: (id: string) =>
      api<{ skipped?: boolean; reason?: 'too_soon' | 'disabled' }>(`/api/websites/${websiteId}/warehouse/data-sources/${id}/sync`, {
        method: 'POST',
      }),
    onSuccess: (result, id) => {
      const notice =
        result.reason === 'too_soon' ? t('warehouseSyncTooSoon') : result.reason === 'disabled' ? t('warehouseSyncDisabled') : null;
      setSyncNotice((current) => {
        const next = { ...current };
        if (notice) next[id] = notice;
        else delete next[id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['warehouse-sources', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-schema', websiteId] });
    },
  });

  const exportCsv = () => {
    setExportState({ pending: true, error: null, truncatedAt: null });
    downloadCsv(`/api/websites/${websiteId}/warehouse/query/export`, `${websiteId}-warehouse.csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    })
      .then((outcome) => {
        setExportState({ pending: false, error: null, truncatedAt: outcome.truncated ? outcome.rowCap : null });
        queryClient.invalidateQueries({ queryKey: ['warehouse-history', websiteId] });
      })
      .catch((error: unknown) =>
        setExportState({ pending: false, error: error instanceof Error ? error.message : t('exportFailed'), truncatedAt: null }),
      );
  };

  const runQuery = () => {
    if (sql.trim() && !queryMutation.isPending) queryMutation.mutate();
  };

  const loadSql = (next: string) => {
    setSql(next);
    setTab('query');
  };

  const result = queryMutation.data;
  const queryError = queryMutation.error ? (queryMutation.error as Error).message : null;
  const diagnostics = result?.analysis.diagnostics ?? [];
  const limits = schemaQuery.data?.limits;
  const numeric = useMemo(() => (result ? numericColumns(result) : new Set<string>()), [result]);

  const savedQueries = savedQuery.data?.savedQueries ?? [];
  const history = historyQuery.data?.history ?? [];
  const schedules = schedulesQuery.data?.schedules ?? [];
  const dataSources = sourcesQuery.data?.dataSources ?? [];

  return (
    <Page className="q-page q-page--warehouse">
      <PageHeader title={t('dataWarehouse')} lead={t('dataWarehouseLead')} />

      <PageBody className="stack">
        {viewOnly ? <p className="q-view-only">{t('viewOnlyHint')}</p> : null}

        <PageTabs
          label={t('dataWarehouse')}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'query', label: t('warehouseTabQuery') },
            { id: 'saved', label: t('warehouseTabSaved'), count: savedQueries.length || undefined },
            { id: 'history', label: t('warehouseTabHistory') },
            { id: 'schedules', label: t('warehouseTabSchedules') },
            { id: 'sources', label: t('warehouseTabSources') },
          ]}
        />

        {tab === 'query' ? (
          <div className="q-warehouse">
            <div className="stack q-warehouse-main">
              <SectionCard
                flush
                className="q-editor-card"
                title={t('warehouseSql')}
                description={t('warehouseSafetyHint')}
                actions={
                  <>
                    {canEdit ? (
                      <Button type="button" variant="outline" size="sm" disabled={!sql.trim()} onClick={() => setDialog('save')}>
                        <Save aria-hidden />
                        {t('save')}
                      </Button>
                    ) : null}
                    <Button type="button" variant="outline" size="sm" disabled={!sql.trim() || exportState.pending} onClick={exportCsv}>
                      <Download aria-hidden />
                      {exportState.pending ? t('loading') : t('exportCsv')}
                    </Button>
                    <Button type="button" variant="primary" size="sm" disabled={!sql.trim() || queryMutation.isPending} onClick={runQuery}>
                      <Play aria-hidden />
                      {queryMutation.isPending ? t('loading') : t('runQuery')}
                      <kbd className="q-kbd">⌘↵</kbd>
                    </Button>
                  </>
                }
                footer={
                  <>
                    <span className="q-editor-diagnostics" aria-label={t('warehouseDiagnostics')}>
                      {diagnostics.map((item) => (
                        <StatusBadge
                          key={`${item.code}-${item.message}`}
                          tone={item.level === 'error' ? 'danger' : item.level === 'warning' ? 'warning' : 'success'}
                        >
                          {item.message}
                        </StatusBadge>
                      ))}
                    </span>
                    {limits ? (
                      <span
                        className="q-editor-limits"
                        title={`${t('warehouseLimitsHint')
                          .replace('{maxRows}', formatNumber(limits.maxUserLimit))
                          .replace('{defaultRows}', formatNumber(limits.defaultLimit))
                          .replace('{scanRows}', formatNumber(limits.maxRowsRead))
                          .replace('{seconds}', formatNumber(limits.timeoutMs / 1000))} ${t('warehouseExportHint').replace(
                          '{count}',
                          formatNumber(limits.exportRowCap),
                        )}`}
                      >
                        {t('qualityWarehouseLimitsShort')
                          .replace('{maxRows}', formatNumber(limits.maxUserLimit))
                          .replace('{seconds}', formatNumber(limits.timeoutMs / 1000))}
                      </span>
                    ) : null}
                  </>
                }
              >
                <textarea
                  className="q-sql"
                  value={sql}
                  onChange={(event) => setSql(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      runQuery();
                    }
                  }}
                  spellCheck={false}
                  aria-label={t('warehouseSql')}
                />
              </SectionCard>

              <SectionCard
                flush
                title={t('queryResults')}
                description={
                  result ? (
                    <span className="meta-line">
                      <span>{t('warehouseRowsReturned').replace('{count}', formatNumber(result.rowCount))}</span>
                      <span>
                        {t('warehouseQueryCost')
                          .replace('{rows}', formatNumber(result.cost.rowsRead))
                          .replace('{ms}', formatNumber(Math.round(result.cost.durationMs)))}
                      </span>
                      {result.analysis.autoLimit ? (
                        <span>{t('warehouseLimitApplied').replace('{count}', formatNumber(result.analysis.autoLimit))}</span>
                      ) : null}
                    </span>
                  ) : (
                    t('warehouseResultsLead')
                  )
                }
              >
                {queryError || exportState.error ? (
                  <div className="q-alert q-alert--danger" role="alert">
                    <strong>{t('warehouseQueryFailed')}</strong>
                    <span className="mono">{queryError ?? exportState.error}</span>
                  </div>
                ) : null}
                {exportState.truncatedAt ? (
                  <p className="q-inline-alert" role="status">
                    {t('warehouseExportTruncated').replace('{count}', formatNumber(exportState.truncatedAt))}
                  </p>
                ) : null}
                {queryMutation.isPending && !result ? (
                  <TableSkeleton rows={6} columns={4} />
                ) : result?.rows.length ? (
                  <div className="q-table-sticky q-results">
                    <table className="data-table q-results-table">
                      <thead>
                        <tr>
                          {result.columns.map((column) => (
                            <th key={column} className={cn('mono', numeric.has(column) && 'num')}>
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row, index) => (
                          <tr key={index}>
                            {result.columns.map((column) => {
                              const value = displayValue(row[column]);
                              return (
                                <td key={column} className={cn(numeric.has(column) && 'num')} title={value ?? undefined}>
                                  {value === null ? <span className="q-null">null</span> : value}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Table2 />}
                    title={result ? t('warehouseEmptyTitle') : t('qualityRunToSee')}
                    description={t('warehouseEmptyBody')}
                  />
                )}
              </SectionCard>
            </div>

            <WarehouseSchemaPanel schema={schemaQuery.data} loading={schemaQuery.isLoading} onUseSql={setSql} />
          </div>
        ) : null}

        {tab === 'saved' ? (
          <SectionCard
            flush
            title={t('warehouseSavedQueries')}
            description={t('warehouseSavedQueriesLead')}
            actions={
              canEdit ? (
                <Button type="button" size="sm" disabled={!sql.trim()} onClick={() => setDialog('save')}>
                  <Plus aria-hidden />
                  {t('qualitySaveCurrentQuery')}
                </Button>
              ) : null
            }
          >
            <DataViewState
              loading={savedQuery.isLoading}
              error={savedQuery.isError ? savedQuery.error : null}
              onRetry={() => savedQuery.refetch()}
              loadingFallback={<TableSkeleton rows={4} columns={3} />}
            >
              {savedQueries.length ? (
                <div className="table-scroll">
                  <table className="data-table data-table--interactive">
                    <thead>
                      <tr>
                        <th>{t('name')}</th>
                        <th>{t('warehouseSql')}</th>
                        <th>{t('created')}</th>
                        <th className="q-col-actions">
                          <span className="sr-only">{t('actions')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {savedQueries.map((item) => (
                        <tr key={item.id} onClick={() => loadSql(item.sql)}>
                          <td>
                            <div className="q-issue-copy">
                              <span className="q-trace-root">{item.name}</span>
                              {item.description ? <span className="q-issue-meta">{item.description}</span> : null}
                            </div>
                          </td>
                          <td className="mono q-sql-preview" title={item.sql}>
                            {sqlPreview(item.sql)}
                          </td>
                          <td className="q-col-when">
                            <RelativeTime value={item.createdAt} />
                          </td>
                          <td className="q-col-actions q-row-actions" onClick={(event) => event.stopPropagation()}>
                            <Button type="button" variant="ghost" size="sm" onClick={() => loadSql(item.sql)}>
                              {t('warehouseLoadQuery')}
                            </Button>
                            {canEdit ? (
                              <Button
                                type="button"
                                variant="destructive-ghost"
                                size="sm"
                                onClick={() => confirm({ title: deleteTitle(item.name), onConfirm: () => deleteSavedMutation.mutate(item.id) })}
                              >
                                {t('delete')}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={<Save />}
                  title={t('warehouseNoSavedQueries')}
                  description={t('qualitySavedQueriesEmpty')}
                  action={
                    canEdit ? (
                      <Button type="button" size="sm" variant="outline" disabled={!sql.trim()} onClick={() => setDialog('save')}>
                        {t('qualitySaveCurrentQuery')}
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </DataViewState>
          </SectionCard>
        ) : null}

        {tab === 'history' ? (
          <SectionCard flush title={t('warehouseQueryHistory')} description={t('warehouseQueryHistoryLead')}>
            <DataViewState
              loading={historyQuery.isLoading}
              error={historyQuery.isError ? historyQuery.error : null}
              onRetry={() => historyQuery.refetch()}
              loadingFallback={<TableSkeleton rows={6} columns={4} />}
            >
              {history.length ? (
                <div className="table-scroll">
                  <table className="data-table data-table--interactive">
                    <thead>
                      <tr>
                        <th>{t('status')}</th>
                        <th>{t('warehouseSql')}</th>
                        <th className="num">{t('qualityRows')}</th>
                        <th className="num">{t('qualityDuration')}</th>
                        <th>{t('when')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((entry) => (
                        <tr key={entry.id} onClick={() => loadSql(entry.sql)} title={t('warehouseLoadQuery')}>
                          <td>
                            <StatusBadge tone={entry.status === 'success' ? 'success' : 'danger'}>
                              {entry.status === 'success' ? t('qualitySucceeded') : t('qualityFailed')}
                            </StatusBadge>
                          </td>
                          <td className="q-sql-preview">
                            <span className="mono" title={entry.sql}>
                              {sqlPreview(entry.sql, 120)}
                            </span>
                            {entry.error ? <span className="q-cell-error">{entry.error}</span> : null}
                          </td>
                          <td className="num">{formatNumber(entry.rowCount)}</td>
                          <td className="num">{formatNumber(Math.round(entry.durationMs))} ms</td>
                          <td className="q-col-when">
                            <RelativeTime value={entry.createdAt} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon={<History />} title={t('warehouseNoHistory')} description={t('warehouseQueryHistoryLead')} />
              )}
            </DataViewState>
          </SectionCard>
        ) : null}

        {tab === 'schedules' ? (
          <SectionCard
            flush
            title={t('warehouseScheduledQueries')}
            description={t('warehouseAutomationCronHint')}
            actions={
              canEdit ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={runSchedulesMutation.isPending}
                    onClick={() => runSchedulesMutation.mutate()}
                  >
                    <Play aria-hidden />
                    {t('warehouseRunSchedules')}
                  </Button>
                  <Button type="button" size="sm" disabled={!sql.trim()} onClick={() => setDialog('schedule')}>
                    <Plus aria-hidden />
                    {t('qualityNewSchedule')}
                  </Button>
                </>
              ) : null
            }
          >
            <DataViewState
              loading={schedulesQuery.isLoading}
              error={schedulesQuery.isError ? schedulesQuery.error : null}
              onRetry={() => schedulesQuery.refetch()}
              loadingFallback={<TableSkeleton rows={4} columns={5} />}
            >
              {schedules.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('name')}</th>
                        <th>{t('qualityEvery')}</th>
                        <th>{t('warehouseScheduleNextRun')}</th>
                        <th>{t('warehouseScheduleLastRun')}</th>
                        <th>{t('warehouseScheduleLastStatus')}</th>
                        <th>{t('enabled')}</th>
                        {canEdit ? (
                          <th className="q-col-actions">
                            <span className="sr-only">{t('actions')}</span>
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {schedules.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <div className="q-issue-copy">
                              <span className="q-trace-root">{item.name}</span>
                              <span className="q-issue-meta mono" title={item.sql}>
                                {sqlPreview(item.sql, 80)}
                              </span>
                            </div>
                          </td>
                          <td className="q-col-muted">{t('qualityMinutes').replace('{count}', formatNumber(item.intervalMinutes))}</td>
                          <td className="q-col-when">
                            <RelativeTime value={item.nextRunAt} short />
                          </td>
                          <td className="q-col-when">
                            <RelativeTime value={item.lastRunAt} />
                          </td>
                          <td>
                            {item.lastStatus ? (
                              <StatusBadge tone={item.lastStatus === 'success' ? 'success' : 'danger'}>
                                {item.lastStatus === 'success' ? t('qualitySucceeded') : t('qualityFailed')}
                                {item.lastRowCount != null && item.lastStatus === 'success'
                                  ? ` · ${formatNumber(item.lastRowCount)}`
                                  : ''}
                              </StatusBadge>
                            ) : (
                              <span className="q-col-muted">-</span>
                            )}
                            {item.lastError ? <span className="q-cell-error">{item.lastError}</span> : null}
                          </td>
                          <td>
                            {canEdit ? (
                              <Switch
                                checked={item.enabled}
                                aria-label={`${item.enabled ? t('disable') : t('enable')}: ${item.name}`}
                                onCheckedChange={(enabled) => updateScheduleMutation.mutate({ id: item.id, patch: { enabled } })}
                              />
                            ) : (
                              <StatusBadge tone={item.enabled ? 'success' : 'neutral'}>
                                {item.enabled ? t('enabled') : t('disabled')}
                              </StatusBadge>
                            )}
                          </td>
                          {canEdit ? (
                            <td className="q-col-actions">
                              <Button
                                type="button"
                                variant="destructive-ghost"
                                size="sm"
                                onClick={() => confirm({ title: deleteTitle(item.name), onConfirm: () => deleteScheduleMutation.mutate(item.id) })}
                              >
                                {t('delete')}
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={<CalendarClock />}
                  title={t('warehouseNoSchedules')}
                  description={t('warehouseScheduledQueriesLead')}
                />
              )}
            </DataViewState>
          </SectionCard>
        ) : null}

        {tab === 'sources' ? (
          <SectionCard
            flush
            title={t('warehouseDataSources')}
            description={t('warehouseDataSourcesLead')}
            actions={
              canEdit ? (
                <Button type="button" size="sm" onClick={() => setDialog('source')}>
                  <Plus aria-hidden />
                  {t('qualityNewDataSource')}
                </Button>
              ) : null
            }
          >
            <DataViewState
              loading={sourcesQuery.isLoading}
              error={sourcesQuery.isError ? sourcesQuery.error : null}
              onRetry={() => sourcesQuery.refetch()}
              loadingFallback={<TableSkeleton rows={3} columns={5} />}
            >
              {dataSources.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('name')}</th>
                        <th>{t('warehouseDataSourceType')}</th>
                        <th>{t('status')}</th>
                        <th>{t('warehouseLastSync')}</th>
                        <th>{t('created')}</th>
                        {canEdit ? (
                          <th className="q-col-actions">
                            <span className="sr-only">{t('actions')}</span>
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {dataSources.map((item) => {
                        const supported = isSupportedSource(item.type);
                        const keyHint = typeof item.config.apiKeyHint === 'string' ? item.config.apiKeyHint : null;
                        const status = sourceStatus(item);
                        return (
                          <tr key={item.id}>
                            <td>
                              <div className="q-issue-copy">
                                <span className="q-trace-root">{item.name}</span>
                                {keyHint ? (
                                  <span className="q-issue-meta mono">{t('warehouseStripeKeyHint').replace('{hint}', keyHint)}</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="q-col-muted">{warehouseSourceLabel(item.type)}</td>
                            <td>
                              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                              {!supported ? <span className="q-cell-error">{t('warehouseSourceUnsupported')}</span> : null}
                            </td>
                            <td className="q-col-when">
                              <RelativeTime value={item.lastSyncAt} />
                              {item.lastError ? <span className="q-cell-error">{item.lastError}</span> : null}
                              {syncNotice[item.id] ? (
                                <span className="q-issue-meta" role="status">
                                  {syncNotice[item.id]}
                                </span>
                              ) : null}
                            </td>
                            <td className="q-col-when">
                              <RelativeTime value={item.createdAt} />
                            </td>
                            {canEdit ? (
                              <td className="q-col-actions q-row-actions">
                                {supported ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={syncSourceMutation.isPending}
                                    onClick={() => syncSourceMutation.mutate(item.id)}
                                  >
                                    {t('warehouseSyncNow')}
                                  </Button>
                                ) : null}
                                {item.type === 'stripe' ? (
                                  <Button type="button" variant="ghost" size="sm" onClick={() => setDialog({ replaceKey: item })}>
                                    {t('warehouseReplaceKey')}
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="destructive-ghost"
                                  size="sm"
                                  onClick={() => confirm({ title: deleteTitle(item.name), onConfirm: () => deleteSourceMutation.mutate(item.id) })}
                                >
                                  {t('delete')}
                                </Button>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={<Plug />}
                  title={t('warehouseNoDataSources')}
                  description={t('warehouseAutomationCronHint')}
                  action={
                    canEdit ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => setDialog('source')}>
                        {t('qualityNewDataSource')}
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </DataViewState>
          </SectionCard>
        ) : null}
      </PageBody>

      {dialog === 'save' ? (
        <SaveQueryDialog
          sql={sql}
          pending={saveQueryMutation.isPending}
          error={saveQueryMutation.error}
          onSave={(name) => saveQueryMutation.mutate(name)}
          onClose={() => {
            setDialog(null);
            saveQueryMutation.reset();
          }}
        />
      ) : null}
      {dialog === 'schedule' ? (
        <ScheduleDialog
          sql={sql}
          pending={createScheduleMutation.isPending}
          error={createScheduleMutation.error}
          onCreate={(draft) => createScheduleMutation.mutate(draft)}
          onClose={() => {
            setDialog(null);
            createScheduleMutation.reset();
          }}
        />
      ) : null}
      {dialog === 'source' ? (
        <DataSourceDialog
          pending={createSourceMutation.isPending}
          error={createSourceMutation.error}
          onCreate={(draft) => createSourceMutation.mutate(draft)}
          onClose={() => {
            setDialog(null);
            createSourceMutation.reset();
          }}
        />
      ) : null}
      {dialog && typeof dialog === 'object' ? (
        <ReplaceKeyDialog
          sourceName={dialog.replaceKey.name}
          pending={replaceKeyMutation.isPending}
          error={replaceKeyMutation.error}
          onReplace={(apiKey) => replaceKeyMutation.mutate({ id: dialog.replaceKey.id, apiKey })}
          onClose={() => {
            setDialog(null);
            replaceKeyMutation.reset();
          }}
        />
      ) : null}
    </Page>
  );
}

/** One status per source: disabled, importing, failed, connected, or just enabled. */
function sourceStatus(item: WarehouseDataSource): { tone: StatusTone; label: string } {
  if (!item.enabled) return { tone: 'neutral', label: t('disabled') };
  if (item.lastStatus === 'syncing') {
    return { tone: 'info', label: item.type === 'stripe' ? t('warehouseSourceBackfilling') : t('qualitySyncing') };
  }
  if (item.lastStatus === 'failed') return { tone: 'danger', label: t('qualityFailed') };
  if (item.lastStatus === 'connected') return { tone: 'success', label: t('qualityConnected') };
  return { tone: 'neutral', label: t('enabled') };
}
