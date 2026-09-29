import { useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { Pause, Play, Plus, Search, X } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { DataViewState } from '../components/DataViewState';
import { MasterDetailTableLayout } from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SegmentTabs } from '../components/SegmentTabs';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { StatCard } from '../components/ui/stat-card';
import { LogHistogram } from '../components/logs/LogHistogram';
import { LogDetail } from '../components/logs/LogDetail';
import { LevelBadge, LogTable } from '../components/logs/LogTable';
import { formatSpanDuration, TraceWaterfall } from '../components/logs/TraceWaterfall';
import { TAIL_MAX_LINES, useLogTail } from '../components/logs/useLogTail';
import {
  appendLogFilterParams,
  attributeLabel,
  EMPTY_LOG_FILTERS,
  filtersFromSaved,
  filtersToSaved,
  hasLogFilters,
  parseAttributeInput,
  type LogFilterState,
} from '../components/logs/log-filters';
import {
  api,
  INGEST_URL_FOR_DOCS,
  type LogAlertRule,
  type LogAttributeFilter,
  type LogEvent,
  type LogEventsResponse,
  type LogHistogramResponse,
  type LogSavedFilter,
  type LogSeverity,
  type LogTraceDetail,
  type LogTraceSummary,
} from '../lib/api';
import { LOG_SEVERITIES } from '../lib/chart-colors';
import { formatDateTime, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';

const LOG_TABS = ['explore', 'tail', 'traces', 'filters', 'alerts'] as const;
type LogsTab = (typeof LOG_TABS)[number];
const PAGE_SIZE = 100;

const DEFAULT_ALERT = {
  name: '',
  threshold: 10,
  windowMinutes: 15,
  level: '',
  service: '',
  search: '',
  release: '',
  environment: '',
  attribute: '',
  channel: 'record' as LogAlertRule['channel'],
  target: '',
};

function initialFilters(params: URLSearchParams): LogFilterState {
  return {
    ...EMPTY_LOG_FILTERS,
    sessionId: params.get('sessionId') ?? '',
    traceId: params.get('traceId') ?? '',
    service: params.get('service') ?? '',
  };
}

export default function WebsiteLogsPage() {
  const confirm = useConfirm();
  const { websiteId } = useParams<{ websiteId: string }>();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId, 'logs');
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const [tab, setTab] = useState<LogsTab>('explore');
  const [filters, setFilters] = useState<LogFilterState>(() => initialFilters(searchParams));
  const [attributeInput, setAttributeInput] = useState('');
  const [selectedLog, setSelectedLog] = useState<LogEvent | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [tailPaused, setTailPaused] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [alertDraft, setAlertDraft] = useState(DEFAULT_ALERT);

  const debouncedSearch = useDebouncedValue(filters.search.trim(), 300);
  const filterQs = useMemo(
    () => appendLogFilterParams(new URLSearchParams(), filters, debouncedSearch).toString(),
    [filters, debouncedSearch],
  );
  const qs = useMemo(() => {
    const params = new URLSearchParams(rangeQs);
    for (const [key, value] of new URLSearchParams(filterQs)) params.append(key, value);
    return params.toString();
  }, [filterQs, rangeQs]);

  function update(patch: Partial<LogFilterState>) {
    setFilters((previous) => ({ ...previous, ...patch }));
  }

  function toggleLevel(level: LogSeverity) {
    setFilters((previous) => ({
      ...previous,
      levels: previous.levels.includes(level) ? previous.levels.filter((item) => item !== level) : [...previous.levels, level],
    }));
  }

  function addAttribute(attribute: LogAttributeFilter) {
    setFilters((previous) => ({
      ...previous,
      attributes: [
        ...previous.attributes.filter((item) => !(item.key === attribute.key && item.value === attribute.value)),
        attribute,
      ].slice(-10),
    }));
  }

  function openTrace(traceId: string) {
    setSelectedTraceId(traceId);
    setSelectedLog(null);
  }

  const logsQuery = useInfiniteQuery({
    queryKey: ['logs', websiteId, range, qs],
    enabled: Boolean(websiteId) && tab === 'explore',
    initialPageParam: null as string | null,
    // Keeping the previous result while a filter loads stops each keystroke from unmounting them.
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(qs);
      params.set('limit', String(PAGE_SIZE));
      if (pageParam) params.set('before', pageParam);
      return api<LogEventsResponse>(`/api/websites/${websiteId}/logs?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextBefore,
  });

  const histogramQuery = useQuery({
    queryKey: ['log-histogram', websiteId, range, qs],
    enabled: Boolean(websiteId) && tab === 'explore',
    placeholderData: keepPreviousData,
    queryFn: () => api<LogHistogramResponse>(`/api/websites/${websiteId}/logs/histogram?${qs}`),
  });

  const tracesQuery = useQuery({
    queryKey: ['log-traces', websiteId, range, qs, errorsOnly],
    enabled: Boolean(websiteId) && tab === 'traces',
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<{ traces: LogTraceSummary[] }>(`/api/websites/${websiteId}/logs/traces?${qs}${errorsOnly ? '&status=error' : ''}`),
  });

  const traceDetailQuery = useQuery({
    queryKey: ['log-trace-detail', websiteId, selectedTraceId],
    enabled: Boolean(websiteId && selectedTraceId),
    queryFn: () => api<LogTraceDetail>(`/api/websites/${websiteId}/logs/traces/${encodeURIComponent(selectedTraceId!)}`),
  });

  const tail = useLogTail(websiteId, filterQs, tab === 'tail', tailPaused);

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
        body: JSON.stringify({ name: filterName.trim(), filters: filtersToSaved(filters) }),
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
    mutationFn: () => {
      const attribute = parseAttributeInput(alertDraft.attribute);
      return api<LogAlertRule>(`/api/websites/${websiteId}/logs/alerts`, {
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
          attributeKey: attribute?.key ?? null,
          attributeValue: attribute?.value ?? null,
          channel: alertDraft.channel,
          target: alertDraft.target.trim() || null,
          enabled: true,
        }),
      });
    },
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

  const firstPage = logsQuery.data?.pages[0];
  const stats = firstPage?.stats;
  const rows = useMemo(() => logsQuery.data?.pages.flatMap((page) => page.logs) ?? [], [logsQuery.data]);
  const traces = tracesQuery.data?.traces ?? [];
  const savedFilters = savedFiltersQuery.data?.filters ?? [];
  const alertRules = alertRulesQuery.data?.alertRules ?? [];
  const selectedTrace = traceDetailQuery.data;
  const filtered = hasLogFilters(filters);

  const withCurrent = (values: string[], current: string) => (current && !values.includes(current) ? [...values, current] : values);
  const serviceOptions = withCurrent(stats?.services.map((row) => row.service) ?? [], filters.service);
  const environmentOptions = withCurrent(stats?.environments.map((row) => row.environment) ?? [], filters.environment);
  const releaseOptions = withCurrent(stats?.releases.map((row) => row.release) ?? [], filters.release);

  function submitAttribute() {
    const attribute = parseAttributeInput(attributeInput);
    if (!attribute) return;
    addAttribute(attribute);
    setAttributeInput('');
  }

  const sidePane =
    selectedTraceId && websiteId ? (
      selectedTrace ? (
        <TraceWaterfall
          trace={selectedTrace}
          websiteId={websiteId}
          timezone={timezone}
          onClose={() => setSelectedTraceId(null)}
          onSelectLog={(log) => {
            setSelectedLog(log);
            setSelectedTraceId(null);
          }}
          onFilterAttribute={addAttribute}
        />
      ) : traceDetailQuery.isError ? (
        <EmptyState title={t('noTraces')} description={t('logsTraceMissing')} />
      ) : (
        <div className="skeleton" style={{ height: '16rem' }} />
      )
    ) : selectedLog && websiteId ? (
      <LogDetail
        log={selectedLog}
        websiteId={websiteId}
        timezone={timezone}
        onClose={() => setSelectedLog(null)}
        onOpenTrace={openTrace}
        onFilterAttribute={addAttribute}
      />
    ) : null;

  const activeChips: Array<{ key: string; label: string; clear: () => void }> = [
    ...filters.levels.map((level) => ({ key: `level:${level}`, label: `${t('logsLevel')}: ${level}`, clear: () => toggleLevel(level) })),
    ...(filters.traceId ? [{ key: 'trace', label: `${t('logsTraceId')}: ${filters.traceId.slice(0, 16)}`, clear: () => update({ traceId: '' }) }] : []),
    ...(filters.sessionId ? [{ key: 'session', label: `${t('session')}: ${filters.sessionId.slice(0, 16)}`, clear: () => update({ sessionId: '' }) }] : []),
    ...filters.attributes.map((attribute) => ({
      key: `attr:${attribute.key}=${attribute.value ?? ''}`,
      label: attributeLabel(attribute),
      clear: () => update({ attributes: filters.attributes.filter((item) => item !== attribute) }),
    })),
  ];

  const filterBar = (
    <div className="logs-toolbar">
      <div className="logs-filter-row">
        <div className="cohorts-search-wrap logs-search-wrap">
          <Search className="cohorts-search-icon" size={16} strokeWidth={2} aria-hidden />
          <input
            type="search"
            className="input cohorts-search"
            placeholder={tab === 'traces' ? t('logsSearchSpans') : t('logsSearchPlaceholder')}
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
            aria-label={tab === 'traces' ? t('logsSearchSpans') : t('logsSearchPlaceholder')}
          />
        </div>
        <select className="select logs-level-select" value={filters.service} onChange={(event) => update({ service: event.target.value })} aria-label={t('logAlertService')}>
          <option value="">{t('logsAllServices')}</option>
          {serviceOptions.map((service) => (
            <option key={service} value={service}>
              {service}
            </option>
          ))}
        </select>
        <select className="select logs-level-select" value={filters.environment} onChange={(event) => update({ environment: event.target.value })} aria-label={t('logsFilterEnvironment')}>
          <option value="">{t('allEnvironments')}</option>
          {environmentOptions.map((environment) => (
            <option key={environment} value={environment}>
              {environment}
            </option>
          ))}
        </select>
        {releaseOptions.length ? (
          <select className="select logs-level-select" value={filters.release} onChange={(event) => update({ release: event.target.value })} aria-label={t('logsFilterRelease')}>
            <option value="">{t('allReleases')}</option>
            {releaseOptions.map((release) => (
              <option key={release} value={release}>
                {release}
              </option>
            ))}
          </select>
        ) : null}
        <select className="select logs-level-select" value={filters.source} onChange={(event) => update({ source: event.target.value as LogFilterState['source'] })} aria-label={t('logsSource')}>
          <option value="">{t('logsAllSources')}</option>
          <option value="otlp">{t('logsSourceOtlp')}</option>
          <option value="browser">{t('logsSourceBrowser')}</option>
        </select>
        {tab !== 'traces' ? (
          <form
            className="logs-attr-form"
            onSubmit={(event) => {
              event.preventDefault();
              submitAttribute();
            }}
          >
            <Input
              className="logs-attr-input mono"
              value={attributeInput}
              placeholder={t('logsAttributePlaceholder')}
              aria-label={t('logsAttributeFilter')}
              onChange={(event) => setAttributeInput(event.target.value)}
            />
            <Button type="submit" variant="secondary" size="sm" disabled={!attributeInput.trim()} aria-label={t('logsAddAttributeFilter')}>
              <Plus size={14} strokeWidth={2} aria-hidden />
            </Button>
          </form>
        ) : null}
        {filtered ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(EMPTY_LOG_FILTERS)}>
            {t('reset')}
          </Button>
        ) : null}
      </div>
      {activeChips.length ? (
        <ul className="logs-chips" aria-label={t('logsActiveFilters')}>
          {activeChips.map((chip) => (
            <li key={chip.key} className="logs-chip">
              <span className="mono">{chip.label}</span>
              <button type="button" className="logs-chip-remove" onClick={chip.clear} aria-label={`${t('remove')}: ${chip.label}`}>
                <X size={12} strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  return (
    <Page className="page-logs">
      <PageHeader
        title={t('logs')}
        lead={t('logsLead')}
        actions={<WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />}
      />

      <PageBody>
        {viewOnly ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

        <SegmentTabs
          aria-label={t('logs')}
          size="sm"
          className="section-gap"
          value={tab}
          onChange={(id) => setTab(id as LogsTab)}
          tabs={[
            { id: 'explore', label: t('logsTabExplore') },
            { id: 'tail', label: t('logsTabTail') },
            { id: 'traces', label: t('logsTabTraces') },
            { id: 'filters', label: t('logsTabFilters') },
            { id: 'alerts', label: t('logsTabAlerts') },
          ]}
        />

        {tab === 'explore' || tab === 'tail' || tab === 'traces' ? <section className="panel section-gap">{filterBar}</section> : null}

        {tab === 'explore' ? (
          <DataViewState
            loading={logsQuery.isLoading && !logsQuery.data}
            error={logsQuery.isError ? logsQuery.error : null}
            onRetry={() => logsQuery.refetch()}
            loadingFallback={
              <section className="panel section-gap">
                <div className="skeleton" style={{ height: '14rem' }} />
              </section>
            }
          >
            <section className="analytics-hero-stats section-gap" aria-label={t('logsTotal')}>
              <StatCard label={t('logsTotal')} value={formatNumber(stats?.logs ?? 0)} />
              <StatCard label={t('logsAffectedSessions')} value={formatNumber(stats?.sessions ?? 0)} />
              <StatCard
                label={t('logsLastSeen')}
                value={formatDateTime(stats?.lastSeenAt, { timeZone: timezone })}
                hint={stats?.levels[0] ? `${t('logsTopLevel')}: ${stats.levels[0].level}` : undefined}
              />
            </section>

            <section className="panel section-gap">
              <header className="compact-panel-header">
                <h2 className="section-title">{t('logsHistogram')}</h2>
                <p className="text-muted">{t('logsHistogramLead')}</p>
              </header>
              <LogHistogram histogram={histogramQuery.data} selected={filters.levels} onToggle={toggleLevel} timezone={timezone} />
            </section>

            <section className="panel section-gap page-logs-hero">
              {rows.length ? (
                <MasterDetailTableLayout
                  primary={
                    <>
                      <LogTable
                        rows={rows}
                        selectedId={selectedLog?.id ?? null}
                        timezone={timezone}
                        onSelect={(row) => {
                          setSelectedLog(row);
                          setSelectedTraceId(null);
                        }}
                      />
                      {logsQuery.hasNextPage ? (
                        <div className="logs-load-more">
                          <Button type="button" variant="secondary" size="sm" disabled={logsQuery.isFetchingNextPage} onClick={() => logsQuery.fetchNextPage()}>
                            {logsQuery.isFetchingNextPage ? t('loading') : t('logsLoadMore')}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  }
                  side={sidePane}
                />
              ) : (
                <>
                  <EmptyState title={t('logsEmptyTitle')} description={filtered ? t('logsEmptyFiltered') : t('logsEmptyBody')} />
                  {!filtered && firstPage?.otlpEnabled ? <OtlpSetupHint /> : null}
                </>
              )}
            </section>
          </DataViewState>
        ) : null}

        {tab === 'tail' ? (
          <section className="panel section-gap">
            <header className="panel-header">
              <div>
                <h2 className="section-title">{t('logsTabTail')}</h2>
                <p className="text-muted">
                  {tailPaused ? t('logsTailPaused') : t('logsTailLive')} · {formatNumber(tail.lines.length)} / {formatNumber(TAIL_MAX_LINES)}
                </p>
              </div>
              <div className="logs-filter-row">
                <div className="logs-severity-toggles" role="group" aria-label={t('logsLevel')}>
                  {LOG_SEVERITIES.map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={`logs-legend-item${filters.levels.includes(level) ? ' is-active' : ''}`}
                      aria-pressed={filters.levels.includes(level)}
                      onClick={() => toggleLevel(level)}
                    >
                      {level}
                    </button>
                  ))}
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setTailPaused((paused) => !paused)}>
                  {tailPaused ? <Play size={14} strokeWidth={2} aria-hidden /> : <Pause size={14} strokeWidth={2} aria-hidden />}
                  {tailPaused ? t('logsTailResume') : t('logsTailPause')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={tail.clear}>
                  {t('logsTailClear')}
                </Button>
              </div>
            </header>
            {tail.error ? <p className="text-muted">{t('logsTailError')}</p> : null}
            {tail.lines.length ? (
              <MasterDetailTableLayout
                primary={
                  <LogTable
                    compact
                    rows={tail.lines}
                    selectedId={selectedLog?.id ?? null}
                    timezone={timezone}
                    onSelect={(row) => {
                      setSelectedLog(row);
                      setSelectedTraceId(null);
                    }}
                  />
                }
                side={sidePane}
              />
            ) : (
              <EmptyState title={t('logsTailWaiting')} description={t('logsTailWaitingBody')} />
            )}
          </section>
        ) : null}

        {tab === 'traces' ? (
          <section className="panel section-gap">
            <header className="panel-header">
              <div>
                <h2 className="section-title">{t('logsTraces')}</h2>
                <p className="text-muted">{t('logsTracesLead')}</p>
              </div>
              <label className="logs-errors-only">
                <input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} />
                {t('logsErrorsOnly')}
              </label>
            </header>
            {traces.length ? (
              <MasterDetailTableLayout
                primary={
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('logsTraceRoot')}</th>
                          <th>{t('logsTraceSpans')}</th>
                          <th>{t('logsTraceDuration')}</th>
                          <th>{t('status')}</th>
                          <th>{t('logsTime')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {traces.map((trace) => (
                          <tr key={trace.traceId} className={trace.traceId === selectedTraceId ? 'active-row' : undefined}>
                            <td>
                              <button type="button" className="error-issue-button" onClick={() => openTrace(trace.traceId)}>
                                <span>{trace.rootName ?? trace.traceId.slice(0, 16)}</span>
                                <span className="text-muted mono"> {trace.rootService ?? ''}</span>
                              </button>
                            </td>
                            <td>
                              {trace.spans} · {trace.services} {t('logsTraceServices').toLowerCase()}
                            </td>
                            <td className="mono text-muted">{formatSpanDuration(trace.durationMs * 1000)}</td>
                            <td>
                              <LevelBadge level={trace.hasError ? 'error' : 'info'} />
                            </td>
                            <td className="text-muted">{formatDateTime(trace.startedAt, { timeZone: timezone })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
                side={sidePane}
              />
            ) : tracesQuery.isLoading ? (
              <div className="skeleton" style={{ height: '8rem' }} />
            ) : (
              <EmptyState title={t('noTraces')} description={t('logsTracesEmpty')} />
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
                  <Input id="log-filter-name" value={filterName} onChange={(event) => setFilterName(event.target.value)} />
                </div>
                <Button
                  type="button"
                  variant="primary"
                  disabled={!filterName.trim() || !filtered || createFilterMutation.isPending}
                  onClick={() => createFilterMutation.mutate()}
                >
                  {createFilterMutation.isPending ? t('saving') : t('saveFilter')}
                </Button>
              </div>
            ) : null}
            {canEdit && !filtered ? <p className="text-muted">{t('logsSaveFilterHint')}</p> : null}
            {savedFilters.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('name')}</th>
                      <th>{t('logsFilters')}</th>
                      <th className="cohorts-actions-col">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedFilters.map((filter) => (
                      <tr key={filter.id}>
                        <td>{filter.name}</td>
                        <td className="mono text-muted">{describeSavedFilter(filter.filters)}</td>
                        <td className="cohorts-actions-col">
                          <div className="cohorts-row-actions">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setFilters(filtersFromSaved(filter.filters));
                                setTab('explore');
                              }}
                            >
                              {t('applyFilter')}
                            </Button>
                            {canEdit ? (
                              <Button
                                type="button"
                                variant="destructive-ghost"
                                size="sm"
                                onClick={() => confirm({ title: deleteTitle(filter.name), onConfirm: () => deleteFilterMutation.mutate(filter.id) })}
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
                  <Input id="log-alert-name" value={alertDraft.name} onChange={(event) => setAlertDraft((prev) => ({ ...prev, name: event.target.value }))} />
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
                    onChange={(event) => setAlertDraft((prev) => ({ ...prev, windowMinutes: Number(event.target.value) }))}
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
                    {LOG_SEVERITIES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <Label htmlFor="log-alert-service">{t('logAlertService')}</Label>
                  <Input id="log-alert-service" value={alertDraft.service} onChange={(event) => setAlertDraft((prev) => ({ ...prev, service: event.target.value }))} />
                </div>
                <div className="field">
                  <Label htmlFor="log-alert-search">{t('search')}</Label>
                  <Input id="log-alert-search" value={alertDraft.search} onChange={(event) => setAlertDraft((prev) => ({ ...prev, search: event.target.value }))} />
                </div>
                <div className="field">
                  <Label htmlFor="log-alert-attribute">{t('logsAttributeFilter')}</Label>
                  <Input
                    id="log-alert-attribute"
                    className="mono"
                    placeholder={t('logsAttributePlaceholder')}
                    value={alertDraft.attribute}
                    onChange={(event) => setAlertDraft((prev) => ({ ...prev, attribute: event.target.value }))}
                  />
                </div>
                <div className="field">
                  <Label htmlFor="log-alert-release">{t('release')}</Label>
                  <Input id="log-alert-release" value={alertDraft.release} onChange={(event) => setAlertDraft((prev) => ({ ...prev, release: event.target.value }))} />
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
                    onChange={(event) => setAlertDraft((prev) => ({ ...prev, channel: event.target.value as LogAlertRule['channel'] }))}
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
                      placeholder={alertDraft.channel === 'email' ? 'ops@example.com' : 'https://hooks.example.com/alerts'}
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
                      <th>{t('logsFilters')}</th>
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
                        <td className="mono text-muted">
                          {describeSavedFilter({
                            level: rule.level ?? undefined,
                            service: rule.service ?? undefined,
                            search: rule.search ?? undefined,
                            release: rule.release ?? undefined,
                            environment: rule.environment ?? undefined,
                            attributes: rule.attributeKey
                              ? [{ key: rule.attributeKey, value: rule.attributeValue ?? undefined }]
                              : undefined,
                          })}
                        </td>
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
                                variant="destructive-ghost"
                                size="sm"
                                onClick={() => confirm({ title: deleteTitle(rule.name), onConfirm: () => deleteAlertMutation.mutate(rule.id) })}
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
      </PageBody>
    </Page>
  );
}

function describeSavedFilter(filters: LogSavedFilter['filters']) {
  const parts = [
    filters.level,
    filters.service && `service=${filters.service}`,
    filters.environment && `env=${filters.environment}`,
    filters.release && `release=${filters.release}`,
    filters.source,
    filters.search && `"${filters.search}"`,
    filters.traceId && `trace=${filters.traceId.slice(0, 12)}`,
    filters.sessionId && `session=${filters.sessionId.slice(0, 12)}`,
    ...(filters.attributes ?? []).map(attributeLabel),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '-';
}

/** Shown on an empty explorer: where to point an OpenTelemetry exporter. */
function OtlpSetupHint() {
  const endpoint = INGEST_URL_FOR_DOCS.replace(/\/$/, '');
  return (
    <div className="logs-otlp-hint">
      <h3 className="section-title">{t('logsOtlpHintTitle')}</h3>
      <p className="text-muted">{t('logsOtlpHintBody')}</p>
      <pre className="mono">{`OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20fb_pk_…`}</pre>
    </div>
  );
}
