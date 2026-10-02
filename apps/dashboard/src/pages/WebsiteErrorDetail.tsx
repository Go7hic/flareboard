import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Bug } from 'lucide-react';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { ErrorStackTrace } from '../components/ErrorStackTrace';
import { KvList } from '../components/KvList';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { CopyButton } from '../components/quality/CopyButton';
import { errorSeverity, severityVar } from '../components/quality/ErrorOccurrencesChart';
import { RelativeTime } from '../components/quality/RelativeTime';
import { TableSkeleton } from '../components/quality/TableSkeleton';
import { api, ApiError, type ErrorEventDetail } from '../lib/api';
import { formatShortDateTime, shortId } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsiteRange } from '../lib/useWebsiteRange';

function display(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

/** Long or multi-line property values (stack, source URLs) read better in a block. */
function isLongValue(value: string | null) {
  return Boolean(value && (value.length > 90 || value.includes('\n')));
}

export default function WebsiteErrorDetailPage() {
  const { websiteId = '', eventId = '' } = useParams<{ websiteId: string; eventId: string }>();
  const { timezone } = useWebsiteRange(websiteId);

  const errorQuery = useQuery({
    queryKey: ['error-detail', websiteId, eventId],
    enabled: Boolean(websiteId && eventId),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
    queryFn: () => api<ErrorEventDetail>(`/api/websites/${websiteId}/errors/${eventId}`),
  });

  const error = errorQuery.data;
  const notFound = errorQuery.error instanceof ApiError && errorQuery.error.status === 404;
  const severity = errorSeverity(error?.severity);
  const issueHref = error ? `/websites/${websiteId}/errors/issues/${encodeURIComponent(error.fingerprint)}` : '';

  return (
    <Page className="q-page q-page--error">
      <PageHeader
        className="q-detail-header"
        backTo={`/websites/${websiteId}/errors`}
        backLabel={t('errors')}
        title={error ? display(error.message ?? error.eventName) : t('error')}
        meta={
          error ? (
            <div className="meta-line q-detail-meta">
              <span className="q-detail-sev">
                <span className="q-sev-dot" style={{ background: severityVar(severity) }} aria-hidden />
                {severity}
              </span>
              <span>{display(error.name ?? t('errorNameFallback'))}</span>
              <span title={formatShortDateTime(error.createdAt, { timeZone: timezone })}>
                <RelativeTime value={error.createdAt} timeZone={timezone} />
              </span>
              {error.handled ? <span>{error.handled === 'false' ? t('qualityUnhandled') : t('qualityHandled')}</span> : null}
            </div>
          ) : undefined
        }
        actions={
          error ? (
            <div className="q-header-actions">
              <Button asChild variant="outline" size="sm">
                <Link to={`/websites/${websiteId}/sessions/${error.sessionId}`}>{t('viewSession')}</Link>
              </Button>
              <Button asChild variant="primary" size="sm">
                <Link to={issueHref}>{t('errorIssueViewIssue')}</Link>
              </Button>
            </div>
          ) : null
        }
      />

      <PageBody className="stack">
        <DataViewState
          loading={errorQuery.isLoading}
          error={errorQuery.isError && !notFound ? errorQuery.error : null}
          onRetry={() => errorQuery.refetch()}
          loadingFallback={
            <div className="layout-grid">
              <SectionCard className="span-8" flush title={t('errorResolvedStack')}>
                <TableSkeleton rows={4} columns={2} />
              </SectionCard>
              <SectionCard className="span-4" title={t('qualityContext')}>
                <Skeleton className="h-40 w-full" />
              </SectionCard>
            </div>
          }
        >
          {!error ? (
            <EmptyState
              variant="rich"
              icon={<Bug />}
              title={t('errorDetailEmptyTitle')}
              description={t('errorDetailEmptyBody')}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to={`/websites/${websiteId}/errors`}>{t('errors')}</Link>
                </Button>
              }
            />
          ) : (
            <>
              <div className="layout-grid">
                <SectionCard className="span-8" flush title={t('errorResolvedStack')} description={t('errorResolvedStackLead')}>
                  {error.resolvedStack?.length ? (
                    <ErrorStackTrace frames={error.resolvedStack} />
                  ) : (
                    <EmptyState title={t('errorResolvedStackEmpty')} description={t('errorResolvedStackEmptyBody')} />
                  )}
                </SectionCard>

                <SectionCard className="span-4" title={t('qualityContext')}>
                  <KvList
                    compact
                    className="q-kv-narrow"
                    items={[
                      { key: 'page', label: t('page'), value: <span className="mono">{error.urlPath || '/'}</span> },
                      { key: 'release', label: t('release'), value: display(error.release) },
                      { key: 'environment', label: t('environment'), value: display(error.environment) },
                      { key: 'browser', label: t('browser'), value: display(error.browser) },
                      { key: 'os', label: t('os'), value: display(error.os) },
                      { key: 'device', label: t('device'), value: display(error.device) },
                      { key: 'country', label: t('country'), value: display(error.country) },
                      {
                        key: 'when',
                        label: t('when'),
                        value: formatShortDateTime(error.createdAt, { timeZone: timezone }),
                      },
                      {
                        key: 'session',
                        label: t('session'),
                        value: (
                          <Link to={`/websites/${websiteId}/sessions/${error.sessionId}`} className="q-id-link" title={error.sessionId}>
                            {shortId(error.sessionId, 12)}
                          </Link>
                        ),
                      },
                      {
                        key: 'event',
                        label: t('eventId'),
                        value: (
                          <span className="q-inline-copy">
                            <span className="mono">{shortId(error.id, 12)}</span>
                            <CopyButton value={error.id} iconOnly size="xs" />
                          </span>
                        ),
                      },
                    ]}
                  />
                </SectionCard>
              </div>

              <SectionCard title={t('properties')} description={t('errorDetailPropertiesLead')}>
                {error.properties.length ? (
                  <dl className="kv-list q-props">
                    {error.properties.map((property) => (
                      <PropertyRow key={property.key} name={property.key} value={property.value} />
                    ))}
                  </dl>
                ) : (
                  <EmptyState title={t('errorDetailNoProperties')} description={t('errorDetailNoPropertiesBody')} />
                )}
              </SectionCard>
            </>
          )}
        </DataViewState>
      </PageBody>
    </Page>
  );
}

function PropertyRow({ name, value }: { name: string; value: string | null }) {
  return (
    <>
      <dt className="mono">{name}</dt>
      <dd>{isLongValue(value) ? <pre className="q-prop-block">{value}</pre> : display(value)}</dd>
    </>
  );
}
