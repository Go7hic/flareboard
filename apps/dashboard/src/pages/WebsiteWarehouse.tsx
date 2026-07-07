import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Database } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { MasterDetailLayout } from '../components/master-detail';
import { SegmentTabs } from '../components/SegmentTabs';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  api,
  type WarehouseDataSource,
  type WarehouseQueryHistoryEntry,
  type WarehouseQueryResponse,
  type WarehouseSavedQuery,
  type WarehouseScheduledQuery,
  type WarehouseSchemaResponse,
} from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

const EXAMPLE_SQL = `SELECT event_name as eventName, url_path as urlPath, created_at as createdAt
FROM website_event
WHERE website_id = ?1
ORDER BY created_at DESC
LIMIT 50`;

const WAREHOUSE_TABS = ['query', 'saved', 'history', 'schedules', 'sources'] as const;
type WarehouseTab = (typeof WAREHOUSE_TABS)[number];

function displayValue(value: unknown) {
  if (value == null) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatTime(value: number | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export default function WebsiteWarehousePage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const queryClient = useQueryClient();
  const { canEdit } = useWebsitePermissions(websiteId, 'warehouse');
  const [tab, setTab] = useState<WarehouseTab>('query');
  const [sql, setSql] = useState(EXAMPLE_SQL);
  const [savedName, setSavedName] = useState('');
  const [scheduleDraft, setScheduleDraft] = useState({ name: '', intervalMinutes: 60 });
  const [sourceDraft, setSourceDraft] = useState({
    name: '',
    type: 'http_json' as WarehouseDataSource['type'],
    configText: '{\n  "url": "https://example.com/data.json"\n}',
  });

  const schemaQuery = useQuery({
    queryKey: ['warehouse-schema', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<WarehouseSchemaResponse>(`/api/websites/${websiteId}/warehouse/schema`),
  });

  const savedQuery = useQuery({
    queryKey: ['warehouse-saved', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<{ savedQueries: WarehouseSavedQuery[] }>(`/api/websites/${websiteId}/warehouse/saved-queries`),
  });

  const historyQuery = useQuery({
    queryKey: ['warehouse-history', websiteId],
    enabled: Boolean(websiteId) && tab === 'history',
    queryFn: () =>
      api<{ history: WarehouseQueryHistoryEntry[] }>(`/api/websites/${websiteId}/warehouse/history?limit=50`),
  });

  const schedulesQuery = useQuery({
    queryKey: ['warehouse-schedules', websiteId],
    enabled: Boolean(websiteId) && tab === 'schedules',
    queryFn: () =>
      api<{ schedules: WarehouseScheduledQuery[] }>(`/api/websites/${websiteId}/warehouse/schedules`),
  });

  const sourcesQuery = useQuery({
    queryKey: ['warehouse-sources', websiteId],
    enabled: Boolean(websiteId) && tab === 'sources',
    queryFn: () =>
      api<{ dataSources: WarehouseDataSource[] }>(`/api/websites/${websiteId}/warehouse/data-sources`),
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
    mutationFn: () =>
      api<WarehouseSavedQuery>(`/api/websites/${websiteId}/warehouse/saved-queries`, {
        method: 'POST',
        body: JSON.stringify({ name: savedName.trim(), sql }),
      }),
    onSuccess: () => {
      setSavedName('');
      queryClient.invalidateQueries({ queryKey: ['warehouse-saved', websiteId] });
    },
  });

  const deleteSavedMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/websites/${websiteId}/warehouse/saved-queries/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-saved', websiteId] }),
  });

  const createScheduleMutation = useMutation({
    mutationFn: () =>
      api<WarehouseScheduledQuery>(`/api/websites/${websiteId}/warehouse/schedules`, {
        method: 'POST',
        body: JSON.stringify({
          name: scheduleDraft.name.trim(),
          sql,
          intervalMinutes: Number(scheduleDraft.intervalMinutes),
          enabled: true,
        }),
      }),
    onSuccess: () => {
      setScheduleDraft({ name: '', intervalMinutes: 60 });
      queryClient.invalidateQueries({ queryKey: ['warehouse-schedules', websiteId] });
    },
  });

  const runSchedulesMutation = useMutation({
    mutationFn: () =>
      api(`/api/websites/${websiteId}/warehouse/schedules/run-due`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-schedules', websiteId] }),
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/websites/${websiteId}/warehouse/schedules/${id}`, { method: 'DELETE' }),
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
    mutationFn: () => {
      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(sourceDraft.configText) as Record<string, unknown>;
      } catch {
        throw new Error(t('warehouseInvalidJsonConfig'));
      }
      return api<WarehouseDataSource>(`/api/websites/${websiteId}/warehouse/data-sources`, {
        method: 'POST',
        body: JSON.stringify({
          name: sourceDraft.name.trim(),
          type: sourceDraft.type,
          enabled: true,
          config,
        }),
      });
    },
    onSuccess: () => {
      setSourceDraft((prev) => ({ ...prev, name: '' }));
      queryClient.invalidateQueries({ queryKey: ['warehouse-sources', websiteId] });
    },
  });

  const deleteSourceMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/websites/${websiteId}/warehouse/data-sources/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-sources', websiteId] }),
  });

  const syncSourceMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/websites/${websiteId}/warehouse/data-sources/${id}/sync`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-sources', websiteId] }),
  });

  const result = queryMutation.data;
  const diagnostics =
    queryMutation.data?.analysis.diagnostics ??
    (queryMutation.error
      ? [{ code: 'query_error', level: 'error' as const, message: (queryMutation.error as Error).message }]
      : []);

  const savedQueries = savedQuery.data?.savedQueries ?? [];
  const history = historyQuery.data?.history ?? [];
  const schedules = schedulesQuery.data?.schedules ?? [];
  const dataSources = sourcesQuery.data?.dataSources ?? [];

  return (
    <div className="page page-warehouse">
      <WebsitePageShell websiteId={websiteId} />

      {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

      <div className="section-gap">
        <SegmentTabs
          aria-label={t('dataWarehouse')}
          value={tab}
          onChange={(id) => setTab(id as WarehouseTab)}
          tabs={[
            { id: 'query', label: t('warehouseTabQuery') },
            { id: 'saved', label: t('warehouseTabSaved') },
            { id: 'history', label: t('warehouseTabHistory') },
            { id: 'schedules', label: t('warehouseTabSchedules') },
            { id: 'sources', label: t('warehouseTabSources') },
          ]}
        />
      </div>

      {tab === 'query' ? (
        <MasterDetailLayout
          className="master-detail-layout--warehouse section-gap"
          wrapList={false}
          list={
          <section className="panel">
            <header className="panel-header">
              <div>
                <h2 className="section-title">{t('dataWarehouse')}</h2>
                <p className="text-muted">{t('dataWarehouseLead')}</p>
              </div>
              <Database size={20} strokeWidth={2} aria-hidden />
            </header>

            <div className="warehouse-query">
              <textarea
                className="textarea warehouse-sql"
                value={sql}
                onChange={(event) => setSql(event.target.value)}
                spellCheck={false}
                aria-label={t('warehouseSql')}
              />
              <div className="warehouse-toolbar">
                <p className="text-muted">{t('warehouseSafetyHint')}</p>
                <Button
                  type="button"
                  variant="primary"
                  disabled={!sql.trim() || queryMutation.isPending}
                  onClick={() => queryMutation.mutate()}
                >
                  {queryMutation.isPending ? t('loading') : t('runQuery')}
                </Button>
              </div>
            </div>

            {diagnostics.length ? (
              <div className="warehouse-diagnostics" aria-label={t('warehouseDiagnostics')}>
                {diagnostics.map((item) => (
                  <span key={`${item.code}-${item.message}`} className={`badge warehouse-diagnostic-${item.level}`}>
                    {item.message}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
          }
          detail={
          <aside className="panel warehouse-dictionary">
            <header className="panel-header">
              <div>
                <h2 className="section-title">{t('warehouseDictionary')}</h2>
                <p className="text-muted">{t('warehouseDictionaryLead')}</p>
              </div>
            </header>

            <div className="warehouse-examples">
              <h3 className="section-title experiment-title">{t('warehouseExamples')}</h3>
              {(schemaQuery.data?.examples ?? []).map((example) => (
                <button
                  type="button"
                  key={example.name}
                  className="warehouse-example-btn"
                  onClick={() => setSql(example.sql)}
                >
                  <span>{example.name}</span>
                  {example.category ? <span className="text-muted">{example.category}</span> : null}
                </button>
              ))}
            </div>

            <div className="warehouse-table-list">
              {(schemaQuery.data?.tables ?? []).map((table) => (
                <details key={table.name} className="warehouse-table-card">
                  <summary>{table.name}</summary>
                  <p className="text-muted">{table.description}</p>
                  <div className="warehouse-column-list">
                    {table.columns.map((column) => (
                      <code key={column}>{column}</code>
                    ))}
                  </div>
                </details>
              ))}
              {schemaQuery.isLoading ? <div className="skeleton skeleton-block" aria-busy /> : null}
            </div>
          </aside>
          }
        />
      ) : null}

      {tab === 'saved' ? (
        <section className="panel section-gap">
          <header className="panel-header">
            <div>
              <h2 className="section-title">{t('warehouseSavedQueries')}</h2>
              <p className="text-muted">{t('warehouseSavedQueriesLead')}</p>
            </div>
          </header>
          {canEdit ? (
            <div className="form-row">
              <div className="field">
                <Label htmlFor="warehouse-saved-name">{t('warehouseSavedQueryName')}</Label>
                <Input
                  id="warehouse-saved-name"
                  value={savedName}
                  onChange={(event) => setSavedName(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="primary"
                disabled={!savedName.trim() || !sql.trim() || saveQueryMutation.isPending}
                onClick={() => saveQueryMutation.mutate()}
              >
                {saveQueryMutation.isPending ? t('saving') : t('warehouseSaveQuery')}
              </Button>
            </div>
          ) : null}
          {savedQueries.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('name')}</th>
                    <th>{t('description')}</th>
                    <th>{t('created')}</th>
                    <th className="cohorts-actions-col">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {savedQueries.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td className="text-muted">{item.description || '-'}</td>
                      <td className="text-muted">{formatTime(item.createdAt)}</td>
                      <td className="cohorts-actions-col">
                        <div className="cohorts-row-actions">
                          <Button type="button" variant="ghost" size="sm" onClick={() => { setSql(item.sql); setTab('query'); }}>
                            {t('warehouseLoadQuery')}
                          </Button>
                          {canEdit ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="btn-danger-text"
                              onClick={() => deleteSavedMutation.mutate(item.id)}
                            >
                              {t('delete')}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t('warehouseNoSavedQueries')} description={t('warehouseSavedQueriesLead')} />
          )}
        </section>
      ) : null}

      {tab === 'history' ? (
        <section className="panel section-gap">
          <header className="panel-header">
            <div>
              <h2 className="section-title">{t('warehouseQueryHistory')}</h2>
              <p className="text-muted">{t('warehouseQueryHistoryLead')}</p>
            </div>
          </header>
          {history.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('status')}</th>
                    <th>{t('queryResults')}</th>
                    <th>{t('created')}</th>
                    <th>{t('warehouseSql')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <span className={`badge ${entry.status === 'success' ? 'experiment-diagnostic-success' : 'experiment-diagnostic-warning'}`}>
                          {entry.status}
                        </span>
                      </td>
                      <td>{entry.rowCount.toLocaleString()}</td>
                      <td className="text-muted">{formatTime(entry.createdAt)}</td>
                      <td>
                        <code className="mono">{entry.sql.slice(0, 120)}{entry.sql.length > 120 ? '…' : ''}</code>
                        {entry.error ? <div className="text-danger">{entry.error}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t('warehouseNoHistory')} description={t('warehouseQueryHistoryLead')} />
          )}
        </section>
      ) : null}

      {tab === 'schedules' ? (
        <section className="panel section-gap">
          <header className="panel-header">
            <div>
              <h2 className="section-title">{t('warehouseScheduledQueries')}</h2>
              <p className="text-muted">{t('warehouseScheduledQueriesLead')}</p>
              <p className="text-muted">{t('warehouseAutomationCronHint')}</p>
            </div>
            {canEdit ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={runSchedulesMutation.isPending}
                onClick={() => runSchedulesMutation.mutate()}
              >
                {t('warehouseRunSchedules')}
              </Button>
            ) : null}
          </header>
          {canEdit ? (
            <div className="panel-form">
              <div className="field">
                <Label htmlFor="warehouse-schedule-name">{t('name')}</Label>
                <Input
                  id="warehouse-schedule-name"
                  value={scheduleDraft.name}
                  onChange={(event) => setScheduleDraft((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <div className="field">
                <Label htmlFor="warehouse-schedule-interval">{t('warehouseScheduleInterval')}</Label>
                <Input
                  id="warehouse-schedule-interval"
                  type="number"
                  min={5}
                  value={scheduleDraft.intervalMinutes}
                  onChange={(event) =>
                    setScheduleDraft((prev) => ({ ...prev, intervalMinutes: Number(event.target.value) }))
                  }
                />
              </div>
              <div className="form-actions">
                <Button
                  type="button"
                  variant="primary"
                  disabled={!scheduleDraft.name.trim() || !sql.trim() || createScheduleMutation.isPending}
                  onClick={() => createScheduleMutation.mutate()}
                >
                  {createScheduleMutation.isPending ? t('saving') : t('create')}
                </Button>
              </div>
            </div>
          ) : null}
          {schedules.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('name')}</th>
                    <th>{t('warehouseScheduleInterval')}</th>
                    <th>{t('warehouseScheduleNextRun')}</th>
                    <th>{t('warehouseScheduleLastRun')}</th>
                    <th>{t('warehouseScheduleLastStatus')}</th>
                    <th>{t('status')}</th>
                    {canEdit ? <th className="cohorts-actions-col">{t('actions')}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.intervalMinutes}</td>
                      <td className="text-muted">{formatTime(item.nextRunAt)}</td>
                      <td className="text-muted">{formatTime(item.lastRunAt)}</td>
                      <td>{item.lastStatus ?? '-'}</td>
                      <td>{item.enabled ? t('enabled') : t('disabled')}</td>
                      {canEdit ? (
                        <td className="cohorts-actions-col">
                          <div className="cohorts-row-actions">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                updateScheduleMutation.mutate({
                                  id: item.id,
                                  patch: { enabled: !item.enabled },
                                })
                              }
                            >
                              {item.enabled ? t('disable') : t('enable')}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="btn-danger-text"
                              onClick={() => deleteScheduleMutation.mutate(item.id)}
                            >
                              {t('delete')}
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t('warehouseNoSchedules')} description={t('warehouseScheduledQueriesLead')} />
          )}
        </section>
      ) : null}

      {tab === 'sources' ? (
        <section className="panel section-gap">
          <header className="panel-header">
            <div>
              <h2 className="section-title">{t('warehouseDataSources')}</h2>
              <p className="text-muted">{t('warehouseDataSourcesLead')}</p>
              <p className="text-muted">{t('warehouseAutomationCronHint')}</p>
            </div>
          </header>
          {canEdit ? (
            <div className="panel-form">
              <div className="field">
                <Label htmlFor="warehouse-source-name">{t('name')}</Label>
                <Input
                  id="warehouse-source-name"
                  value={sourceDraft.name}
                  onChange={(event) => setSourceDraft((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <div className="field">
                <Label htmlFor="warehouse-source-type">{t('warehouseDataSourceType')}</Label>
                <select
                  id="warehouse-source-type"
                  className="select"
                  value={sourceDraft.type}
                  onChange={(event) =>
                    setSourceDraft((prev) => ({
                      ...prev,
                      type: event.target.value as WarehouseDataSource['type'],
                    }))
                  }
                >
                  <option value="http_json">http_json</option>
                  <option value="http_csv">http_csv</option>
                  <option value="r2_json">r2_json</option>
                  <option value="d1">d1</option>
                  <option value="postgres">postgres</option>
                  <option value="mysql">mysql</option>
                </select>
              </div>
              <div className="field feature-flag-description-field">
                <Label htmlFor="warehouse-source-config">{t('warehouseDataSourceConfig')}</Label>
                <textarea
                  id="warehouse-source-config"
                  className="textarea"
                  value={sourceDraft.configText}
                  onChange={(event) => setSourceDraft((prev) => ({ ...prev, configText: event.target.value }))}
                />
              </div>
              <div className="form-actions">
                <Button
                  type="button"
                  variant="primary"
                  disabled={!sourceDraft.name.trim() || createSourceMutation.isPending}
                  onClick={() => createSourceMutation.mutate()}
                >
                  {createSourceMutation.isPending ? t('saving') : t('create')}
                </Button>
              </div>
            </div>
          ) : null}
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
                    {canEdit ? <th className="cohorts-actions-col">{t('actions')}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {dataSources.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td className="mono">{item.type}</td>
                      <td>{item.enabled ? t('enabled') : t('disabled')}{item.lastStatus ? ` · ${item.lastStatus}` : ''}</td>
                      <td className="text-muted">
                        {formatTime(item.lastSyncAt)}
                        {item.lastError ? <div className="text-danger">{item.lastError}</div> : null}
                      </td>
                      <td className="text-muted">{formatTime(item.createdAt)}</td>
                      {canEdit ? (
                        <td className="cohorts-actions-col">
                          <div className="cohorts-row-actions">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={syncSourceMutation.isPending}
                              onClick={() => syncSourceMutation.mutate(item.id)}
                            >
                              {t('warehouseSyncNow')}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="btn-danger-text"
                              onClick={() => deleteSourceMutation.mutate(item.id)}
                            >
                              {t('delete')}
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t('warehouseNoDataSources')} description={t('warehouseDataSourcesLead')} />
          )}
        </section>
      ) : null}

      {tab === 'query' ? (
        <section className="panel section-gap">
          <header className="panel-header">
            <div>
              <h2 className="section-title">{t('queryResults')}</h2>
              <p className="text-muted">
                {result ? t('warehouseRowsReturned').replace('{count}', String(result.rowCount)) : t('warehouseResultsLead')}
              </p>
              {result?.analysis.autoLimit ? (
                <p className="text-muted">
                  {t('warehouseAutoLimit')}: {t('warehouseLimitApplied').replace('{count}', String(result.analysis.autoLimit))}
                </p>
              ) : null}
            </div>
          </header>

          {result?.rows.length ? (
            <div className="table-scroll">
              <table className="data-table warehouse-table">
                <thead>
                  <tr>
                    {result.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr key={index}>
                      {result.columns.map((column) => (
                        <td key={column}>{displayValue(row[column])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t('warehouseEmptyTitle')} description={t('warehouseEmptyBody')} />
          )}
        </section>
      ) : null}
    </div>
  );
}
