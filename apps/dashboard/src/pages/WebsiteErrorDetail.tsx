import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { api, type ErrorEventDetail } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';

function display(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function DetailItem({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{display(value)}</dd>
    </div>
  );
}

export default function WebsiteErrorDetailPage() {
  const { websiteId, eventId } = useParams<{ websiteId: string; eventId: string }>();

  const errorQuery = useQuery({
    queryKey: ['error-detail', websiteId, eventId],
    enabled: Boolean(websiteId && eventId),
    queryFn: () => api<ErrorEventDetail>(`/api/websites/${websiteId}/errors/${eventId}`),
  });

  const error = errorQuery.data;

  return (
    <Page className="page-error-detail">
      <PageHeader
        title={t('error')}
        backTo={websiteId ? `/websites/${websiteId}/errors` : undefined}
        backLabel={t('back')}
      />

      <PageBody>
      {errorQuery.isLoading ? <div className="skeleton section-gap" style={{ height: '14rem' }} /> : null}

      {!errorQuery.isLoading && !error ? (
        <EmptyState title={t('errorDetailEmptyTitle')} description={t('errorDetailEmptyBody')} />
      ) : null}

      {error ? (
        <>
          <section className="panel panel-accent-rail section-gap">
            <div className="error-detail-title">
              <AlertTriangle size={20} strokeWidth={2} aria-hidden />
              <div>
                <h1 className="page-title">{display(error.message ?? error.eventName)}</h1>
                <p className="text-muted">{display(error.name ?? t('errorNameFallback'))}</p>
              </div>
            </div>

            <dl className="kv-grid error-detail-grid">
              <DetailItem label={t('severity')} value={error.severity ?? 'error'} />
              <DetailItem label={t('page')} value={error.urlPath || '/'} />
              <DetailItem label={t('release')} value={error.release} />
              <DetailItem label={t('environment')} value={error.environment} />
              <DetailItem label={t('browser')} value={error.browser} />
              <DetailItem label={t('os')} value={error.os} />
              <DetailItem label={t('device')} value={error.device} />
              <DetailItem label={t('country')} value={error.country} />
              <DetailItem label={t('when')} value={formatDateTime(error.createdAt)} />
              <DetailItem label={t('eventId')} value={error.id} />
            </dl>

            <div className="error-detail-actions">
              <Link to={`/websites/${websiteId}/sessions/${error.sessionId}`} className="inline-link">
                {t('viewSession')}
                <ExternalLink size={12} strokeWidth={2} aria-hidden />
              </Link>
            </div>
          </section>

          <section className="panel section-gap">
            <header className="panel-header">
              <div>
                <h2 className="section-title">{t('properties')}</h2>
                <p className="text-muted">{t('errorDetailPropertiesLead')}</p>
              </div>
            </header>

            {error.properties.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('key')}</th>
                      <th>{t('value')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {error.properties.map((property) => (
                      <tr key={property.key}>
                        <td className="mono">{property.key}</td>
                        <td>{display(property.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title={t('errorDetailNoProperties')} description={t('errorDetailNoPropertiesBody')} />
            )}
          </section>

          <section className="panel section-gap">
            <header className="panel-header">
              <div>
                <h2 className="section-title">{t('errorResolvedStack')}</h2>
                <p className="text-muted">{t('errorResolvedStackLead')}</p>
              </div>
            </header>

            {error.resolvedStack?.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('stackFunction')}</th>
                      <th>{t('stackFile')}</th>
                      <th>{t('stackLine')}</th>
                      <th>{t('source')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {error.resolvedStack.map((frame) => (
                      <tr key={`${frame.file}:${frame.line}:${frame.column}`}>
                        <td className="mono">{display(frame.functionName)}</td>
                        <td className="mono">{display(frame.file)}</td>
                        <td className="mono">
                          {frame.line}:{frame.column}
                        </td>
                        <td className="mono">
                          {frame.resolved && frame.source
                            ? `${frame.source}:${frame.sourceLine ?? '?'}:${frame.sourceColumn ?? '?'}`
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title={t('errorResolvedStackEmpty')}
                description={t('errorResolvedStackEmptyBody')}
              />
            )}
          </section>
        </>
      ) : null}
      </PageBody>
    </Page>
  );
}
