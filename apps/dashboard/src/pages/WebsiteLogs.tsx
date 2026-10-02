import { useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { BellRing, Bookmark, GitBranch, Pause, Play, Plus, Radio, ScrollText, Search, X } from 'lucide-react';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { Switch } from '../components/ui/switch';
import { LogDetail } from '../components/logs/LogDetail';
import { LogHistogram } from '../components/logs/LogHistogram';
import { LevelBadge, LogTable } from '../components/logs/LogTable';
import { formatSpanDuration, TraceWaterfall } from '../components/logs/TraceWaterfall';
import { waterfallRows } from '../components/logs/trace-tree';
import { TAIL_MAX_LINES, useLogTail } from '../components/logs/useLogTail';
import {
  appendLogFilterParams,
  attributeLabel,
  EMPTY_LOG_FILTERS,
  filtersFromSaved,
  hasLogFilters,
  parseAttributeInput,
  type LogFilterState,
} from '../components/logs/log-filters';
import { CodeBlock } from '../components/quality/CodeBlock';
import { FilterSelect } from '../components/quality/FilterSelect';
import { LogAlertRulesSheet } from '../components/quality/LogAlertRulesSheet';
import { LogSavedFiltersSheet } from '../components/quality/LogSavedFiltersSheet';
import { PageTabs } from '../components/quality/PageTabs';
import { RelativeTime } from '../components/quality/RelativeTime';
import { SideSheet } from '../components/quality/SideSheet';
import { TableSkeleton } from '../components/quality/TableSkeleton';
import { useMediaQuery } from '../components/quality/useMediaQuery';
import {
  api,
  INGEST_URL_FOR_DOCS,
  type LogAttributeFilter,
  type LogEvent,
  type LogEventsResponse,
  type LogHistogramResponse,
  type LogSeverity,
  type LogTraceDetail,
  type LogTraceSummary,
} from '../lib/api';
import { LOG_SEVERITIES, SEVERITY_CHART_VARS } from '../lib/chart-colors';
import { formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

const LOG_TABS = ['explore', 'tail', 'traces'] as const;
type LogsTab = (typeof LOG_TABS)[number];
const PAGE_SIZE = 100;
/** Wide enough for the table and a side pane; narrower screens open the detail in a sheet. */
const INLINE_DETAIL_QUERY = '(min-width: 1280px)';

function initialFilters(params: URLSearchParams): LogFilterState {
  return {
    ...EMPTY_LOG_FILTERS,
    sessionId: params.get('sessionId') ?? '',
    traceId: params.get('traceId') ?? '',
    service: params.get('service') ?? '',
  };
}

export default function WebsiteLogsPage() {
  const { websiteId = '' } = useParams<{ websiteId: string }>();
  const [searchParams] = useSearchParams();
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId, 'logs');
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const inlineDetail = useMediaQuery(INLINE_DETAIL_QUERY);
  const [tab, setTab] = useState<LogsTab>('explore');
  const [filters, setFilters] = useState<LogFilterState>(() => initialFilters(searchParams));
  const [attributeInput, setAttributeInput] = useState('');
  const [selectedLog, setSelectedLog] = useState<LogEvent | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [tailPaused, setTailPaused] = useState(false);
  const [sheet, setSheet] = useState<'filters' | 'alerts' | null>(null);

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
    // On narrow screens the log detail is a sheet too: do not stack two.
    if (!inlineDetail) setSelectedLog(null);
  }

  function selectLog(row: LogEvent) {
    setSelectedLog((current) => (current?.id === row.id && current.source === row.source ? null : row));
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

  const firstPage = logsQuery.data?.pages[0];
  const stats = firstPage?.stats;
  const rows = useMemo(() => logsQuery.data?.pages.flatMap((page) => page.logs) ?? [], [logsQuery.data]);
  // Newest first, like the explorer (the tail hook appends).
  const tailRows = useMemo(() => [...tail.lines].reverse(), [tail.lines]);
  const traces = tracesQuery.data?.traces ?? [];
  const filtered = hasLogFilters(filters);
  const traceRootName = useMemo(
    () => (traceDetailQuery.data ? waterfallRows(traceDetailQuery.data.spans)[0]?.span.name : undefined),
    [traceDetailQuery.data],
  );

  const withCurrent = (values: string[], current: string) => (current && !values.includes(current) ? [...values, current] : values);
  const toOptions = (values: string[]) => values.map((value) => ({ value, label: value }));
  const serviceOptions = toOptions(withCurrent(stats?.services.map((row) => row.service) ?? [], filters.service));
  const environmentOptions = toOptions(withCurrent(stats?.environments.map((row) => row.environment) ?? [], filters.environment));
  const releaseOptions = toOptions(withCurrent(stats?.releases.map((row) => row.release) ?? [], filters.release));

  function submitAttribute() {
    const attribute = parseAttributeInput(attributeInput);
    if (!attribute) return;
    addAttribute(attribute);
    setAttributeInput('');
  }

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

  const toolbar = (
    <div className="q-toolbar q-logs-toolbar">
      <div className="q-search">
        <Search className="q-search-icon" size={15} strokeWidth={2} aria-hidden />
        <Input
          type="search"
          className="q-search-input"
          placeholder={tab === 'traces' ? t('logsSearchSpans') : t('logsSearchPlaceholder')}
          value={filters.search}
          onChange={(event) => update({ search: event.target.value })}
          aria-label={tab === 'traces' ? t('logsSearchSpans') : t('logsSearchPlaceholder')}
        />
      </div>
      <FilterSelect
        label={t('logAlertService')}
        value={filters.service}
        onChange={(service) => update({ service })}
        allLabel={t('logsAllServices')}
        options={serviceOptions}
      />
      <FilterSelect
        label={t('logsFilterEnvironment')}
        value={filters.environment}
        onChange={(environment) => update({ environment })}
        allLabel={t('allEnvironments')}
        options={environmentOptions}
      />
      {releaseOptions.length ? (
        <FilterSelect
          label={t('logsFilterRelease')}
          value={filters.release}
          onChange={(release) => update({ release })}
          allLabel={t('allReleases')}
          options={releaseOptions}
        />
      ) : null}
      <FilterSelect
        label={t('logsSource')}
        value={filters.source}
        onChange={(source) => update({ source: source as LogFilterState['source'] })}
        allLabel={t('logsAllSources')}
        options={[
          { value: 'otlp', label: t('logsSourceOtlp') },
          { value: 'browser', label: t('logsSourceBrowser') },
        ]}
      />
      {tab !== 'traces' ? (
        <form
          className="q-attr-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitAttribute();
          }}
        >
          <Input
            className="q-attr-input"
            value={attributeInput}
            placeholder={t('logsAttributePlaceholder')}
            aria-label={t('logsAttributeFilter')}
            onChange={(event) => setAttributeInput(event.target.value)}
          />
          <Button
            type="submit"
            variant="outline"
            size="icon-sm"
            className="q-attr-add"
            disabled={!attributeInput.trim()}
            aria-label={t('logsAddAttributeFilter')}
            title={t('logsAddAttributeFilter')}
          >
            <Plus aria-hidden />
          </Button>
        </form>
      ) : null}
      {filtered ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(EMPTY_LOG_FILTERS)}>
          {t('reset')}
        </Button>
      ) : null}
      {filtered && canEdit ? (
        <>
          <span className="q-toolbar-spacer" />
          <Button type="button" variant="ghost" size="sm" onClick={() => setSheet('filters')}>
            <Bookmark aria-hidden />
            {t('saveFilter')}
          </Button>
        </>
      ) : null}
    </div>
  );

  const detailPane =
    selectedLog && inlineDetail ? (
      <aside className="panel q-detail-pane" aria-label={t('logsDetail')}>
        <header className="q-detail-pane-head">
          <span className="q-detail-pane-title">
            <LevelBadge level={selectedLog.level} />
            {t('logsDetail')}
          </span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setSelectedLog(null)} aria-label={t('close')}>
            <X aria-hidden />
          </Button>
        </header>
        <LogDetail
          log={selectedLog}
          websiteId={websiteId}
          timezone={timezone}
          onOpenTrace={openTrace}
          onFilterAttribute={addAttribute}
        />
      </aside>
    ) : null;

  const levelTotal = (levels: LogSeverity[]) =>
    (stats?.levels ?? []).filter((row) => levels.includes(row.level)).reduce((sum, row) => sum + row.logs, 0);
  const share = (count: number) =>
    stats?.logs ? t('qualityShareOfLines').replace('{pct}', formatPercent((count / stats.logs) * 100, { digits: 1 })) : undefined;

  return (
    <Page className="q-page q-page--logs">
      <PageHeader
        title={t('logs')}
        lead={t('qualityLogsLead')}
        actions={
          <div className="q-header-actions">
            <Button type="button" variant="outline" onClick={() => setSheet('filters')}>
              <Bookmark aria-hidden />
              {t('logsSavedFilters')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setSheet('alerts')}>
              <BellRing aria-hidden />
              {t('logsAlertRules')}
            </Button>
            <WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />
          </div>
        }
      />

      <PageBody className="stack">
        {viewOnly ? <p className="q-view-only">{t('viewOnlyHint')}</p> : null}

        <PageTabs
          label={t('logs')}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'explore', label: t('logsTabExplore') },
            { id: 'tail', label: t('logsTabTail') },
            { id: 'traces', label: t('logsTabTraces') },
          ]}
        />

        <div className="q-toolbar-block">
          {toolbar}
          {activeChips.length ? (
            <ul className="q-chips" aria-label={t('logsActiveFilters')}>
              {activeChips.map((chip) => (
                <li key={chip.key} className="q-chip">
                  <span className="mono">{chip.label}</span>
                  <button type="button" className="q-chip-remove" onClick={chip.clear} aria-label={`${t('remove')}: ${chip.label}`}>
                    <X size={12} strokeWidth={2} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {tab === 'explore' ? (
          <DataViewState
            loading={logsQuery.isLoading && !logsQuery.data}
            error={logsQuery.isError && !logsQuery.data ? logsQuery.error : null}
            onRetry={() => logsQuery.refetch()}
            loadingFallback={
              <div className="stack">
                <KpiStripSkeleton cells={4} />
                <SectionCard title={t('logsHistogram')}>
                  <Skeleton className="h-[180px] w-full" />
                </SectionCard>
                <SectionCard flush title={t('qualityLogLines')}>
                  <TableSkeleton rows={8} columns={4} />
                </SectionCard>
              </div>
            }
          >
            {stats && stats.logs === 0 && !filtered && !rows.length ? (
              <EmptyState variant="rich" icon={<ScrollText />} title={t('logsEmptyTitle')} description={t('logsEmptyBody')}>
                {firstPage?.otlpEnabled ? <OtlpSetupHint /> : null}
              </EmptyState>
            ) : (
              <>
              <KpiStrip columns={4}>
                <KpiCell
                  label={t('qualityLogLines')}
                  value={formatNumber(stats?.logs ?? 0)}
                  hint={
                    stats?.lastSeenAt ? (
                      <>
                        {t('qualityLastLine')} <RelativeTime value={stats.lastSeenAt} timeZone={timezone} />
                      </>
                    ) : undefined
                  }
                />
                <KpiCell label={t('qualityErrorLines')} value={formatNumber(levelTotal(['error', 'fatal']))} hint={share(levelTotal(['error', 'fatal']))} />
                <KpiCell label={t('qualityWarningLines')} value={formatNumber(levelTotal(['warn']))} hint={share(levelTotal(['warn']))} />
                <KpiCell
                  label={t('logsAffectedSessions')}
                  value={formatNumber(stats?.sessions ?? 0)}
                  hint={stats ? t('qualityServicesCount').replace('{count}', formatNumber(stats.services.length)) : undefined}
                />
              </KpiStrip>

              <LogHistogram
                histogram={histogramQuery.data}
                range={range}
                selected={filters.levels}
                onToggle={toggleLevel}
                timezone={timezone}
                loading={histogramQuery.isLoading}
                filtered={filtered}
              />

              <div className={cn('q-split', detailPane && 'has-detail')}>
                <SectionCard
                  flush
                  title={t('qualityLogLines')}
                  actions={
                    rows.length ? (
                      <span className="q-card-count">
                        {t('qualityShownOf')
                          .replace('{shown}', formatNumber(rows.length))
                          .replace('{total}', formatNumber(stats?.logs ?? rows.length))}
                      </span>
                    ) : null
                  }
                  footer={
                    logsQuery.hasNextPage ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={logsQuery.isFetchingNextPage}
                        onClick={() => logsQuery.fetchNextPage()}
                      >
                        {logsQuery.isFetchingNextPage ? t('loading') : t('logsLoadMore')}
                      </Button>
                    ) : undefined
                  }
                >
                  {rows.length ? (
                    <LogTable rows={rows} selectedId={selectedLog?.id ?? null} timezone={timezone} onSelect={selectLog} />
                  ) : (
                    <EmptyState
                      icon={<ScrollText />}
                      title={t('logsEmptyTitle')}
                      description={filtered ? t('logsEmptyFiltered') : t('logsEmptyBody')}
                    />
                  )}
                </SectionCard>
                {detailPane}
              </div>
              </>
            )}
          </DataViewState>
        ) : null}

        {tab === 'tail' ? (
          <div className={cn('q-split', detailPane && 'has-detail')}>
            <SectionCard
              flush
              title={
                <span className="q-live-title">
                  <span className={cn('q-live-dot', (tailPaused || Boolean(tail.error)) && 'is-idle')} aria-hidden />
                  {t('logsTabTail')}
                </span>
              }
              description={
                <>
                  {tailPaused ? t('logsTailPaused') : t('logsTailLive')} ·{' '}
                  {t('qualityTailCount')
                    .replace('{count}', formatNumber(tail.lines.length))
                    .replace('{max}', formatNumber(TAIL_MAX_LINES))}
                </>
              }
              actions={
                <>
                  <div className="q-sev-toggles" role="group" aria-label={t('logsLevel')}>
                    {LOG_SEVERITIES.map((level) => {
                      const active = filters.levels.includes(level);
                      return (
                        <button
                          key={level}
                          type="button"
                          className={cn('q-sev-toggle', active && 'is-active', filters.levels.length > 0 && !active && 'is-dimmed')}
                          aria-pressed={active}
                          onClick={() => toggleLevel(level)}
                        >
                          <span className="q-sev-key" style={{ background: `var(${SEVERITY_CHART_VARS[level]})` }} aria-hidden />
                          {level}
                        </button>
                      );
                    })}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setTailPaused((paused) => !paused)}>
                    {tailPaused ? <Play aria-hidden /> : <Pause aria-hidden />}
                    {tailPaused ? t('logsTailResume') : t('logsTailPause')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={tail.clear}>
                    {t('logsTailClear')}
                  </Button>
                </>
              }
            >
              {tail.error ? (
                <p className="q-inline-alert" role="status">
                  {t('logsTailError')}
                </p>
              ) : null}
              {tailRows.length ? (
                <LogTable compact rows={tailRows} selectedId={selectedLog?.id ?? null} timezone={timezone} onSelect={selectLog} />
              ) : (
                <EmptyState icon={<Radio />} title={t('logsTailWaiting')} description={t('logsTailWaitingBody')} />
              )}
            </SectionCard>
            {detailPane}
          </div>
        ) : null}

        {tab === 'traces' ? (
          <SectionCard
            flush
            title={t('logsTraces')}
            description={t('logsTracesLead')}
            actions={
              <label className="q-switch-label">
                <Switch checked={errorsOnly} onCheckedChange={(checked) => setErrorsOnly(checked)} />
                {t('logsErrorsOnly')}
              </label>
            }
          >
            {tracesQuery.isLoading && !tracesQuery.data ? (
              <TableSkeleton rows={6} columns={5} />
            ) : tracesQuery.isError && !tracesQuery.data ? (
              <DataViewState error={tracesQuery.error} onRetry={() => tracesQuery.refetch()}>
                {null}
              </DataViewState>
            ) : traces.length ? (
              <TracesTable traces={traces} selectedTraceId={selectedTraceId} onOpen={openTrace} />
            ) : (
              <EmptyState icon={<GitBranch />} title={t('noTraces')} description={t('logsTracesEmpty')} />
            )}
          </SectionCard>
        ) : null}
      </PageBody>

      {/* Log detail on narrow screens (wide screens show the side pane). */}
      <SideSheet
        open={Boolean(selectedLog) && !inlineDetail}
        onOpenChange={(open) => {
          if (!open) setSelectedLog(null);
        }}
        title={
          selectedLog ? (
            <span className="q-detail-pane-title">
              <LevelBadge level={selectedLog.level} />
              {t('logsDetail')}
            </span>
          ) : (
            t('logsDetail')
          )
        }
      >
        {selectedLog ? (
          <LogDetail
            log={selectedLog}
            websiteId={websiteId}
            timezone={timezone}
            onOpenTrace={openTrace}
            onFilterAttribute={addAttribute}
          />
        ) : null}
      </SideSheet>

      <SideSheet
        open={Boolean(selectedTraceId)}
        onOpenChange={(open) => {
          if (!open) setSelectedTraceId(null);
        }}
        width={760}
        title={traceRootName ?? t('logsTraceDetail')}
        description={
          traceDetailQuery.data?.services.length ? traceDetailQuery.data.services.join(' · ') : undefined
        }
      >
        {traceDetailQuery.data && selectedTraceId ? (
          <TraceWaterfall
            trace={traceDetailQuery.data}
            websiteId={websiteId}
            timezone={timezone}
            onSelectLog={(log) => {
              setSelectedTraceId(null);
              setSelectedLog(log);
            }}
            onFilterAttribute={(filter) => {
              setSelectedTraceId(null);
              addAttribute(filter);
            }}
          />
        ) : traceDetailQuery.isError ? (
          <EmptyState icon={<GitBranch />} title={t('noTraces')} description={t('logsTraceMissing')} />
        ) : (
          <div className="stack" aria-hidden>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}
      </SideSheet>

      <LogSavedFiltersSheet
        websiteId={websiteId}
        canEdit={canEdit}
        filters={filters}
        open={sheet === 'filters'}
        onOpenChange={(open) => setSheet(open ? 'filters' : null)}
        onApply={(saved) => {
          setFilters(filtersFromSaved(saved));
          setTab('explore');
          setSheet(null);
        }}
      />
      <LogAlertRulesSheet
        websiteId={websiteId}
        canEdit={canEdit}
        open={sheet === 'alerts'}
        onOpenChange={(open) => setSheet(open ? 'alerts' : null)}
      />
    </Page>
  );
}

function TracesTable({
  traces,
  selectedTraceId,
  onOpen,
}: {
  traces: LogTraceSummary[];
  selectedTraceId: string | null;
  onOpen: (traceId: string) => void;
}) {
  // Bars scale to the 95th percentile so one slow outlier does not flatten every other row;
  // anything slower fills the track (its value still reads exactly).
  const sorted = traces.map((trace) => trace.durationMs).sort((a, b) => a - b);
  const longest = Math.max(1, sorted.length >= 10 ? sorted[Math.floor(sorted.length * 0.95)]! : (sorted[sorted.length - 1] ?? 1));
  return (
    <div className="table-scroll">
      <table className="data-table data-table--interactive q-traces-table">
        <thead>
          <tr>
            <th>{t('logsTraceRoot')}</th>
            <th className="num">{t('logsTraceSpans')}</th>
            <th>{t('logsTraceDuration')}</th>
            <th>{t('status')}</th>
            <th>{t('qualityStarted')}</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((trace) => (
            <tr
              key={trace.traceId}
              className={trace.traceId === selectedTraceId ? 'is-selected' : undefined}
              tabIndex={0}
              onClick={() => onOpen(trace.traceId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onOpen(trace.traceId);
              }}
            >
              <td>
                <div className="q-issue-copy">
                  <span className="q-trace-root">{trace.rootName ?? trace.traceId.slice(0, 16)}</span>
                  <span className="q-issue-meta">
                    <span className="mono">{trace.rootService ?? '-'}</span>
                    <span className="mono">{trace.traceId.slice(0, 12)}</span>
                  </span>
                </div>
              </td>
              <td className="num">
                {formatNumber(trace.spans)}
                <span className="q-cell-sub">{t('qualityServicesCount').replace('{count}', formatNumber(trace.services))}</span>
              </td>
              <td>
                <span className="q-dur">
                  <span className="q-dur-track" aria-hidden>
                    <span className={cn('q-dur-bar', trace.hasError && 'is-error')} style={{ width: `${Math.min(100, Math.max(2, (trace.durationMs / longest) * 100))}%` }} />
                  </span>
                  <span className="q-dur-value">{formatSpanDuration(trace.durationMs * 1000)}</span>
                </span>
              </td>
              <td>
                <StatusBadge tone={trace.hasError ? 'danger' : 'success'}>
                  {trace.hasError ? t('logsTraceStatusError') : t('logsTraceStatusOk')}
                </StatusBadge>
              </td>
              <td className="q-col-when">
                <RelativeTime value={trace.startedAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shown on an empty explorer: where to point an OpenTelemetry exporter. */
function OtlpSetupHint() {
  const endpoint = INGEST_URL_FOR_DOCS.replace(/\/$/, '');
  return (
    <div className="q-otlp-hint">
      <p className="q-otlp-hint-title">{t('logsOtlpHintTitle')}</p>
      <p className="q-field-hint">{t('logsOtlpHintBody')}</p>
      <CodeBlock
        code={`OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20fb_pk_…`}
      />
    </div>
  );
}
