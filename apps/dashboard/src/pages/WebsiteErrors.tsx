import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { DateRangePicker } from '../components/DateRangePicker';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { MasterDetailSidePane, MasterDetailTableLayout } from '../components/master-detail';
import { SegmentTabs } from '../components/SegmentTabs';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { StatCard } from '../components/ui/stat-card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, type ErrorAlertRule, type ErrorEventsResponse, type ErrorSourceMap } from '../lib/api';
import { formatDateOnly, formatDateTime, formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

function formatTime(value: number | null | undefined) {
  return formatDateTime(value);
}

function shortText(value: string | null | undefined, fallback = '-') {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function formatDate(value: string) {
  return formatDateOnly(`${value}T00:00:00Z`);
}

type ErrorIssueStatusFilter = 'all' | 'open' | 'resolved' | 'ignored';

const ERROR_SECONDARY_TABS = ['events', 'source-maps', 'alerts'] as const;
type ErrorSecondaryTab = (typeof ERROR_SECONDARY_TABS)[number];

export default function WebsiteErrorsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const queryClient = useQueryClient();
  const { canEdit } = useWebsitePermissions(websiteId, 'errors');
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);
  const [releaseFilter, setReleaseFilter] = useState('');
  const [environmentFilter, setEnvironmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<ErrorIssueStatusFilter>('open');
  const [secondaryTab, setSecondaryTab] = useState<ErrorSecondaryTab>('events');
  const [sourceMapDraft, setSourceMapDraft] = useState({ release: '', file: '', content: '' });
  const [alertDraft, setAlertDraft] = useState({
    name: '',
    threshold: 5,
    windowMinutes: 10,
    severity: '',
    release: '',
    environment: '',
    channel: 'record' as ErrorAlertRule['channel'],
    target: '',
  });

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
    queryFn: () => api<ErrorEventsResponse>(`/api/websites/${websiteId}/errors?${errorsQs}`),
  });

  const updateIssueMutation = useMutation({
    mutationFn: ({ fingerprint, status }: { fingerprint: string; status: 'open' | 'resolved' | 'ignored' }) =>
      api(`/api/websites/${websiteId}/errors/issues`, {
        method: 'PATCH',
        body: JSON.stringify({ fingerprint, status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['errors', websiteId] });
    },
  });

  const sourceMapsQuery = useQuery({
    queryKey: ['error-source-maps', websiteId, releaseFilter],
    enabled: Boolean(websiteId) && secondaryTab === 'source-maps',
    queryFn: () => {
      const params = releaseFilter ? `?release=${encodeURIComponent(releaseFilter)}` : '';
      return api<{ sourceMaps: ErrorSourceMap[] }>(`/api/websites/${websiteId}/errors/source-maps${params}`);
    },
  });

  const alertRulesQuery = useQuery({
    queryKey: ['error-alert-rules', websiteId],
    enabled: Boolean(websiteId) && secondaryTab === 'alerts',
    queryFn: () => api<{ alertRules: ErrorAlertRule[] }>(`/api/websites/${websiteId}/errors/alerts`),
  });

  const uploadSourceMapMutation = useMutation({
    mutationFn: () =>
      api<ErrorSourceMap>(`/api/websites/${websiteId}/errors/source-maps`, {
        method: 'POST',
        body: JSON.stringify({
          release: sourceMapDraft.release.trim(),
          file: sourceMapDraft.file.trim(),
          content: sourceMapDraft.content,
        }),
      }),
    onSuccess: () => {
      setSourceMapDraft({ release: '', file: '', content: '' });
      queryClient.invalidateQueries({ queryKey: ['error-source-maps', websiteId] });
    },
  });

  const createAlertMutation = useMutation({
    mutationFn: () =>
      api<ErrorAlertRule>(`/api/websites/${websiteId}/errors/alerts`, {
        method: 'POST',
        body: JSON.stringify({
          name: alertDraft.name.trim(),
          threshold: Number(alertDraft.threshold),
          windowMinutes: Number(alertDraft.windowMinutes),
          severity: alertDraft.severity || null,
          release: alertDraft.release.trim() || null,
          environment: alertDraft.environment.trim() || null,
          channel: alertDraft.channel,
          target: alertDraft.target.trim() || null,
          enabled: true,
        }),
      }),
    onSuccess: () => {
      setAlertDraft({
        name: '',
        threshold: 5,
        windowMinutes: 10,
        severity: '',
        release: '',
        environment: '',
        channel: 'record',
        target: '',
      });
      queryClient.invalidateQueries({ queryKey: ['error-alert-rules', websiteId] });
    },
  });

  const updateAlertMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ErrorAlertRule> }) =>
      api<ErrorAlertRule>(`/api/websites/${websiteId}/errors/alerts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['error-alert-rules', websiteId] }),
  });

  const deleteAlertMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/errors/alerts/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['error-alert-rules', websiteId] }),
  });

  const rows = errorsQuery.data?.errors ?? [];
  const issues = errorsQuery.data?.issues ?? [];
  const stats = errorsQuery.data?.stats;
  const topRelease = useMemo(() => stats?.releases?.[0], [stats?.releases]);
  const trendRows = stats?.trend ?? [];
  const severityRows = stats?.severities ?? [];
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
  const hasErrorFilters = Boolean(releaseFilter || environmentFilter || statusFilter !== 'open');
  const selectedIssue = issues.find((issue) => issue.fingerprint === expandedIssue) ?? issues[0];
  const sourceMaps = sourceMapsQuery.data?.sourceMaps ?? [];
  const alertRules = alertRulesQuery.data?.alertRules ?? [];

  return (
    <div className="page page-errors">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <div className="stats-header-row">
            <div className="stats-header-controls">
              <select
                className="select errors-filter-select"
                value={releaseFilter}
                onChange={(event) => setReleaseFilter(event.target.value)}
                aria-label={t('errorFilterRelease')}
              >
                <option value="">{t('allReleases')}</option>
                {releaseOptions.map((release) => (
                  <option key={release} value={release}>
                    {release}
                  </option>
                ))}
              </select>
              <select
                className="select errors-filter-select"
                value={environmentFilter}
                onChange={(event) => setEnvironmentFilter(event.target.value)}
                aria-label={t('errorFilterEnvironment')}
              >
                <option value="">{t('allEnvironments')}</option>
                {environmentOptions.map((environment) => (
                  <option key={environment} value={environment}>
                    {environment}
                  </option>
                ))}
              </select>
              <select
                className="select errors-filter-select"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as ErrorIssueStatusFilter)}
                aria-label={t('errorFilterStatus')}
              >
                <option value="open">{t('errorIssueStatus_open')}</option>
                <option value="all">{t('allStatuses')}</option>
                <option value="resolved">{t('errorIssueStatus_resolved')}</option>
                <option value="ignored">{t('errorIssueStatus_ignored')}</option>
              </select>
              {hasErrorFilters ? (
                <Button
                  type="button"
                  variant="secondary"
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
              <DateRangePicker value={range} onChange={setRange} popover timezone={timezone} />
            </div>
          </div>
        }
      />

      {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

      <DataViewState
        loading={errorsQuery.isLoading && !errorsQuery.data}
        error={errorsQuery.isError ? errorsQuery.error : null}
        onRetry={() => errorsQuery.refetch()}
        loadingFallback={
          <>
            <section className="analytics-hero-stats section-gap">
              <div className="skeleton" style={{ height: '5.5rem' }} />
            </section>
            <section className="panel section-gap">
              <div className="skeleton" style={{ height: '14rem' }} />
            </section>
          </>
        }
      >
        <section className="analytics-hero-stats section-gap">
          <StatCard label={t('errorsTotal')} value={formatNumber(stats?.errors ?? 0)} />
          <StatCard label={t('errorsAffectedSessions')} value={formatNumber(stats?.sessions ?? 0)} />
          <StatCard
            label={t('errorsLastSeen')}
            value={formatTime(stats?.lastSeenAt)}
            hint={topRelease ? `${t('errorsTopRelease')}: ${topRelease.release}` : undefined}
          />
        </section>

        <section className="panel section-gap page-errors-hero">
          <header className="panel-header">
            <div>
              <h2 className="section-title">{t('errorIssues')}</h2>
              <p className="text-muted">{t('errorIssuesLead')}</p>
            </div>
          </header>

          {issues.length ? (
            <MasterDetailTableLayout
              primary={
                <div className="table-scroll">
                  <table className="data-table errors-table">
                    <thead>
                      <tr>
                        <th>{t('issue')}</th>
                        <th>{t('events')}</th>
                        <th>{t('sessions')}</th>
                        <th>{t('status')}</th>
                        <th>{t('firstSeen')}</th>
                        <th>{t('lastSeen')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issues.map((issue) => (
                        <tr
                          key={issue.fingerprint}
                          className={issue.fingerprint === selectedIssue?.fingerprint ? 'active-row' : undefined}
                        >
                          <td>
                            <button
                              type="button"
                              className="error-issue-button"
                              onClick={() => setExpandedIssue(issue.fingerprint)}
                            >
                              <span className="errors-name-cell">
                                <AlertTriangle size={16} strokeWidth={2} aria-hidden />
                                <span>
                                  <span className="errors-message">
                                    {shortText(issue.message, t('unknown'))}
                                  </span>
                                  <span className="text-muted">{shortText(issue.name, t('errorNameFallback'))}</span>
                                </span>
                              </span>
                            </button>
                          </td>
                          <td>{formatNumber(issue.events)}</td>
                          <td>{formatNumber(issue.sessions)}</td>
                          <td>
                            <span className={`badge error-status-${issue.status}`}>
                              {t(`errorIssueStatus_${issue.status}`)}
                            </span>
                          </td>
                          <td>{formatTime(issue.firstSeenAt)}</td>
                          <td>{formatTime(issue.lastSeenAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
              side={
                selectedIssue ? (
                  <MasterDetailSidePane
                    title={t('errorRecentSamples')}
                    description={
                      <>
                        {t('errorIssueCurrentStatus')}: {t(`errorIssueStatus_${selectedIssue.status}`)}
                      </>
                    }
                    actions={
                      <div className="error-issue-actions">
                        {(['open', 'resolved', 'ignored'] as const).map((status) => (
                          <button
                            key={status}
                            type="button"
                            className={status === selectedIssue.status ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                            disabled={updateIssueMutation.isPending || !canEdit}
                            onClick={() => updateIssueMutation.mutate({ fingerprint: selectedIssue.fingerprint, status })}
                          >
                            {t(`errorIssueAction_${status}`)}
                          </button>
                        ))}
                      </div>
                    }
                  >
                    {selectedIssue.note ? <p className="workflow-action-note">{selectedIssue.note}</p> : null}
                    <div className="error-sample-list">
                      {selectedIssue.samples.map((sample) => (
                        <div key={sample.id} className="error-sample-item">
                          <div>
                            <strong>{sample.urlPath || '/'}</strong>
                            <p className="text-muted">{formatTime(sample.createdAt)}</p>
                          </div>
                          <Link to={`/websites/${websiteId}/sessions/${sample.sessionId}`} className="inline-link">
                            {sample.sessionId.slice(0, 8)}
                            <ExternalLink size={12} strokeWidth={2} aria-hidden />
                          </Link>
                          <Link to={`/websites/${websiteId}/errors/${sample.id}`} className="inline-link">
                            {t('viewError')}
                            <ExternalLink size={12} strokeWidth={2} aria-hidden />
                          </Link>
                        </div>
                      ))}
                    </div>
                  </MasterDetailSidePane>
                ) : null
              }
            />
          ) : (
            <EmptyState title={t('errorIssuesEmptyTitle')} description={t('errorIssuesEmptyBody')} />
          )}
        </section>
      </DataViewState>

      <section className="page-errors-secondary section-gap" aria-labelledby="errors-secondary-title">
        <div className="page-errors-secondary-head">
          <div>
            <h2 id="errors-secondary-title" className="section-title">
              {t('overviewMore')}
            </h2>
            <p className="text-muted">{t('errorsSecondaryLead')}</p>
          </div>
          <SegmentTabs
            aria-label={t('overviewMore')}
            value={secondaryTab}
            onChange={(id) => setSecondaryTab(id as ErrorSecondaryTab)}
            tabs={[
              { id: 'events', label: t('errorsTabEvents') },
              { id: 'source-maps', label: t('errorsTabSourceMaps') },
              { id: 'alerts', label: t('errorsTabAlerts') },
            ]}
          />
        </div>

        {secondaryTab === 'events' ? (
          <DataViewState
            loading={errorsQuery.isLoading && !errorsQuery.data}
            error={errorsQuery.isError ? errorsQuery.error : null}
            onRetry={() => errorsQuery.refetch()}
          >
            {(trendRows.length || severityRows.length) ? (
              <section className="panel section-gap">
                <div className="error-insights-grid">
                  <div>
                    <header className="compact-panel-header">
                      <h3 className="section-title">{t('errorsTrend')}</h3>
                      <p className="text-muted">{t('errorsTrendLead')}</p>
                    </header>
                    <div className="table-scroll">
                      <table className="data-table errors-table">
                        <thead>
                          <tr>
                            <th>{t('date')}</th>
                            <th>{t('errors')}</th>
                            <th>{t('sessions')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trendRows.map((row) => (
                            <tr key={row.date}>
                              <td>{formatDate(row.date)}</td>
                              <td>{formatNumber(row.errors)}</td>
                              <td>{formatNumber(row.sessions)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="detail-section error-severity-panel">
                    <header className="compact-panel-header">
                      <h3 className="section-title">{t('errorsSeverityBreakdown')}</h3>
                      <p className="text-muted">{t('errorsSeverityBreakdownLead')}</p>
                    </header>
                    <div className="breakdown-list">
                      {severityRows.map((row) => {
                        const share = stats?.errors ? Math.round((row.errors / stats.errors) * 100) : 0;
                        return (
                          <div key={row.severity} className="breakdown-row">
                            <div className="breakdown-meta">
                              <strong>{row.severity}</strong>
                              <span className="text-muted">
                                {formatNumber(row.errors)} ({formatPercent(share)})
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

            <section className="panel">
              <header className="panel-header">
                <div>
                  <h3 className="section-title">{t('errorsRecent')}</h3>
                  <p className="text-muted">{t('errorsLead')}</p>
                </div>
              </header>

              {rows.length ? (
                <div className="table-scroll">
                  <table className="data-table errors-table">
                    <thead>
                      <tr>
                        <th>{t('error')}</th>
                        <th>{t('page')}</th>
                        <th>{t('session')}</th>
                        <th>{t('release')}</th>
                        <th>{t('environment')}</th>
                        <th>{t('when')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <div className="errors-name-cell">
                              <AlertTriangle size={16} strokeWidth={2} aria-hidden />
                              <div>
                                <div className="errors-message">{shortText(row.message ?? row.eventName, t('unknown'))}</div>
                                <div className="text-muted">{shortText(row.name, t('errorNameFallback'))}</div>
                              </div>
                            </div>
                          </td>
                          <td className="mono">{row.urlPath || '/'}</td>
                          <td>
                            <Link to={`/websites/${websiteId}/sessions/${row.sessionId}`} className="inline-link">
                              {row.sessionId.slice(0, 8)}
                              <ExternalLink size={12} strokeWidth={2} aria-hidden />
                            </Link>
                          </td>
                          <td>{shortText(row.release)}</td>
                          <td>{shortText(row.environment)}</td>
                          <td>
                            <div className="error-row-actions">
                              <span>{formatTime(row.createdAt)}</span>
                              <Link to={`/websites/${websiteId}/errors/${row.id}`} className="inline-link">
                                {t('viewError')}
                                <ExternalLink size={12} strokeWidth={2} aria-hidden />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title={t('errorsEmptyTitle')} description={t('errorsEmptyBody')} />
              )}
            </section>
          </DataViewState>
        ) : null}

        {secondaryTab === 'source-maps' ? (
          <DataViewState
            loading={sourceMapsQuery.isLoading && !sourceMapsQuery.data}
            error={sourceMapsQuery.isError ? sourceMapsQuery.error : null}
            onRetry={() => sourceMapsQuery.refetch()}
          >
            <section className="panel">
              <header className="panel-header">
                <div>
                  <h3 className="section-title">{t('errorSourceMaps')}</h3>
                  <p className="text-muted">{t('errorSourceMapsLead')}</p>
                </div>
              </header>
              {canEdit ? (
                <div className="panel-form">
                  <div className="field">
                    <Label htmlFor="source-map-release">{t('errorSourceMapRelease')}</Label>
                    <Input
                      id="source-map-release"
                      value={sourceMapDraft.release}
                      onChange={(event) => setSourceMapDraft((prev) => ({ ...prev, release: event.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <Label htmlFor="source-map-file">{t('errorSourceMapFile')}</Label>
                    <Input
                      id="source-map-file"
                      value={sourceMapDraft.file}
                      placeholder="assets/app.js.map"
                      onChange={(event) => setSourceMapDraft((prev) => ({ ...prev, file: event.target.value }))}
                    />
                  </div>
                  <div className="field feature-flag-description-field">
                    <Label htmlFor="source-map-content">{t('errorSourceMapContent')}</Label>
                    <textarea
                      id="source-map-content"
                      className="textarea"
                      value={sourceMapDraft.content}
                      onChange={(event) => setSourceMapDraft((prev) => ({ ...prev, content: event.target.value }))}
                    />
                  </div>
                  <div className="form-actions">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={
                        !sourceMapDraft.release.trim() ||
                        !sourceMapDraft.file.trim() ||
                        !sourceMapDraft.content.trim() ||
                        uploadSourceMapMutation.isPending
                      }
                      onClick={() => uploadSourceMapMutation.mutate()}
                    >
                      {uploadSourceMapMutation.isPending ? t('saving') : t('errorSourceMapUpload')}
                    </Button>
                  </div>
                </div>
              ) : null}
              {sourceMaps.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('errorSourceMapRelease')}</th>
                        <th>{t('errorSourceMapFile')}</th>
                        <th>{t('created')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceMaps.map((item) => (
                        <tr key={item.id}>
                          <td>{item.release}</td>
                          <td className="mono">{item.file}</td>
                          <td className="text-muted">{formatTime(item.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title={t('noSourceMaps')} description={t('errorSourceMapsLead')} />
              )}
            </section>
          </DataViewState>
        ) : null}

        {secondaryTab === 'alerts' ? (
          <DataViewState
            loading={alertRulesQuery.isLoading && !alertRulesQuery.data}
            error={alertRulesQuery.isError ? alertRulesQuery.error : null}
            onRetry={() => alertRulesQuery.refetch()}
          >
            <section className="panel">
              <header className="panel-header">
                <div>
                  <h3 className="section-title">{t('errorAlertRules')}</h3>
                  <p className="text-muted">{t('errorAlertRulesLead')}</p>
                </div>
              </header>
              {canEdit ? (
                <div className="panel-form">
                  <div className="field">
                    <Label htmlFor="error-alert-name">{t('alertRuleName')}</Label>
                    <Input
                      id="error-alert-name"
                      value={alertDraft.name}
                      onChange={(event) => setAlertDraft((prev) => ({ ...prev, name: event.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <Label htmlFor="error-alert-threshold">{t('alertRuleThreshold')}</Label>
                    <Input
                      id="error-alert-threshold"
                      type="number"
                      min={1}
                      value={alertDraft.threshold}
                      onChange={(event) => setAlertDraft((prev) => ({ ...prev, threshold: Number(event.target.value) }))}
                    />
                  </div>
                  <div className="field">
                    <Label htmlFor="error-alert-window">{t('alertRuleWindow')}</Label>
                    <Input
                      id="error-alert-window"
                      type="number"
                      min={1}
                      value={alertDraft.windowMinutes}
                      onChange={(event) =>
                        setAlertDraft((prev) => ({ ...prev, windowMinutes: Number(event.target.value) }))
                      }
                    />
                  </div>
                  <div className="field">
                    <Label htmlFor="error-alert-severity">{t('errorAlertSeverity')}</Label>
                    <select
                      id="error-alert-severity"
                      className="select"
                      value={alertDraft.severity}
                      onChange={(event) => setAlertDraft((prev) => ({ ...prev, severity: event.target.value }))}
                    >
                      <option value="">{t('all')}</option>
                      <option value="fatal">fatal</option>
                      <option value="error">error</option>
                      <option value="warning">warning</option>
                      <option value="info">info</option>
                    </select>
                  </div>
                  <div className="field">
                    <Label htmlFor="error-alert-release">{t('release')}</Label>
                    <Input
                      id="error-alert-release"
                      value={alertDraft.release}
                      onChange={(event) => setAlertDraft((prev) => ({ ...prev, release: event.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <Label htmlFor="error-alert-environment">{t('environment')}</Label>
                    <Input
                      id="error-alert-environment"
                      value={alertDraft.environment}
                      onChange={(event) => setAlertDraft((prev) => ({ ...prev, environment: event.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <Label htmlFor="error-alert-channel">{t('alertRuleChannel')}</Label>
                    <select
                      id="error-alert-channel"
                      className="select"
                      value={alertDraft.channel}
                      onChange={(event) =>
                        setAlertDraft((prev) => ({
                          ...prev,
                          channel: event.target.value as ErrorAlertRule['channel'],
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
                      <Label htmlFor="error-alert-target">{t('alertRuleTarget')}</Label>
                      <Input
                        id="error-alert-target"
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
                        <th>{t('errorAlertSeverity')}</th>
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
                          <td>{rule.severity ?? '-'}</td>
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
                <EmptyState title={t('noErrorAlertRules')} description={t('errorAlertRulesLead')} />
              )}
            </section>
          </DataViewState>
        ) : null}
      </section>
    </div>
  );
}
