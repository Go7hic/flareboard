import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ClipboardList, X } from 'lucide-react';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KvList } from '../components/KvList';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { Button } from '../components/ui/button';
import { CodeBlock } from '../components/quality/CodeBlock';
import { CopyButton } from '../components/quality/CopyButton';
import { RelativeTime } from '../components/quality/RelativeTime';
import { SideSheet } from '../components/quality/SideSheet';
import { TableSkeleton } from '../components/quality/TableSkeleton';
import { useMediaQuery } from '../components/quality/useMediaQuery';
import { api, type AuditLogEntry, type AuditLogPage } from '../lib/api';
import { auditActionLabel, auditDetail } from '../lib/audit-labels';
import { formatDateTime, formatNumber, shortId } from '../lib/format';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';

const PAGE_SIZE = 50;
const INLINE_DETAIL_QUERY = '(min-width: 1280px)';

function formatMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata || !Object.keys(metadata).length) return null;
  return JSON.stringify(metadata, null, 2);
}

function EntryDetail({ entry }: { entry: AuditLogEntry }) {
  const metadata = formatMetadata(entry.metadata);
  return (
    <div className="q-log-detail">
      <KvList
        compact
        className="q-kv-narrow"
        items={[
          { key: 'action', label: t('action'), value: auditActionLabel(entry) },
          {
            key: 'raw',
            label: t('qualityEventCode'),
            value: (
              <span className="mono">
                {entry.entityType}.{entry.action}
              </span>
            ),
          },
          { key: 'operator', label: t('operator'), value: entry.username ?? t('unknown') },
          {
            key: 'entity',
            label: t('entity'),
            value: entry.entityId ? (
              <span className="q-inline-copy">
                <span className="mono">
                  {entry.entityType} · {shortId(entry.entityId, 12)}
                </span>
                <CopyButton value={entry.entityId} iconOnly size="xs" />
              </span>
            ) : (
              entry.entityType
            ),
          },
          { key: 'when', label: t('when'), value: formatDateTime(entry.createdAt) },
        ]}
      />
      <section className="q-detail-section">
        <h4 className="q-detail-section-title">{t('metadata')}</h4>
        {metadata ? <CodeBlock code={metadata} maxHeight="24rem" /> : <p className="q-muted-line">{t('qualityNoDetails')}</p>}
      </section>
    </div>
  );
}

export default function WebsiteAuditLogPage() {
  const { websiteId = '' } = useParams<{ websiteId: string }>();
  const inlineDetail = useMediaQuery(INLINE_DETAIL_QUERY);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const auditQuery = useQuery({
    queryKey: ['website-audit-log', websiteId, page],
    enabled: Boolean(websiteId),
    placeholderData: keepPreviousData,
    queryFn: () => api<AuditLogPage>(`/api/websites/${websiteId}/audit?page=${page}&pageSize=${PAGE_SIZE}`),
  });

  const items = auditQuery.data?.items ?? [];
  const total = auditQuery.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selected = items.find((entry) => entry.id === selectedId) ?? null;

  // Wide screens open the newest entry of each loaded page in the side pane (once, so closing
  // the pane sticks); phones wait for a tap since the detail is a sheet there.
  const dataPage = auditQuery.data?.page;
  const autoSelectedPage = useRef<number | null>(null);
  useEffect(() => {
    if (!inlineDetail || !items.length || dataPage == null || autoSelectedPage.current === dataPage) return;
    autoSelectedPage.current = dataPage;
    setSelectedId((current) => (current && items.some((entry) => entry.id === current) ? current : items[0]!.id));
  }, [inlineDetail, items, dataPage]);

  const detailPane =
    selected && inlineDetail ? (
      <aside className="panel q-detail-pane" aria-label={t('metadata')}>
        <header className="q-detail-pane-head">
          <span className="q-detail-pane-title">{auditActionLabel(selected)}</span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setSelectedId(null)} aria-label={t('close')}>
            <X aria-hidden />
          </Button>
        </header>
        <EntryDetail entry={selected} />
      </aside>
    ) : null;

  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, page * PAGE_SIZE);

  return (
    <Page className="q-page q-page--audit">
      <PageHeader title={t('auditLog')} lead={t('websiteAuditLogLead')} />

      <PageBody className="stack">
        <DataViewState
          loading={auditQuery.isLoading}
          error={auditQuery.isError && !auditQuery.data ? auditQuery.error : null}
          onRetry={() => auditQuery.refetch()}
          loadingFallback={
            <SectionCard flush title={t('auditLog')}>
              <TableSkeleton rows={6} columns={4} />
            </SectionCard>
          }
        >
          {items.length ? (
            <div className={cn('q-split', detailPane && 'has-detail')}>
              <SectionCard
                flush
                title={t('qualityActivity')}
                actions={
                  <span className="q-card-count">
                    {t('qualityRangeOf')
                      .replace('{from}', formatNumber(from))
                      .replace('{to}', formatNumber(to))
                      .replace('{total}', formatNumber(total))}
                  </span>
                }
                footer={
                  pages > 1 ? (
                    <>
                      <span>{t('qualityPageOf').replace('{page}', formatNumber(page)).replace('{pages}', formatNumber(pages))}</span>
                      <span className="q-footer-actions">
                        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                          <ChevronLeft aria-hidden />
                          {t('qualityNewer')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={page >= pages}
                          onClick={() => setPage((value) => value + 1)}
                        >
                          {t('qualityOlder')}
                          <ChevronRight aria-hidden />
                        </Button>
                      </span>
                    </>
                  ) : undefined
                }
              >
                <div className="table-scroll">
                  <table className="data-table data-table--interactive">
                    <thead>
                      <tr>
                        <th>{t('action')}</th>
                        <th>{t('operator')}</th>
                        <th>{t('entity')}</th>
                        <th>{t('when')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((entry) => {
                        const detail = auditDetail(entry);
                        return (
                          <tr
                            key={entry.id}
                            className={entry.id === selected?.id ? 'is-selected' : undefined}
                            tabIndex={0}
                            onClick={() => setSelectedId(entry.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') setSelectedId(entry.id);
                            }}
                          >
                            <td>
                              <div className="q-issue">
                                <span className="q-audit-icon" aria-hidden>
                                  <ClipboardList />
                                </span>
                                <div className="q-issue-copy">
                                  <span className="q-trace-root">{auditActionLabel(entry)}</span>
                                  {detail ? <span className="q-issue-meta">{detail}</span> : null}
                                </div>
                              </div>
                            </td>
                            <td>{entry.username ?? t('unknown')}</td>
                            <td className="q-col-muted">
                              {entry.entityType}
                              {entry.entityId ? <span className="q-cell-sub mono">{shortId(entry.entityId, 12)}</span> : null}
                            </td>
                            <td className="q-col-when">
                              <RelativeTime value={entry.createdAt} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
              {detailPane}
            </div>
          ) : (
            <EmptyState
              variant="rich"
              icon={<ClipboardList />}
              title={t('auditLogEmptyTitle')}
              description={t('auditLogEmptyBody')}
            />
          )}
        </DataViewState>
      </PageBody>

      <SideSheet
        open={Boolean(selected) && !inlineDetail}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        title={selected ? auditActionLabel(selected) : t('auditLog')}
      >
        {selected ? <EntryDetail entry={selected} /> : null}
      </SideSheet>
    </Page>
  );
}
