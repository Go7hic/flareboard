import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { DateRangePicker } from '../components/DateRangePicker';
import { EmptyState } from '../components/EmptyState';
import { ErrorIssueStatusBadge } from '../components/ErrorIssueStatusBadge';
import { ErrorIssueTrend } from '../components/ErrorIssueTrend';
import { ErrorStackTrace } from '../components/ErrorStackTrace';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { StatCard } from '../components/ui/stat-card';
import { Textarea } from '../components/ui/textarea';
import { api, ApiError, type ErrorIssueDetailResponse } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

function shortText(value: string | null | undefined, fallback = '-') {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

export default function WebsiteErrorIssuePage() {
  const { websiteId, fingerprint } = useParams<{ websiteId: string; fingerprint: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { canEdit } = useWebsitePermissions(websiteId, 'errors');
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '7d');
  const [comment, setComment] = useState('');

  const issueQuery = useQuery({
    queryKey: ['error-issue', websiteId, fingerprint, range],
    enabled: Boolean(websiteId && fingerprint),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
    queryFn: () =>
      api<ErrorIssueDetailResponse>(
        `/api/websites/${websiteId}/errors/issues/${encodeURIComponent(fingerprint ?? '')}?${rangeQs}`,
      ),
  });

  const mergedInto = issueQuery.data && 'mergedInto' in issueQuery.data ? issueQuery.data.mergedInto : null;
  useEffect(() => {
    if (mergedInto) navigate(`/websites/${websiteId}/errors/issues/${encodeURIComponent(mergedInto)}`, { replace: true });
  }, [mergedInto, navigate, websiteId]);

  const issue = issueQuery.data && 'issue' in issueQuery.data ? issueQuery.data.issue : null;
  const notFound = issueQuery.error instanceof ApiError && issueQuery.error.status === 404;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['error-issue', websiteId] });
    queryClient.invalidateQueries({ queryKey: ['errors', websiteId] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: 'open' | 'resolved' | 'ignored') =>
      api(`/api/websites/${websiteId}/errors/issues`, {
        method: 'PATCH',
        body: JSON.stringify({ fingerprint: issue?.fingerprint, status }),
      }),
    onSuccess: invalidate,
  });

  const commentMutation = useMutation({
    mutationFn: () =>
      api(`/api/websites/${websiteId}/errors/issues/comments`, {
        method: 'POST',
        body: JSON.stringify({ fingerprint: issue?.fingerprint, body: comment.trim() }),
      }),
    onSuccess: () => {
      setComment('');
      invalidate();
    },
  });

  const unmergeMutation = useMutation({
    mutationFn: (source: string) =>
      api(`/api/websites/${websiteId}/errors/issues/${encodeURIComponent(source)}/merge`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const latest = issue?.latestEvent ?? null;
  const groupedBy = latest?.grouping?.method;
  const frames = latest?.resolvedStack ?? [];

  return (
    <Page className="page-error-issue">
      <PageHeader
        title={t('issue')}
        backTo={websiteId ? `/websites/${websiteId}/errors` : undefined}
        backLabel={t('back')}
        actions={<DateRangePicker value={range} onChange={setRange} popover timezone={timezone} />}
      />

      <PageBody>
        <DataViewState
          loading={issueQuery.isLoading || Boolean(mergedInto)}
          error={issueQuery.isError && !notFound ? issueQuery.error : null}
          onRetry={() => issueQuery.refetch()}
          loadingFallback={<div className="skeleton section-gap" style={{ height: '14rem' }} />}
        >
          {notFound || (!issueQuery.isLoading && !issue && !mergedInto) ? (
            <EmptyState title={t('errorIssueNotFound')} description={t('errorIssueNotFoundBody')} />
          ) : null}

          {issue ? (
            <>
              <section className="panel panel-accent-rail section-gap">
                <div className="error-detail-title">
                  <AlertTriangle size={20} strokeWidth={2} aria-hidden />
                  <div className="error-issue-heading">
                    <h1 className="page-title">{shortText(issue.message, issue.fingerprint)}</h1>
                    <p className="text-muted">
                      {issue.name ?? t('errorNameFallback')} · <ErrorIssueStatusBadge status={issue.status} />
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="error-issue-actions">
                      {(['open', 'resolved', 'ignored'] as const).map((status) => (
                        <Button
                          key={status}
                          type="button"
                          size="sm"
                          variant={status === issue.status ? 'default' : 'outline'}
                          aria-pressed={status === issue.status}
                          disabled={statusMutation.isPending}
                          onClick={() => statusMutation.mutate(status)}
                        >
                          {t(`errorIssueAction_${status}`)}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {issue.note ? <p className="workflow-action-note">{issue.note}</p> : null}
                <p className="text-muted error-issue-grouping">
                  {groupedBy ? t(`errorIssueGroupedBy_${groupedBy}`) : null}{' '}
                  <span className="mono">
                    {t('errorIssueFingerprint')}: {issue.fingerprint}
                  </span>
                </p>
                {latest?.grouping?.frames.length ? (
                  <ul className="error-issue-grouping-frames mono text-muted">
                    {latest.grouping.frames.map((frame, index) => (
                      <li key={index}>
                        {frame.function} · {frame.file}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              <section className="analytics-hero-stats section-gap">
                <StatCard label={t('events')} value={formatNumber(issue.events)} />
                <StatCard label={t('errorsAffectedUsers')} value={formatNumber(issue.users)} />
                <StatCard label={t('errorsAffectedSessions')} value={formatNumber(issue.sessions)} />
                <StatCard label={t('firstSeen')} value={formatDateTime(issue.firstSeenAt)} />
                <StatCard
                  label={t('lastSeen')}
                  value={formatDateTime(issue.lastSeenAt)}
                  hint={issue.resolvedAt ? `${t('errorIssueResolvedAt')}: ${formatDateTime(issue.resolvedAt)}` : undefined}
                />
              </section>

              <section className="panel section-gap">
                <header className="compact-panel-header">
                  <h2 className="section-title">{t('trend')}</h2>
                  <p className="text-muted">{t('errorIssueTrend')}</p>
                </header>
                <div className="error-issue-trend-large">
                  <ErrorIssueTrend values={issue.trend} label={t('errorIssueTrend')} width={600} height={64} />
                </div>
              </section>

              <section className="section-gap">
                <header className="panel-header">
                  <div>
                    <h2 className="section-title">{t('errorIssueStack')}</h2>
                    <p className="text-muted">{t('errorIssueStackLead')}</p>
                  </div>
                  {latest ? (
                    <Link to={`/websites/${websiteId}/errors/${latest.id}`} className="inline-link">
                      {t('viewError')}
                      <ExternalLink size={12} strokeWidth={2} aria-hidden />
                    </Link>
                  ) : null}
                </header>
                {frames.length ? (
                  <ErrorStackTrace frames={frames} />
                ) : (
                  <EmptyState title={t('errorResolvedStackEmpty')} description={t('errorResolvedStackEmptyBody')} />
                )}
              </section>

              <section className="section-gap">
                <header className="panel-header">
                  <div>
                    <h2 className="section-title">{t('errorIssueRecentEvents')}</h2>
                  </div>
                </header>
                {issue.samples.length ? (
                  <div className="table-scroll">
                    <table className="data-table errors-table">
                      <thead>
                        <tr>
                          <th>{t('when')}</th>
                          <th>{t('page')}</th>
                          <th>{t('release')}</th>
                          <th>{t('browser')}</th>
                          <th>{t('session')}</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {issue.samples.map((sample) => (
                          <tr key={sample.id}>
                            <td>{formatDateTime(sample.createdAt)}</td>
                            <td className="mono">{sample.urlPath || '/'}</td>
                            <td>{shortText(sample.release)}</td>
                            <td>{shortText(sample.browser)}</td>
                            <td>
                              <Link to={`/websites/${websiteId}/sessions/${sample.sessionId}`} className="inline-link">
                                {sample.sessionId.slice(0, 8)}
                                <ExternalLink size={12} strokeWidth={2} aria-hidden />
                              </Link>
                            </td>
                            <td>
                              <Link to={`/websites/${websiteId}/errors/${sample.id}`} className="inline-link">
                                {t('viewError')}
                              </Link>
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

              <section className="section-gap">
                <header className="panel-header">
                  <div>
                    <h2 className="section-title">{t('errorIssueMerged')}</h2>
                    <p className="text-muted">{t('errorIssueMergedLead')}</p>
                  </div>
                </header>
                {issue.mergedIssues.length ? (
                  <div className="table-scroll">
                    <table className="data-table errors-table">
                      <thead>
                        <tr>
                          <th>{t('issue')}</th>
                          <th>{t('events')}</th>
                          <th>{t('lastSeen')}</th>
                          <th>{t('created')}</th>
                          <th className="cohorts-actions-col">{t('actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {issue.mergedIssues.map((merged) => (
                          <tr key={merged.fingerprint}>
                            <td>
                              <div className="errors-message">{shortText(merged.message, merged.fingerprint)}</div>
                              <div className="text-muted">
                                {merged.name ?? t('errorNameFallback')} · <span className="mono">{merged.fingerprint}</span>
                              </div>
                            </td>
                            <td>{formatNumber(merged.events)}</td>
                            <td>{formatDateTime(merged.lastSeenAt)}</td>
                            <td>{formatDateTime(merged.mergedAt)}</td>
                            <td className="cohorts-actions-col">
                              {canEdit ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={unmergeMutation.isPending}
                                  onClick={() =>
                                    confirm({
                                      title: t('errorIssueUnmergeTitle'),
                                      description: t('errorIssueUnmergeBody'),
                                      confirmLabel: t('errorIssueUnmerge'),
                                      onConfirm: () => unmergeMutation.mutate(merged.fingerprint),
                                    })
                                  }
                                >
                                  {t('errorIssueUnmerge')}
                                </Button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-muted">{t('errorIssueMergedEmpty')}</p>
                )}
              </section>

              <section className="section-gap">
                <header className="panel-header">
                  <div>
                    <h2 className="section-title">{t('errorIssueRegressions')}</h2>
                    <p className="text-muted">{t('errorIssueRegressionsLead')}</p>
                  </div>
                </header>
                {issue.regressions.length ? (
                  <div className="table-scroll">
                    <table className="data-table errors-table">
                      <thead>
                        <tr>
                          <th>{t('errorIssueOccurredAt')}</th>
                          <th>{t('errorIssueResolvedAt')}</th>
                          <th>{t('release')}</th>
                          <th>{t('environment')}</th>
                          <th>{t('status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {issue.regressions.map((regression) => (
                          <tr key={regression.id}>
                            <td>
                              {regression.eventId ? (
                                <Link to={`/websites/${websiteId}/errors/${regression.eventId}`} className="inline-link">
                                  {formatDateTime(regression.occurredAt)}
                                </Link>
                              ) : (
                                formatDateTime(regression.occurredAt)
                              )}
                            </td>
                            <td>{formatDateTime(regression.resolvedAt)}</td>
                            <td>{shortText(regression.release)}</td>
                            <td>{shortText(regression.environment)}</td>
                            <td className="text-muted">
                              {regression.notifiedAt ? t('errorIssueAlertSent') : t('errorIssueNoAlert')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-muted">{t('errorIssueRegressionsEmpty')}</p>
                )}
              </section>

              <section className="section-gap">
                <header className="panel-header">
                  <div>
                    <h2 className="section-title">{t('errorIssueComments')}</h2>
                  </div>
                </header>
                {issue.comments.length ? (
                  <ul className="error-issue-comments">
                    {issue.comments.map((item) => (
                      <li key={item.id}>
                        <p>{item.body}</p>
                        <span className="text-muted">{formatDateTime(item.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">{t('errorIssueCommentsEmpty')}</p>
                )}
                {canEdit ? (
                  <form
                    className="error-issue-comment-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (comment.trim()) commentMutation.mutate();
                    }}
                  >
                    <Textarea
                      value={comment}
                      maxLength={2000}
                      placeholder={t('errorIssueCommentPlaceholder')}
                      aria-label={t('errorIssueCommentPlaceholder')}
                      onChange={(event) => setComment(event.target.value)}
                    />
                    <div className="form-actions">
                      <Button type="submit" variant="primary" disabled={!comment.trim() || commentMutation.isPending}>
                        {commentMutation.isPending ? t('saving') : t('errorIssueCommentAdd')}
                      </Button>
                    </div>
                  </form>
                ) : null}
              </section>
            </>
          ) : null}
        </DataViewState>
      </PageBody>
    </Page>
  );
}
