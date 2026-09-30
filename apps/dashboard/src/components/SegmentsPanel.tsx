import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { SegmentFormDialog } from './SegmentFormDialog';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  ResourceSearchField,
  useMasterDetailSelection,
} from './master-detail';
import { ConfirmDialog } from './ConfirmDialog';
import { Button } from './ui/button';
import { api, type Segment } from '../lib/api';
import { formatDateOnly } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

type SegmentRow = Segment & { createdAt?: string };

export function SegmentsPanel({ websiteId }: { websiteId: string }) {
  const queryClient = useQueryClient();
  // View-only members (and the demo) see the list without create, edit or delete.
  const { canEdit } = useWebsitePermissions(websiteId, 'analytics');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<SegmentRow | null>(null);

  const segmentsQuery = useQuery({
    queryKey: ['segments', websiteId],
    queryFn: () => api<SegmentRow[]>(`/api/websites/${websiteId}/segments`),
  });

  const deleteMutation = useMutation({
    mutationFn: (segmentId: string) =>
      api(`/api/websites/${websiteId}/segments/${segmentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments', websiteId] });
      setDeleteTarget(null);
    },
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = segmentsQuery.data ?? [];
    if (!query) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(query));
  }, [segmentsQuery.data, search]);

  const { selectedId, setSelectedId, selectedItem: selectedSegment } = useMasterDetailSelection(
    filtered,
    (row) => row.id,
  );

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((row) => row.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId, setSelectedId]);

  function openCreate() {
    setEditId(undefined);
    setFormOpen(true);
  }

  function openEdit(row: SegmentRow) {
    setEditId(row.id);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditId(undefined);
  }

  return (
    <>
      <section className="cohorts-panel section-gap">
        <header className="cohorts-panel-head">
          <ResourceSearchField
            value={search}
            onChange={setSearch}
            placeholder={t('segmentSearch')}
            aria-label={t('segmentSearch')}
          />
          {canEdit ? (
            <Button type="button" variant="primary" size="sm" onClick={openCreate}>
              {t('createSegment')}
            </Button>
          ) : null}
        </header>

        {segmentsQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : filtered.length === 0 ? (
          <EmptyState title={t('noSegments')} />
        ) : (
          <MasterDetailLayout
            list={filtered.map((row) => (
              <MasterDetailListItem
                key={row.id}
                selected={row.id === selectedId}
                onSelect={() => setSelectedId(row.id)}
                icon={<Layers size={16} strokeWidth={2} aria-hidden />}
                title={row.name}
                subtitle={row.type}
                meta={<span className="text-muted">{formatDateOnly(row.createdAt)}</span>}
              />
            ))}
            detail={
              selectedSegment ? (
                <MasterDetailPane
                  title={selectedSegment.name}
                  description={
                    <>
                      <p className="text-muted">
                        {t('type')}: {selectedSegment.type}
                      </p>
                      <p className="text-muted">
                        {t('segmentCreated')}: {formatDateOnly(selectedSegment.createdAt)}
                      </p>
                    </>
                  }
                  actions={
                    <div className="cohorts-row-actions">
                      {canEdit ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(selectedSegment)}
                          >
                            {t('edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive-ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(selectedSegment)}
                          >
                            {t('delete')}
                          </Button>
                        </>
                      ) : null}
                      <Button type="button" variant="secondary" size="sm" asChild>
                        <Link
                          to={`/websites/${websiteId}?segment=${encodeURIComponent(selectedSegment.id)}`}
                        >
                          {t('dashboard')}
                        </Link>
                      </Button>
                    </div>
                  }
                >
                  <div className="detail-section">
                    <h4 className="section-title experiment-title">{t('segmentJsonPreview')}</h4>
                    <pre className="mono text-muted segment-parameters-preview">
                      {JSON.stringify(selectedSegment.parameters, null, 2)}
                    </pre>
                  </div>
                </MasterDetailPane>
              ) : null
            }
          />
        )}
      </section>

      <SegmentFormDialog open={formOpen} onClose={closeForm} websiteId={websiteId} segmentId={editId} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('confirmDeleteTitle').replace('{name}', deleteTarget?.name ?? '')}
        description={t('confirmDeleteBody')}
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </>
  );
}
