import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart } from 'recharts';
import { Bug, ExternalLink } from 'lucide-react';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { DateRangePicker } from '../components/DateRangePicker';
import { EmptyState } from '../components/EmptyState';
import { ErrorIssueStatusBadge } from '../components/ErrorIssueStatusBadge';
import { ErrorStackTrace } from '../components/ErrorStackTrace';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { KvList } from '../components/KvList';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Textarea } from '../components/ui/textarea';
import { bucketRangeLabel, bucketTickLabel, bucketTicks } from '../components/quality/chartParts';
import { CopyButton } from '../components/quality/CopyButton';
import { errorSeverity, severityVar } from '../components/quality/ErrorOccurrencesChart';
import { RelativeTime } from '../components/quality/RelativeTime';
import { useMediaQuery } from '../components/quality/useMediaQuery';
import { TableSkeleton } from '../components/quality/TableSkeleton';
import { api, ApiError, type ErrorIssueDetail, type ErrorIssueDetailResponse } from '../lib/api';
import { getSeverityColors } from '../lib/chart-colors';
import { BAR_MARK } from '../lib/chartMarks';
import { formatNumber, formatShortDate, shortId } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

function shortText(value: string | null | undefined, fallback = '-', max = 160) {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const SEVERITY_TOKEN = { fatal: 'fatal', error: 'error', warning: 'warn', info: 'info' } as const;

export default function WebsiteErrorIssuePage() {
  const { websiteId = '', fingerprint = '' } = useParams<{ websiteId: string; fingerprint: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { canEdit } = useWebsitePermissions(websiteId, 'errors');
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '7d');
  const [comment, setComment] = useState('');

  const issueQuery = useQuery({
    queryKey: ['error-issue', websiteId, fingerprint, range],
    enabled: Boolean(websiteId && fingerprint),
    placeholderData: keepPreviousData,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
    queryFn: () =>
      api<ErrorIssueDetailResponse>(
        `/api/websites/${websiteId}/errors/issues/${encodeURIComponent(fingerprint)}?${rangeQs}`,
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

  const errorsHref = `/websites/${websiteId}/errors`;
  const latest = issue?.latestEvent ?? null;
  const severity = errorSeverity(issue?.severity);

  const statusActions = issue && canEdit ? (
    <>
      {issue.status === 'resolved' || issue.status === 'ignored' ? (
        <Button type="button" size="sm" variant="outline" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate('open')}>
          {t('errorIssueAction_open')}
        </Button>
      ) : null}
      {issue.status !== 'ignored' ? (
        <Button type="button" size="sm" variant="outline" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate('ignored')}>
          {t('errorIssueAction_ignored')}
        </Button>
      ) : null}
      {issue.status !== 'resolved' ? (
        <Button type="button" size="sm" variant="primary" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate('resolved')}>
          {t('errorIssueAction_resolved')}
        </Button>
      ) : null}
    </>
  ) : null;

  return (
    <Page className="q-page q-page--issue">
      <PageHeader
        className="q-detail-header"
        backTo={errorsHref}
        backLabel={t('errors')}
        title={issue ? shortText(issue.message, issue.fingerprint) : t('issue')}
        meta={
          issue ? (
            <div className="meta-line q-detail-meta">
              <ErrorIssueStatusBadge status={issue.status} />
              <span className="q-detail-sev">
                <span className="q-sev-dot" style={{ background: severityVar(severity) }} aria-hidden />
                {severity}
              </span>
              <span>{issue.name ?? t('errorNameFallback')}</span>
              {issue.firstSeenAt ? (
                <span>
                  {t('firstSeen')} {formatShortDate(issue.firstSeenAt, { timeZone: timezone })}
                </span>
              ) : null}
            </div>
          ) : undefined
        }
        actions={
          <div className="q-header-actions">
            {statusActions}
            <DateRangePicker value={range} onChange={setRange} popover timezone={timezone} />
          </div>
        }
      />

      <PageBody className="stack">
        <DataViewState
          loading={(issueQuery.isLoading && !issueQuery.data) || Boolean(mergedInto)}
          error={issueQuery.isError && !notFound && !issue ? issueQuery.error : null}
          onRetry={() => issueQuery.refetch()}
          loadingFallback={
            <div className="stack">
              <KpiStripSkeleton cells={4} />
              <SectionCard title={t('qualityOccurrences')}>
                <Skeleton className="h-[180px] w-full" />
              </SectionCard>
              <SectionCard flush title={t('errorIssueStack')}>
                <TableSkeleton rows={4} columns={2} />
              </SectionCard>
            </div>
          }
        >
          {notFound || (!issueQuery.isLoading && !issue && !mergedInto) ? (
            <EmptyState
              variant="rich"
              icon={<Bug />}
              title={t('errorIssueNotFound')}
              description={t('errorIssueNotFoundBody')}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to={errorsHref}>{t('errors')}</Link>
                </Button>
              }
            />
          ) : null}

          {issue ? (
            <>
              {issue.note ? <p className="q-issue-note">{issue.note}</p> : null}

              <KpiStrip columns={4}>
                <KpiCell
                  label={t('qualityOccurrences')}
                  value={formatNumber(issue.events)}
                  hint={
                    issue.lastSeenAt ? (
                      <>
                        {t('qualityLastSeenHint')} <RelativeTime value={issue.lastSeenAt} />
                      </>
                    ) : undefined
                  }
                />
                <KpiCell
                  label={t('errorsAffectedSessions')}
                  value={formatNumber(issue.sessions)}
                  hint={t('qualityUsersCount').replace('{count}', formatNumber(issue.users))}
                />
                <KpiCell
                  label={t('errorsAffectedUsers')}
                  value={formatNumber(issue.users)}
                  hint={
                    issue.firstSeenAt
                      ? `${t('firstSeen')} ${formatShortDate(issue.firstSeenAt, { timeZone: timezone })}`
                      : undefined
                  }
                />
                <KpiCell
                  label={t('errorIssueRegressions')}
                  value={formatNumber(issue.regressions.length)}
                  hint={
                    issue.resolvedAt
                      ? `${t('errorIssueResolvedAt')} ${formatShortDate(issue.resolvedAt, { timeZone: timezone })}`
                      : undefined
                  }
                />
              </KpiStrip>

              <IssueTrendCard issue={issue} severity={severity} timezone={timezone} />

              <div className="layout-grid">
                <SectionCard
                  className="span-8"
                  flush
                  title={t('errorIssueStack')}
                  description={t('errorIssueStackLead')}
                  actions={
                    latest ? (
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/websites/${websiteId}/errors/${latest.id}`}>{t('viewError')}</Link>
                      </Button>
                    ) : null
                  }
                >
                  {latest?.resolvedStack?.length ? (
                    <ErrorStackTrace frames={latest.resolvedStack} />
                  ) : (
                    <EmptyState title={t('errorResolvedStackEmpty')} description={t('errorResolvedStackEmptyBody')} />
                  )}
                </SectionCard>

                <div className="span-4 stack">
                  <IssueDetailsCard issue={issue} websiteId={websiteId} />
                  <SectionCard title={t('errorIssueComments')}>
                    {issue.comments.length ? (
                      <ul className="q-comments">
                        {issue.comments.map((item) => (
                          <li key={item.id}>
                            <p>{item.body}</p>
                            <RelativeTime value={item.createdAt} className="q-comment-time" />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="q-muted-line">{t('errorIssueCommentsEmpty')}</p>
                    )}
                    {canEdit ? (
                      <form
                        className="q-comment-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (comment.trim()) commentMutation.mutate();
                        }}
                      >
                        <Textarea
                          value={comment}
                          maxLength={2000}
                          rows={3}
                          placeholder={t('errorIssueCommentPlaceholder')}
                          aria-label={t('errorIssueCommentPlaceholder')}
                          onChange={(event) => setComment(event.target.value)}
                        />
                        <div className="q-comment-actions">
                          <Button type="submit" size="sm" variant="primary" disabled={!comment.trim() || commentMutation.isPending}>
                            {commentMutation.isPending ? t('saving') : t('errorIssueCommentAdd')}
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </SectionCard>
                </div>
              </div>

              <SectionCard flush title={t('errorIssueRecentEvents')}>
                {issue.samples.length ? (
                  <div className="table-scroll">
                    <table className="data-table data-table--interactive">
                      <thead>
                        <tr>
                          <th>{t('when')}</th>
                          <th>{t('page')}</th>
                          <th>{t('release')}</th>
                          <th>{t('browser')}</th>
                          <th>{t('session')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {issue.samples.map((sample) => (
                          <tr key={sample.id} onClick={() => navigate(`/websites/${websiteId}/errors/${sample.id}`)}>
                            <td className="q-col-when">
                              <Link
                                to={`/websites/${websiteId}/errors/${sample.id}`}
                                className="q-row-link"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <RelativeTime value={sample.createdAt} />
                              </Link>
                            </td>
                            <td className="mono q-col-path" title={sample.urlPath || '/'}>
                              {sample.urlPath || '/'}
                            </td>
                            <td className="q-col-muted">{sample.release ?? '-'}</td>
                            <td className="q-col-muted">
                              {[sample.browser, sample.os].filter(Boolean).join(' · ') || '-'}
                            </td>
                            <td>
                              <Link
                                to={`/websites/${websiteId}/sessions/${sample.sessionId}`}
                                className="q-id-link"
                                title={sample.sessionId}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {shortId(sample.sessionId)}
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
              </SectionCard>

              {issue.mergedIssues.length ? (
                <SectionCard flush title={t('errorIssueMerged')} description={t('errorIssueMergedLead')}>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('issue')}</th>
                          <th className="num">{t('qualityOccurrences')}</th>
                          <th>{t('lastSeen')}</th>
                          <th>{t('qualityMergedAt')}</th>
                          {canEdit ? (
                            <th className="q-col-actions">
                              <span className="sr-only">{t('actions')}</span>
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {issue.mergedIssues.map((merged) => (
                          <tr key={merged.fingerprint}>
                            <td>
                              <div className="q-issue-copy">
                                <span className="q-issue-title">{shortText(merged.message, merged.fingerprint, 120)}</span>
                                <span className="q-issue-meta">
                                  <span>{merged.name ?? t('errorNameFallback')}</span>
                                  <span className="mono">{shortId(merged.fingerprint, 12)}</span>
                                </span>
                              </div>
                            </td>
                            <td className="num">{formatNumber(merged.events)}</td>
                            <td className="q-col-when">
                              <RelativeTime value={merged.lastSeenAt} />
                            </td>
                            <td className="q-col-when">
                              <RelativeTime value={merged.mergedAt} />
                            </td>
                            {canEdit ? (
                              <td className="q-col-actions">
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
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              ) : null}

              {issue.regressions.length ? (
                <SectionCard flush title={t('errorIssueRegressions')} description={t('errorIssueRegressionsLead')}>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('errorIssueOccurredAt')}</th>
                          <th>{t('errorIssueResolvedAt')}</th>
                          <th>{t('release')}</th>
                          <th>{t('environment')}</th>
                          <th>{t('qualityAlert')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {issue.regressions.map((regression) => (
                          <tr key={regression.id}>
                            <td>
                              {regression.eventId ? (
                                <Link to={`/websites/${websiteId}/errors/${regression.eventId}`} className="q-row-link">
                                  <RelativeTime value={regression.occurredAt} short timeZone={timezone} />
                                </Link>
                              ) : (
                                <RelativeTime value={regression.occurredAt} short timeZone={timezone} />
                              )}
                            </td>
                            <td className="q-col-when">
                              <RelativeTime value={regression.resolvedAt} short timeZone={timezone} />
                            </td>
                            <td className="q-col-muted">{regression.release ?? '-'}</td>
                            <td className="q-col-muted">{regression.environment ?? '-'}</td>
                            <td className="q-col-muted">
                              {regression.notifiedAt ? t('errorIssueAlertSent') : t('errorIssueNoAlert')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              ) : null}
            </>
          ) : null}
        </DataViewState>
      </PageBody>
    </Page>
  );
}

/** Occurrences across the range in equal slices (the API's detail trend), one bar per slice. */
function IssueTrendCard({
  issue,
  severity,
  timezone,
}: {
  issue: ErrorIssueDetail;
  severity: ReturnType<typeof errorSeverity>;
  timezone: string;
}) {
  const chartColors = useChartColors();
  const narrow = useMediaQuery('(max-width: 640px)');
  const color = useMemo(() => getSeverityColors()[SEVERITY_TOKEN[severity]], [chartColors, severity]);
  const rows = useMemo(() => {
    const slices = issue.trend.length || 1;
    const span = Math.max(1, issue.trendEndAt - issue.trendStartAt);
    const step = span / slices;
    let previous = '';
    return issue.trend.map((count, i) => {
      const start = issue.trendStartAt + i * step;
      const label = bucketTickLabel(start, span, timezone);
      const tick = label === previous ? '' : label;
      previous = label;
      return { i, count, tick, title: bucketRangeLabel(start, start + step, timezone) };
    });
  }, [issue.trend, issue.trendEndAt, issue.trendStartAt, timezone]);

  return (
    <SectionCard title={t('qualityOccurrences')} description={t('errorIssueTrend')}>
      <div className="q-chart">
        <AnalyticsChart
          Chart={BarChart}
          data={rows}
          responsive={{ height: 180 }}
          xAxis={{
            dataKey: 'i',
            ticks: bucketTicks(rows, narrow ? 4 : 8),
            interval: 0,
            tickFormatter: (index: number) => rows[index]?.tick ?? '',
          }}
          yAxis={{ width: 36 }}
          tooltip={{
            labelFormatter: (_: unknown, payload: readonly { payload?: Record<string, unknown> }[]) =>
              String(payload[0]?.payload?.title ?? ''),
          }}
        >
          <Bar dataKey="count" name={t('qualityOccurrences')} fill={color} {...BAR_MARK} />
        </AnalyticsChart>
      </div>
    </SectionCard>
  );
}

/** Context of the latest occurrence and how the issue is grouped. */
function IssueDetailsCard({ issue, websiteId }: { issue: ErrorIssueDetail; websiteId: string }) {
  const latest = issue.latestEvent;
  const grouping = latest?.grouping;
  const items = [
    { key: 'release', label: t('release'), value: latest?.release ?? '-' },
    { key: 'environment', label: t('environment'), value: latest?.environment ?? '-' },
    { key: 'page', label: t('page'), value: <span className="mono">{latest?.urlPath || '/'}</span> },
    {
      key: 'browser',
      label: t('browser'),
      value: [latest?.browser, latest?.os, latest?.device].filter(Boolean).join(' · ') || '-',
    },
    { key: 'country', label: t('country'), value: latest?.country ?? '-' },
    {
      key: 'fingerprint',
      label: t('errorIssueFingerprint'),
      value: (
        <span className="q-inline-copy">
          <span className="mono">{shortId(issue.fingerprint, 16)}</span>
          <CopyButton value={issue.fingerprint} iconOnly size="xs" />
        </span>
      ),
    },
  ];
  return (
    <SectionCard
      title={t('qualityLatestOccurrence')}
      actions={
        latest ? (
          <Link to={`/websites/${websiteId}/sessions/${latest.sessionId}`} className="card-footer-link">
            {t('viewSession')}
            <ExternalLink aria-hidden />
          </Link>
        ) : null
      }
    >
      <KvList compact className="q-kv-narrow" items={items} />
      {grouping ? (
        <div className="q-grouping">
          <p className="q-grouping-lead">{t(`errorIssueGroupedBy_${grouping.method}`)}</p>
          {grouping.frames.length ? (
            <ul className="q-grouping-frames">
              {grouping.frames.map((frame, index) => (
                <li key={index}>
                  <span className="q-stack-fn">{frame.function}</span> <span className="q-stack-loc">{frame.file}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}
