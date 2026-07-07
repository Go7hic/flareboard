import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { api } from '../lib/api';
import { t } from '../lib/i18n';

type AuditLogEntry = {
  id: string;
  userId: string;
  username: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | number | null;
};

type AuditLogResponse = {
  items: AuditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
};

function formatDate(value: string | number | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata || !Object.keys(metadata).length) return '-';
  return JSON.stringify(metadata);
}

export default function WebsiteAuditLogPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const auditQuery = useQuery({
    queryKey: ['website-audit-log', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<AuditLogResponse>(`/api/websites/${websiteId}/audit?page=1&pageSize=50`),
  });

  const items = auditQuery.data?.items ?? [];

  return (
    <div className="page page-audit-log">
      <WebsitePageShell websiteId={websiteId} />

      <section className="panel section-gap">
        <header className="panel-header">
          <div>
            <h2 className="section-title">{t('auditLog')}</h2>
            <p className="text-muted">{t('websiteAuditLogLead')}</p>
          </div>
        </header>

        {auditQuery.isLoading ? <div className="skeleton skeleton-block" aria-busy /> : null}

        {!auditQuery.isLoading && items.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('action')}</th>
                  <th>{t('operator')}</th>
                  <th>{t('entity')}</th>
                  <th>{t('metadata')}</th>
                  <th>{t('when')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.action}</td>
                    <td>{entry.username}</td>
                    <td>{entry.entityType}</td>
                    <td>
                      <code>{formatMetadata(entry.metadata)}</code>
                    </td>
                    <td>{formatDate(entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {!auditQuery.isLoading && !items.length ? (
          <EmptyState title={t('auditLogEmptyTitle')} description={t('auditLogEmptyBody')} />
        ) : null}
      </section>
    </div>
  );
}
