import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  useMasterDetailSelection,
} from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
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
  if (!metadata || !Object.keys(metadata).length) return null;
  return JSON.stringify(metadata, null, 2);
}

export default function WebsiteAuditLogPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const auditQuery = useQuery({
    queryKey: ['website-audit-log', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<AuditLogResponse>(`/api/websites/${websiteId}/audit?page=1&pageSize=50`),
  });

  const items = auditQuery.data?.items ?? [];
  const { selectedId, setSelectedId, selectedItem: selectedEntry } = useMasterDetailSelection(
    items,
    (entry) => entry.id,
  );

  useEffect(() => {
    if (!items.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((entry) => entry.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId, setSelectedId]);

  return (
    <Page className="page-audit-log">
      <PageHeader title={t('auditLog')} lead={t('websiteAuditLogLead')} />

      <PageBody>

      <section className="panel section-gap">
        {auditQuery.isLoading ? <div className="skeleton skeleton-block" aria-busy /> : null}

        {!auditQuery.isLoading && items.length ? (
          <MasterDetailLayout
            list={items.map((entry) => (
              <MasterDetailListItem
                key={entry.id}
                selected={entry.id === selectedId}
                onSelect={() => setSelectedId(entry.id)}
                icon={<ClipboardList size={16} strokeWidth={2} aria-hidden />}
                title={entry.action}
                subtitle={`${entry.username} · ${entry.entityType}`}
                meta={<span className="text-muted">{formatDate(entry.createdAt)}</span>}
              />
            ))}
            detail={
              selectedEntry ? (
                <MasterDetailPane
                  title={selectedEntry.action}
                  description={
                    <>
                      <p className="text-muted">
                        {t('operator')}: {selectedEntry.username}
                      </p>
                      <p className="text-muted">
                        {t('entity')}: {selectedEntry.entityType}
                        {selectedEntry.entityId ? ` · ${selectedEntry.entityId}` : ''}
                      </p>
                      <p className="text-muted">
                        {t('when')}: {formatDate(selectedEntry.createdAt)}
                      </p>
                    </>
                  }
                >
                  <div className="detail-section">
                    <h4 className="section-title experiment-title">{t('metadata')}</h4>
                    {formatMetadata(selectedEntry.metadata) ? (
                      <pre className="mono text-muted segment-parameters-preview">
                        {formatMetadata(selectedEntry.metadata)}
                      </pre>
                    ) : (
                      <p className="text-muted">—</p>
                    )}
                  </div>
                </MasterDetailPane>
              ) : null
            }
          />
        ) : null}

        {!auditQuery.isLoading && !items.length ? (
          <EmptyState title={t('auditLogEmptyTitle')} description={t('auditLogEmptyBody')} />
        ) : null}
      </section>
      </PageBody>
    </Page>
  );
}
