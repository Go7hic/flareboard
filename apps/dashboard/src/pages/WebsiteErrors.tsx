import { useMemo, useState, type MouseEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BellRing, Bug, FileCode2, MoreHorizontal } from 'lucide-react';
import { DateRangePicker } from '../components/DateRangePicker';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { ErrorIssueStatusBadge } from '../components/ErrorIssueStatusBadge';
import { ErrorIssueTrend } from '../components/ErrorIssueTrend';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { useConfirm } from '../components/ConfirmDialog';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorAlertRulesSheet } from '../components/quality/ErrorAlertRulesSheet';
import { ErrorOccurrencesChart, errorSeverity, severityVar } from '../components/quality/ErrorOccurrencesChart';
import { ErrorSourceMapsSheet } from '../components/quality/ErrorSourceMapsSheet';
import { FilterSelect } from '../components/quality/FilterSelect';
import { RelativeTime } from '../components/quality/RelativeTime';
import { TableSkeleton } from '../components/quality/TableSkeleton';
import {
  api,
  type ErrorEventsResponse,
  type ErrorIssue,
  type ErrorIssueStatus,
  type WebsiteStats,
} from '../lib/api';
import { formatNumber, formatPercent, shortId } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

type StatusFilter = 'all' | 'open' | 'regressed' | 'resolved' | 'ignored';

/** The API returns at most this many issues (top by occurrences). */
const ISSUE_LIMIT = 25;
const EVENTS_PREVIEW = 10;

function shortText(value: string | null | undefined, fallback = '-', max = 140) {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function stop(event: MouseEvent) {
  event.stopPropagation();
}

export default function WebsiteErrorsPage() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { websiteId = '' } = useParams<{ websiteId: string }>();
  const queryClient = useQueryClient();
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId, 'errors');
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState('');
  const [releaseFilter, setReleaseFilter] = useState('');
  const [environmentFilter, setEnvironmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [sheet, setSheet] = useState<'source-maps' | 'alerts' | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);

  const errorsQs = useMemo(() => {
    const params = new URLSearchParams(rangeQs);
    if (releaseFilter) params.set('release', releaseFilter);
    if (environmentFilter) params.set('environment', environmentFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    return params.toString();
  }, [environmentFilter, rangeQs, releaseFilter, statusFilter]);

  const errorsQuery = useQuery({
    queryKey: ['errors', websiteId, range, releaseFilter, environmentFilter, statusFilter],
    enabled: Boolean(websiteId),
    placeholderData: keepPreviousData,
    queryFn: () => api<ErrorEventsResponse>(`/api/websites/${websiteId}/errors?${errorsQs}`),
  });

  // Sessions in the range (all of them), for the share that saw no error.
  const totalsQuery = useQuery({
    queryKey: ['website-stats', websiteId, rangeQs],
    enabled: Boolean(websiteId),
    placeholderData: keepPreviousData,
    queryFn: () => api<WebsiteStats>(`/api/websites/${websiteId}/stats?${rangeQs}`),
  });

  const updateIssueMutation = useMutation({
    mutationFn: ({ fingerprint, status }: { fingerprint: string; status: 'open' | 'resolved' | 'ignored' }) =>
      api(`/api/websites/${websiteId}/errors/issues`, {
        method: 'PATCH',
        body: JSON.stringify({ fingerprint, status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['errors', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['error-issue', websiteId] });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: ({ target, sources }: { target: string; sources: string[] }) =>
      api(`/api/websites/${websiteId}/errors/issues/merge`, {
        method: 'POST',
        body: JSON.stringify({ targetFingerprint: target, sourceFingerprints: sources }),
      }),
    onSuccess: () => {
      setSelectedIssues([]);
      setMergeTarget('');
      queryClient.invalidateQueries({ queryKey: ['errors', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['error-issue', websiteId] });
    },
  });

  const data = errorsQuery.data;
  const stats = data?.stats;
  const issues = useMemo(() => data?.issues ?? [], [data?.issues]);
  const events = data?.errors ?? [];
  const releaseOptions = useMemo(() => {
    const values = new Set(stats?.releases?.map((row) => row.release) ?? []);
    if (releaseFilter) values.add(releaseFilter);
    return [...values].map((value) => ({ value, label: value }));
  }, [releaseFilter, stats?.releases]);
  const environmentOptions = useMemo(() => {
    const values = new Set(stats?.environments?.map((row) => row.environment) ?? []);
    if (environmentFilter) values.add(environmentFilter);
    return [...values].map((value) => ({ value, label: value }));
  }, [environmentFilter, stats?.environments]);
  const hasFilters = Boolean(releaseFilter || environmentFilter || statusFilter !== 'open');

  // Selection only covers issues still on screen (filters or range may have changed).
  const selectedVisible = selectedIssues.filter((fingerprint) => issues.some((issue) => issue.fingerprint === fingerprint));
  const effectiveMergeTarget = selectedVisible.includes(mergeTarget) ? mergeTarget : (selectedVisible[0] ?? '');
  const toggleIssueSelection = (fingerprint: string, checked: boolean) =>
    setSelectedIssues((prev) =>
      checked ? [...new Set([...prev, fingerprint])] : prev.filter((value) => value !== fingerprint),
    );
  const allSelected = issues.length > 0 && selectedVisible.length === issues.length;
  const issueTitle = (fingerprint: string) =>
    shortText(issues.find((item) => item.fingerprint === fingerprint)?.message, fingerprint, 60);
  const issueHref = (fingerprint: string) => `/websites/${websiteId}/errors/issues/${encodeURIComponent(fingerprint)}`;

  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'open', label: t('errorIssueStatus_open') },
    { value: 'regressed', label: t('errorIssueStatus_regressed') },
    { value: 'resolved', label: t('errorIssueStatus_resolved') },
    { value: 'ignored', label: t('errorIssueStatus_ignored') },
    { value: 'all', label: t('allStatuses') },
  ];

  const toolbar = (
    <div className="q-toolbar">
      <FilterSelect
        label={t('errorFilterStatus')}
        value={statusFilter}
        active={statusFilter !== 'open'}
        onChange={(value) => setStatusFilter((value || 'open') as StatusFilter)}
        options={statusOptions}
      />
      <FilterSelect
        label={t('errorFilterRelease')}
        value={releaseFilter}
        onChange={setReleaseFilter}
        allLabel={t('allReleases')}
        options={releaseOptions}
      />
      <FilterSelect
        label={t('errorFilterEnvironment')}
        value={environmentFilter}
        onChange={setEnvironmentFilter}
        allLabel={t('allEnvironments')}
        options={environmentOptions}
      />
      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setReleaseFilter('');
            setEnvironmentFilter('');
            setStatusFilter('open');
          }}
        >
          {t('reset')}
        </Button>
      ) : null}
      {errorsQuery.isFetching && data ? <span className="q-toolbar-meta">{t('loading')}</span> : null}
    </div>
  );

  const loadingFallback = (
    <div className="stack">
      <KpiStripSkeleton cells={4} />
      <SectionCard title={t('qualityOccurrences')}>
        <Skeleton className="h-[200px] w-full" />
      </SectionCard>
      <SectionCard flush title={t('errorIssues')}>
        <TableSkeleton rows={5} columns={5} />
      </SectionCard>
    </div>
  );

  return (
    <Page className="q-page q-page--errors">
      <PageHeader
        title={t('errors')}
        lead={t('qualityErrorsLead')}
        actions={
          <div className="q-header-actions">
            <Button type="button" variant="outline" size="sm" onClick={() => setSheet('source-maps')}>
              <FileCode2 aria-hidden />
              {t('errorsTabSourceMaps')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setSheet('alerts')}>
              <BellRing aria-hidden />
              {t('errorsTabAlerts')}
            </Button>
            <DateRangePicker value={range} onChange={setRange} popover timezone={timezone} />
          </div>
        }
        toolbar={toolbar}
      />

      <PageBody className="stack">
        {viewOnly ? <p className="q-view-only">{t('viewOnlyHint')}</p> : null}

        <DataViewState
          loading={errorsQuery.isLoading && !data}
          error={errorsQuery.isError && !data ? errorsQuery.error : null}
          onRetry={() => errorsQuery.refetch()}
          loadingFallback={loadingFallback}
        >
          {stats ? (
            <>
              <ErrorsKpiStrip
                stats={stats}
                issues={issues}
                totalSessions={totalsQuery.data?.visitors.value}
              />

              {stats.errors === 0 ? (
                <EmptyState
                  variant="rich"
                  icon={<Bug />}
                  title={hasFilters ? t('errorIssuesEmptyTitle') : t('errorsEmptyTitle')}
                  description={hasFilters ? t('qualityErrorsEmptyFiltered') : t('errorsEmptyBody')}
                />
              ) : (
                <>
                  <ErrorOccurrencesChart issues={issues} stats={stats} range={range} timezone={timezone} />

                  <SectionCard
                    flush
                    title={t('errorIssues')}
                    description={canEdit ? t('qualityIssuesLeadEdit') : t('qualityIssuesLead')}
                    actions={
                      canEdit && selectedVisible.length ? (
                        <div className="q-merge-bar" aria-live="polite">
                          <span className="q-merge-count">
                            {t('qualitySelectedCount').replace('{count}', formatNumber(selectedVisible.length))}
                          </span>
                          {selectedVisible.length >= 2 ? (
                            <>
                              <FilterSelect
                                label={t('errorIssueMergeInto')}
                                value={effectiveMergeTarget}
                                active
                                onChange={setMergeTarget}
                                options={selectedVisible.map((fingerprint) => ({
                                  value: fingerprint,
                                  label: `${t('errorIssueMergeInto')} ${issueTitle(fingerprint)}`,
                                }))}
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="primary"
                                disabled={mergeMutation.isPending}
                                onClick={() => {
                                  const target = effectiveMergeTarget;
                                  const sources = selectedVisible.filter((fingerprint) => fingerprint !== target);
                                  confirm({
                                    title: t('errorIssueMergeTitle'),
                                    description: `${t('errorIssueMergeInto')}: ${issueTitle(target)}. ${t('errorIssueMergeBody')}`,
                                    confirmLabel: t('errorIssueMerge'),
                                    onConfirm: () => mergeMutation.mutate({ target, sources }),
                                  });
                                }}
                              >
                                {t('errorIssueMerge')}
                              </Button>
                            </>
                          ) : (
                            <span className="q-merge-hint">{t('errorIssueMergeHint')}</span>
                          )}
                          <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedIssues([])}>
                            {t('qualityClearSelection')}
                          </Button>
                        </div>
                      ) : (
                        <span className="q-card-count">
                          {issues.length >= ISSUE_LIMIT
                            ? t('qualityTopIssues').replace('{count}', formatNumber(ISSUE_LIMIT))
                            : t('qualityIssueCount').replace('{count}', formatNumber(issues.length))}
                        </span>
                      )
                    }
                  >
                    {issues.length ? (
                      <div className="table-scroll">
                        <table className="data-table data-table--interactive q-issues-table">
                          <thead>
                            <tr>
                              {canEdit ? (
                                <th className="q-col-check">
                                  <Checkbox
                                    checked={allSelected}
                                    onCheckedChange={(checked) =>
                                      setSelectedIssues(checked === true ? issues.map((issue) => issue.fingerprint) : [])
                                    }
                                    aria-label={t('qualitySelectAll')}
                                  />
                                </th>
                              ) : null}
                              <th>{t('issue')}</th>
                              <th>{t('status')}</th>
                              <th className="num">{t('qualityOccurrences')}</th>
                              <th className="num">{t('users')}</th>
                              <th>{t('lastSeen')}</th>
                              {canEdit ? (
                                <th className="q-col-actions">
                                  <span className="sr-only">{t('actions')}</span>
                                </th>
                              ) : null}
                            </tr>
                          </thead>
                          <tbody>
                            {issues.map((issue) => (
                              <IssueRow
                                key={issue.fingerprint}
                                issue={issue}
                                href={issueHref(issue.fingerprint)}
                                canEdit={canEdit}
                                selected={selectedVisible.includes(issue.fingerprint)}
                                onSelect={(checked) => toggleIssueSelection(issue.fingerprint, checked)}
                                onOpen={() => navigate(issueHref(issue.fingerprint))}
                                statusPending={updateIssueMutation.isPending}
                                onStatus={(status) => updateIssueMutation.mutate({ fingerprint: issue.fingerprint, status })}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState icon={<Bug />} title={t('errorIssuesEmptyTitle')} description={t('qualityErrorsEmptyFiltered')} />
                    )}
                  </SectionCard>

                  {events.length ? (
                    <SectionCard
                      flush
                      title={t('errorsRecent')}
                      description={t('qualityRecentErrorsLead')}
                      footer={
                        events.length > EVENTS_PREVIEW ? (
                          <button type="button" className="card-footer-link" onClick={() => setShowAllEvents((value) => !value)}>
                            {showAllEvents
                              ? t('qualityShowFewer')
                              : t('qualityShowAll').replace('{count}', formatNumber(events.length))}
                          </button>
                        ) : undefined
                      }
                    >
                      <div className="table-scroll">
                        <table className="data-table data-table--interactive q-events-table">
                          <thead>
                            <tr>
                              <th>{t('error')}</th>
                              <th>{t('page')}</th>
                              <th>{t('release')}</th>
                              <th>{t('session')}</th>
                              <th>{t('when')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(showAllEvents ? events : events.slice(0, EVENTS_PREVIEW)).map((row) => {
                              const href = `/websites/${websiteId}/errors/${row.id}`;
                              const severity = errorSeverity(row.severity);
                              return (
                                <tr key={row.id} onClick={() => navigate(href)}>
                                  <td>
                                    <div className="q-issue">
                                      <span className="q-sev-dot" style={{ background: severityVar(severity) }} title={severity} aria-hidden />
                                      <div className="q-issue-copy">
                                        <Link to={href} className="q-issue-title" onClick={stop}>
                                          {shortText(row.message ?? row.eventName, t('unknown'))}
                                        </Link>
                                        <span className="q-issue-meta">
                                          {severity !== 'error' ? <span className="q-issue-sev">{severity}</span> : null}
                                          <span>{shortText(row.name, t('errorNameFallback'), 60)}</span>
                                        </span>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="mono q-col-path" title={row.urlPath || '/'}>
                                    {row.urlPath || '/'}
                                  </td>
                                  <td className="q-col-muted">
                                    {row.release ?? '-'}
                                    {row.environment ? <span className="q-cell-sub">{row.environment}</span> : null}
                                  </td>
                                  <td>
                                    <Link
                                      to={`/websites/${websiteId}/sessions/${row.sessionId}`}
                                      className="q-id-link"
                                      onClick={stop}
                                      title={row.sessionId}
                                    >
                                      {shortId(row.sessionId)}
                                    </Link>
                                  </td>
                                  <td className="q-col-when">
                                    <RelativeTime value={row.createdAt} />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </SectionCard>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </DataViewState>
      </PageBody>

      <ErrorSourceMapsSheet
        websiteId={websiteId}
        canEdit={canEdit}
        release={releaseFilter}
        open={sheet === 'source-maps'}
        onOpenChange={(open) => setSheet(open ? 'source-maps' : null)}
      />
      <ErrorAlertRulesSheet
        websiteId={websiteId}
        canEdit={canEdit}
        open={sheet === 'alerts'}
        onOpenChange={(open) => setSheet(open ? 'alerts' : null)}
      />
    </Page>
  );
}

function ErrorsKpiStrip({
  stats,
  issues,
  totalSessions,
}: {
  stats: ErrorEventsResponse['stats'];
  issues: ErrorIssue[];
  totalSessions: number | undefined;
}) {
  const regressed = issues.filter((issue) => issue.status === 'regressed').length;
  const errorFree =
    totalSessions && totalSessions > 0 ? Math.max(0, ((totalSessions - stats.sessions) / totalSessions) * 100) : undefined;
  const lastSeen = stats.lastSeenAt ? <RelativeTime value={stats.lastSeenAt} /> : null;
  return (
    <KpiStrip columns={4}>
      <KpiCell
        label={t('errorIssues')}
        value={issues.length >= ISSUE_LIMIT ? `${ISSUE_LIMIT}+` : formatNumber(issues.length)}
        hint={regressed ? t('qualityRegressedCount').replace('{count}', formatNumber(regressed)) : undefined}
      />
      <KpiCell
        label={t('qualityOccurrences')}
        value={formatNumber(stats.errors)}
        hint={lastSeen ? <>{t('qualityLastSeenHint')} {lastSeen}</> : undefined}
      />
      <KpiCell
        label={t('errorsAffectedSessions')}
        value={formatNumber(stats.sessions)}
        hint={t('qualityUsersCount').replace('{count}', formatNumber(stats.users))}
      />
      <KpiCell
        label={t('qualityErrorFreeSessions')}
        value={errorFree === undefined ? '-' : formatPercent(errorFree, { digits: errorFree >= 99 && errorFree < 100 ? 2 : 1 })}
        hint={
          totalSessions !== undefined
            ? t('qualityOfSessions').replace('{count}', formatNumber(totalSessions))
            : undefined
        }
      />
    </KpiStrip>
  );
}

function IssueRow({
  issue,
  href,
  canEdit,
  selected,
  onSelect,
  onOpen,
  statusPending,
  onStatus,
}: {
  issue: ErrorIssue;
  href: string;
  canEdit: boolean;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onOpen: () => void;
  statusPending: boolean;
  onStatus: (status: 'open' | 'resolved' | 'ignored') => void;
}) {
  const severity = errorSeverity(issue.severity);
  const location = issue.samples[0]?.urlPath;
  const actions: Array<'open' | 'resolved' | 'ignored'> = (['resolved', 'ignored', 'open'] as const).filter(
    (status) => status !== (issue.status === 'regressed' ? 'open' : (issue.status as ErrorIssueStatus)),
  );
  return (
    <tr className={selected ? 'is-selected' : undefined} onClick={onOpen}>
      {canEdit ? (
        <td className="q-col-check" onClick={stop}>
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelect(checked === true)}
            aria-label={`${t('errorIssueSelect')}: ${shortText(issue.message, issue.fingerprint, 60)}`}
          />
        </td>
      ) : null}
      <td className="q-col-issue">
        <div className="q-issue">
          <span className="q-sev-dot" style={{ background: severityVar(severity) }} title={severity} aria-hidden />
          <div className="q-issue-copy">
            <Link to={href} className="q-issue-title" onClick={stop} title={issue.message ?? undefined}>
              {shortText(issue.message, t('unknown'))}
            </Link>
            <span className="q-issue-meta">
              {severity !== 'error' ? <span className="q-issue-sev">{severity}</span> : null}
              <span className="q-issue-name">{issue.name ?? t('errorNameFallback')}</span>
              {location ? (
                <span className="mono q-issue-location" title={location}>
                  {location}
                </span>
              ) : null}
              {issue.mergedCount ? (
                <span>{t('qualityMergedCount').replace('{count}', formatNumber(issue.mergedCount))}</span>
              ) : null}
            </span>
          </div>
        </div>
      </td>
      <td>
        <ErrorIssueStatusBadge status={issue.status} />
      </td>
      <td className="num">
        <span className="q-occ">
          <ErrorIssueTrend values={issue.trend} label={t('errorIssueTrend')} />
          <span className="q-occ-value">{formatNumber(issue.events)}</span>
        </span>
      </td>
      <td className="num">{formatNumber(issue.users)}</td>
      <td className="q-col-when">
        <RelativeTime value={issue.lastSeenAt} />
      </td>
      {canEdit ? (
        <td className="q-col-actions" onClick={stop}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`${t('actions')}: ${shortText(issue.message, '', 40)}`} />}
            >
              <MoreHorizontal aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              {actions.map((status) => (
                <DropdownMenuItem key={status} disabled={statusPending} onClick={() => onStatus(status)}>
                  {t(`errorIssueAction_${status}`)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onOpen}>{t('errorIssueViewIssue')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      ) : null}
    </tr>
  );
}
