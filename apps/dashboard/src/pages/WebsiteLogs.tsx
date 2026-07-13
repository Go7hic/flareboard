import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, Search, TerminalSquare } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { MasterDetailSidePane, MasterDetailTableLayout } from '../components/master-detail';
import { SegmentTabs } from '../components/SegmentTabs';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  api,
  type LogAlertRule,
  type LogEventsResponse,
  type LogSavedFilter,
  type LogTraceDetail,
  type LogTraceSummary,
} from '../lib/api';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

const LEVELS = ['', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const LOG_TABS = ['events', 'traces', 'filters', 'alerts'] as const;
type LogsTab = (typeof LOG_TABS)[number];

function formatDate(value: number | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTrendDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString();
}

const DEFAULT_ALERT = {
  name: '',
  threshold: 10,
  windowMinutes: 15,
  level: '',
  service: '',
  search: '',
  release: '',
  environment: '',
  channel: 'record' as LogAlertRule['channel'],
  target: '',
};

export default function WebsiteLogsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const queryClient = useQueryClient();
  const { canEdit } = useWebsitePermissions(websiteId, 'logs');
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const [tab, setTab] = useState<LogsTab>('events');
  const [level, setLevel] = useState('');
  const [search, setSearch] = useState('');
  const [releaseFilter, setReleaseFilter] = useState('');
  const [environmentFilter, setEnvironmentFilter] = useState('');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [filterName, setFilterName] = useState('');
  const [alertDraft, setAlertDraft] = useState(DEFAULT_ALERT);

  const trimmedSearch = search.trim();
  const debouncedSearch = useDebouncedValue(trimmedSearch, 300);
  const qs = useMemo(() => {
    const params = new URLSearchParams(rangeQs);
    if (level) params.set('level', level);
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (releaseFilter) params.set('release', releaseFilter);
    if (environmentFilter) params.set('environment', environmentFilter);
    return params.toString();
  }, [debouncedSearch, environmentFilter, level, rangeQs, releaseFilter]);

  const logsQuery = useQuery({
    queryKey: ['logs', websiteId, range, level, debouncedSearch, releaseFilter, environmentFilter],
    enabled: Boolean(websiteId) && tab === 'events',
    queryFn: () => api<LogEventsResponse>(`/api/websites/${websiteId}/logs?${qs}`),
  });

  const tracesQuery = useQuery({
    queryKey: ['log-traces', websiteId, range, level, debouncedSearch, releaseFilter, environmentFilter],
    enabled: Boolean(websiteId) && tab === 'traces',
    queryFn: () => api<{ traces: LogTraceSummary[] }>(`/api/websites/${websiteId}/logs/traces?${qs}`),
  });

  const traceDetailQuery = useQuery({
    queryKey: ['log-trace-detail', websiteId, selectedTraceId],
    enabled: Boolean(websiteId && selectedTraceId),
    queryFn: () => api<LogTraceDetail>(`/api/websites/${websiteId}/logs/traces/${selectedTraceId}`),
  });

  const savedFiltersQuery = useQuery({
    queryKey: ['log-filters', websiteId],
    enabled: Boolean(websiteId) && tab === 'filters',
    queryFn: () => api<{ filters: LogSavedFilter[] }>(`/api/websites/${websiteId}/logs/filters`),
  });

  const alertRulesQuery = useQuery({
    queryKey: ['log-alerts', websiteId],
    enabled: Boolean(websiteId) && tab === 'alerts',
    queryFn: () => api<{ alertRules: LogAlertRule[] }>(`/api/websites/${websiteId}/logs/alerts`),
  });

  const createFilterMutation = useMutation({
    mutationFn: () =>
      api<LogSavedFilter>(`/api/websites/${websiteId}/logs/filters`, {
        method: 'POST',
        body: JSON.stringify({
          name: filterName.trim(),
          filters: {
            level: level || undefined,
            search: trimmedSearch || undefined,
            release: releaseFilter || undefined,
            environment: environmentFilter || undefined,
          },
        }),
      }),
    onSuccess: () => {
      setFilterName('');
      queryClient.invalidateQueries({ queryKey: ['log-filters', websiteId] });
    },
  });

  const deleteFilterMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/logs/filters/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['log-filters', websiteId] }),
  });

  const createAlertMutation = useMutation({
    mutationFn: () =>
      api<LogAlertRule>(`/api/websites/${websiteId}/logs/alerts`, {
        method: 'POST',
        body: JSON.stringify({
          name: alertDraft.name.trim(),
          threshold: Number(alertDraft.threshold),
          windowMinutes: Number(alertDraft.windowMinutes),
          level: alertDraft.level || null,
          service: alertDraft.service.trim() || null,
          search: alertDraft.search.trim() || null,
          release: alertDraft.release.trim() || null,
          environment: alertDraft.environment.trim() || null,
          channel: alertDraft.channel,
          target: alertDraft.target.trim() || null,
          enabled: true,
        }),
      }),
    onSuccess: () => {
      setAlertDraft(DEFAULT_ALERT);
      queryClient.invalidateQueries({ queryKey: ['log-alerts', websiteId] });
    },
  });

  const updateAlertMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<LogAlertRule> }) =>
      api<LogAlertRule>(`/api/websites/${websiteId}/logs/alerts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['log-alerts', websiteId] }),
  });

  const deleteAlertMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/logs/alerts/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['log-alerts', websiteId] }),
  });

  const rows = logsQuery.data?.logs ?? [];
  const stats = logsQuery.data?.stats;
  const topLevel = stats?.levels[0];
  const trendRows = stats?.trend ?? [];
  const levelRows = stats?.levels ?? [];
  const traces = tracesQuery.data?.traces ?? [];
  const savedFilters = savedFiltersQuery.data?.filters ?? [];
  const alertRules = alertRulesQuery.data?.alertRules ?? [];
  const selectedTrace = traceDetailQuery.data;

  const releaseOptions = useMemo(() => {
    const values = new Set(stats?.releases?.map((release) => release.release) ?? []);
    if (releaseFilter) values.add(releaseFilter);
    return [...values];
  }, [releaseFilter, stats?.releases]);
  const environmentOptions = useMemo(() => {
    const values = new Set(stats?.environments?.map((environment) => environment.environment) ?? []);
    if (environmentFilter) values.add(environmentFilter);
    return [...values];
  }, [environmentFilter, stats?.environments]);
  const hasFilters = Boolean(level || trimmedSearch || releaseFilter || environmentFilter);

  function applySavedFilter(filter: LogSavedFilter) {
    setLevel(filter.filters.level ?? '');
    setSearch(filter.filters.search ?? '');
    setReleaseFilter(filter.filters.release ?? '');
    setEnvironmentFilter(filter.filters.environment ?? '');
    setTab('events');
  }

  return (
    <div className="page page-logs">
      <WebsitePageShell websiteId={websiteId} />

      <div className="stats-header-row">
        <div>
          <h2 className="page-title">{t('logs')}</h2>
          <p className="text-muted">{t('logsLead')}</p>
        </div>
        <WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />
      </div>

      {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

      <div className="section-gap">
        <SegmentTabs
          aria-label={t('logs')}
          value={tab}
          onChange={(id) => setTab(id as LogsTab)}
          tabs={[
            { id: 'events', label: t('logsTabEvents') },
            { id: 'traces', label: t('logsTabTraces') },
            { id: 'filters', label: t('logsTabFilters') },
            { id: 'alerts', label: t('logsTabAlerts') },
          ]}
        />
      </div>

      {tab === 'events' ? (
        <>
          <section className="stat-grid section-gap" aria-label={t('logs')}>
            <div className="stat-card">
              <span className="stat-label">{t('logsTotal')}</span>
              <strong className="stat-value">{(stats?.logs ?? 0).toLocaleString()}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">{t('logsAffectedSessions')}</span>
              <strong className="stat-value">{(stats?.sessions ?? 0).toLocaleString()}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">{t('logsLastSeen')}</span>
              <strong className="stat-value">{formatDate(stats?.lastSeenAt)}</strong>
              {topLevel ? (
                <span className="stat-card-note">
                  {t('logsTopLevel')}: {topLevel.level}
                </span>
              ) : null}
            </div>
          </section>

          {(trendRows.length || levelRows.length) ? (
            <section className="panel section-gap">
              <div className="error-insights-grid">
                <div>
                  <header className="compact-panel-header">
                    <h2 className="section-title">{t('logsTrend')}</h2>
                    <p className="text-muted">{t('logsTrendLead')}</p>
                  </header>
                  <div className="table-scroll">
                    <table className="data-table logs-table">
                      <thead>
                        <tr>
                          <th>{t('date')}</th>
                          <th>{t('logs')}</th>
                          <th>{t('sessions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trendRows.map((row) => (
                          <tr key={row.date}>
                            <td>{formatTrendDate(row.date)}</td>
                            <td>{row.logs.toLocaleString()}</td>
                            <td>{row.sessions.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="detail-section error-severity-panel">
                  <header className="compact-panel-header">
                    <h2 className="section-title">{t('logsLevelBreakdown')}</h2>
                    <p className="text-muted">{t('logsLevelBreakdownLead')}</p>
                  </header>
                  <div className="breakdown-list">
                    {levelRows.map((row) => {
                      const share = stats?.logs ? Math.round((row.logs / stats.logs) * 100) : 0;
                      return (
                        <div key={row.level} className="breakdown-row">
                          <div className="breakdown-meta">
                            <strong>{row.level}</strong>
                            <span className="text-muted">
                              {row.logs.toLocaleString()} ({share}%)
                            </span>
                          </div>
                          <div className="breakdown-track" aria-hidden>
                            <span style={{ width: `${share}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <section className="panel section-gap">
            <header className="panel-header">
              <div>
                <h2 className="section-title">{t('logsRecent')}</h2>
                <p className="text-muted">{t('logsFilterHint')}</p>
              </div>
              <div className="logs-filter-row">
                <div className="cohorts-search-wrap logs-search-wrap">
                  <Search className="cohorts-search-icon" size={16} strokeWidth={2} aria-hidden />
                  <input
                    type="search"
                    className="input cohorts-search"
                    placeholder={t('logsSearchPlaceholder')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label={t('logsSearchPlaceholder')}
                  />
                </div>
                <select
                  className="select logs-level-select"
                  value={level}
                  onChange={(event) => setLevel(event.target.value)}
                  aria-label={t('logsLevel')}
                >
                  {LEVELS.map((item) => (
                    <option key={item || 'all'} value={item}>
                      {item ? item : t('allLevels')}
                    </option>
                  ))}
                </select>
                <select
                  className="select logs-level-select"
                  value={releaseFilter}
                  onChange={(event) => setReleaseFilter(event.target.value)}
                  aria-label={t('logsFilterRelease')}
                >
                  <option value="">{t('allReleases')}</option>
                  {releaseOptions.map((release) => (
                    <option key={release} value={release}>
                      {release}
                    </option>
                  ))}
                </select>
                <select
                  className="select logs-level-select"
                  value={environmentFilter}
                  onChange={(event) => setEnvironmentFilter(event.target.value)}
                  aria-label={t('logsFilterEnvironment')}
                >
                  <option value="">{t('allEnvironments')}</option>
                  {environmentOptions.map((environment) => (
                    <option key={environment} value={environment}>
                      {environment}
                    </option>
                  ))}
                </select>
                {hasFilters ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setLevel('');
                      setSearch('');
                      setReleaseFilter('');
                      setEnvironmentFilter('');
                    }}
                  >
                    {t('reset')}
                  </Button>
                ) : null}
              </div>
            </header>

            {logsQuery.isLoading ? <div className="skeleton" style={{ height: '8rem' }} /> : null}

            {!logsQuery.isLoading && rows.length ? (
              <div className="table-scroll">
                <table className="data-table logs-table">
                  <thead>
                    <tr>
                      <th>{t('message')}</th>
                      <th>{t('logsLevel')}</th>
                      <th>{t('page')}</th>
                      <th>{t('session')}</th>
                      <th>{t('created')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div className="errors-name-cell">
                            <TerminalSquare size={16} strokeWidth={2} aria-hidden />
                            <div>
                              <div className="errors-message">{row.message ?? row.eventName ?? '-'}</div>
                              {row.release || row.environment ? (
                                <div className="text-muted">
                                  {[row.release, row.environment].filter(Boolean).join(' · ')}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`badge log-level-${row.level ?? 'info'}`}>
                            {row.level ?? 'info'}
                          </span>
                        </td>
                        <td className="text-muted">{row.urlPath || '/'}</td>
                        <td>
                          <Link to={`/websites/${websiteId}/sessions/${row.sessionId}`} className="inline-link">
                            {row.sessionId.slice(0, 8)}
                            <ExternalLink size={12} strokeWidth={2} aria-hidden />
                          </Link>
                        </td>
                        <td className="text-muted">{formatDate(row.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {!logsQuery.isLoading && !rows.length ? (
              <EmptyState title={t('logsEmptyTitle')} description={t('logsEmptyBody')} />
            ) : null}
          </section>
        </>
      ) : null}

      {tab === 'traces' ? (
        <section className="panel section-gap">
          <header className="panel-header">
            <div>
              <h2 className="section-title">{t('logsTraces')}</h2>
              <p className="text-muted">{t('logsTracesLead')}</p>
            </div>
          </header>
          {traces.length ? (
            <MasterDetailTableLayout
              primary={
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('logsTraceId')}</th>
                        <th>{t('logsTraceSpans')}</th>
                        <th>{t('logsTraceServices')}</th>
                        <th>{t('logsTraceDuration')}</th>
                        <th>{t('status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traces.map((trace) => (
                        <tr
                          key={trace.traceId}
                          className={trace.traceId === selectedTraceId ? 'active-row' : undefined}
                        >
                          <td>
                            <button type="button" className="error-issue-button" onClick={() => setSelectedTraceId(trace.traceId)}>
                              <code className="mono">{trace.traceId.slice(0, 16)}</code>
                            </button>
                          </td>
                          <td>{trace.spans}</td>
                          <td>{trace.services}</td>
                          <td className="text-muted">{trace.durationMs != null ? `${trace.durationMs}ms` : '-'}</td>
                          <td>
                            <span className={`badge ${trace.hasError ? 'experiment-diagnostic-warning' : 'experiment-diagnostic-success'}`}>
                              {trace.hasError ? t('logsTraceStatusError') : t('logsTraceStatusOk')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
              side={
                selectedTrace ? (
                  <MasterDetailSidePane
                    title={t('logsTraceDetail')}
                    description={<span className="mono">{selectedTrace.traceId}</span>}
                  >
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>{t('logAlertService')}</th>
                            <th>{t('logsTraceSpan')}</th>
                            <th>{t('message')}</th>
                            <th>{t('logsTraceDuration')}</th>
                            <th>{t('status')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedTrace.spans.map((span) => (
                            <tr key={span.id}>
                              <td>{span.service}</td>
                              <td className="mono">{span.spanId}</td>
                              <td>{span.message ?? span.operation ?? '-'}</td>
                              <td className="text-muted">{span.durationMs != null ? `${span.durationMs}ms` : '-'}</td>
                              <td>{span.status ?? span.level ?? '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </MasterDetailSidePane>
                ) : null
              }
            />
          ) : (
            <EmptyState title={t('noTraces')} description={t('logsTracesLead')} />
          )}
        </section>
      ) : null}

      {tab === 'filters' ? (
        <section className="panel section-gap">
          <header className="panel-header">
            <div>
              <h2 className="section-title">{t('logsSavedFilters')}</h2>
              <p className="text-muted">{t('logsSavedFiltersLead')}</p>
            </div>
          </header>
          {canEdit ? (
            <div className="form-row">
              <div className="field">
                <Label htmlFor="log-filter-name">{t('name')}</Label>
                <Input
                  id="log-filter-name"
                  value={filterName}
                  onChange={(event) => setFilterName(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="primary"
                disabled={!filterName.trim() || createFilterMutation.isPending}
                onClick={() => createFilterMutation.mutate()}
              >
                {createFilterMutation.isPending ? t('saving') : t('saveFilter')}
              </Button>
            </div>
          ) : null}
          {savedFilters.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('name')}</th>
                    <th>{t('logsLevel')}</th>
                    <th>{t('release')}</th>
                    <th>{t('environment')}</th>
                    <th className="cohorts-actions-col">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {savedFilters.map((filter) => (
                    <tr key={filter.id}>
                      <td>{filter.name}</td>
                      <td>{filter.filters.level ?? '-'}</td>
                      <td>{filter.filters.release ?? '-'}</td>
                      <td>{filter.filters.environment ?? '-'}</td>
                      <td className="cohorts-actions-col">
                        <div className="cohorts-row-actions">
                          <Button type="button" variant="ghost" size="sm" onClick={() => applySavedFilter(filter)}>
                            {t('applyFilter')}
                          </Button>
                          {canEdit ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="btn-danger-text"
                              onClick={() => deleteFilterMutation.mutate(filter.id)}
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
            <EmptyState title={t('noSavedFilters')} description={t('logsSavedFiltersLead')} />
          )}
        </section>
      ) : null}

      {tab === 'alerts' ? (
        <section className="panel section-gap">
          <header className="panel-header">
            <div>
              <h2 className="section-title">{t('logsAlertRules')}</h2>
              <p className="text-muted">{t('logsAlertRulesLead')}</p>
            </div>
          </header>
          {canEdit ? (
            <div className="panel-form">
              <div className="field">
                <Label htmlFor="log-alert-name">{t('alertRuleName')}</Label>
                <Input
                  id="log-alert-name"
                  value={alertDraft.name}
                  onChange={(event) => setAlertDraft((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <div className="field">
                <Label htmlFor="log-alert-threshold">{t('alertRuleThreshold')}</Label>
                <Input
                  id="log-alert-threshold"
                  type="number"
                  min={1}
                  value={alertDraft.threshold}
                  onChange={(event) => setAlertDraft((prev) => ({ ...prev, threshold: Number(event.target.value) }))}
                />
              </div>
              <div className="field">
                <Label htmlFor="log-alert-window">{t('alertRuleWindow')}</Label>
                <Input
                  id="log-alert-window"
                  type="number"
                  min={1}
                  value={alertDraft.windowMinutes}
                  onChange={(event) =>
                    setAlertDraft((prev) => ({ ...prev, windowMinutes: Number(event.target.value) }))
                  }
                />
              </div>
              <div className="field">
                <Label htmlFor="log-alert-level">{t('logAlertLevel')}</Label>
                <select
                  id="log-alert-level"
                  className="select"
                  value={alertDraft.level}
                  onChange={(event) => setAlertDraft((prev) => ({ ...prev, level: event.target.value }))}
                >
                  <option value="">{t('allLevels')}</option>
                  {LEVELS.filter(Boolean).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <Label htmlFor="log-alert-service">{t('logAlertService')}</Label>
                <Input
                  id="log-alert-service"
                  value={alertDraft.service}
                  onChange={(event) => setAlertDraft((prev) => ({ ...prev, service: event.target.value }))}
                />
              </div>
              <div className="field">
                <Label htmlFor="log-alert-search">{t('search')}</Label>
                <Input
                  id="log-alert-search"
                  value={alertDraft.search}
                  onChange={(event) => setAlertDraft((prev) => ({ ...prev, search: event.target.value }))}
                />
              </div>
              <div className="field">
                <Label htmlFor="log-alert-release">{t('release')}</Label>
                <Input
                  id="log-alert-release"
                  value={alertDraft.release}
                  onChange={(event) => setAlertDraft((prev) => ({ ...prev, release: event.target.value }))}
                />
              </div>
              <div className="field">
                <Label htmlFor="log-alert-environment">{t('environment')}</Label>
                <Input
                  id="log-alert-environment"
                  value={alertDraft.environment}
                  onChange={(event) => setAlertDraft((prev) => ({ ...prev, environment: event.target.value }))}
                />
              </div>
              <div className="field">
                <Label htmlFor="log-alert-channel">{t('alertRuleChannel')}</Label>
                <select
                  id="log-alert-channel"
                  className="select"
                  value={alertDraft.channel}
                  onChange={(event) =>
                    setAlertDraft((prev) => ({
                      ...prev,
                      channel: event.target.value as LogAlertRule['channel'],
                    }))
                  }
                >
                  <option value="record">{t('alertRuleChannel_record')}</option>
                  <option value="email">{t('alertRuleChannel_email')}</option>
                  <option value="webhook">{t('alertRuleChannel_webhook')}</option>
                </select>
              </div>
              {alertDraft.channel !== 'record' ? (
                <div className="field">
                  <Label htmlFor="log-alert-target">{t('alertRuleTarget')}</Label>
                  <Input
                    id="log-alert-target"
                    value={alertDraft.target}
                    placeholder={
                      alertDraft.channel === 'email' ? 'ops@example.com' : 'https://hooks.example.com/alerts'
                    }
                    onChange={(event) => setAlertDraft((prev) => ({ ...prev, target: event.target.value }))}
                  />
                </div>
              ) : null}
              <div className="form-actions">
                <Button
                  type="button"
                  variant="primary"
                  disabled={!alertDraft.name.trim() || createAlertMutation.isPending}
                  onClick={() => createAlertMutation.mutate()}
                >
                  {createAlertMutation.isPending ? t('saving') : t('createAlertRule')}
                </Button>
              </div>
            </div>
          ) : null}
          {alertRules.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('alertRuleName')}</th>
                    <th>{t('alertRuleThreshold')}</th>
                    <th>{t('alertRuleWindow')}</th>
                    <th>{t('logAlertLevel')}</th>
                    <th>{t('alertRuleChannel')}</th>
                    <th>{t('status')}</th>
                    <th className="cohorts-actions-col">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {alertRules.map((rule) => (
                    <tr key={rule.id}>
                      <td>{rule.name}</td>
                      <td>{rule.threshold}</td>
                      <td>{rule.windowMinutes}</td>
                      <td>{rule.level ?? '-'}</td>
                      <td>
                        {t(`alertRuleChannel_${rule.channel}`)}
                        {rule.target ? <div className="text-muted mono">{rule.target}</div> : null}
                      </td>
                      <td>{rule.enabled ? t('enabled') : t('disabled')}</td>
                      <td className="cohorts-actions-col">
                        {canEdit ? (
                          <div className="cohorts-row-actions">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => updateAlertMutation.mutate({ id: rule.id, patch: { enabled: !rule.enabled } })}
                            >
                              {rule.enabled ? t('disable') : t('enable')}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="btn-danger-text"
                              onClick={() => deleteAlertMutation.mutate(rule.id)}
                            >
                              {t('delete')}
                            </Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t('noAlertRules')} description={t('logsAlertRulesLead')} />
          )}
        </section>
      ) : null}
    </div>
  );
}
