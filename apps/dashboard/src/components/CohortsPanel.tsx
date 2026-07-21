import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { CohortFormDialog } from './CohortFormDialog';
import { EmptyState } from './EmptyState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  ResourceSearchField,
  useMasterDetailSelection,
} from './master-detail';
import { Button } from './ui/button';
import { api } from '../lib/api';
import { formatDateOnly } from '../lib/format';
import { t } from '../lib/i18n';

type CohortRow = {
  id: string;
  name: string;
  createdAt: string;
  definition: {
    conditions: Array<{ field: string; operator: string; value: string }>;
  };
};

export function CohortsPanel({ websiteId }: { websiteId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<CohortRow | null>(null);

  const cohortsQuery = useQuery({
    queryKey: ['cohorts', websiteId],
    queryFn: () => api<CohortRow[]>(`/api/websites/${websiteId}/cohorts`),
  });

  const deleteMutation = useMutation({
    mutationFn: (cohortId: string) =>
      api(`/api/websites/${websiteId}/cohorts/${cohortId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cohorts', websiteId] });
      setDeleteTarget(null);
    },
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = cohortsQuery.data ?? [];
    if (!query) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(query));
  }, [cohortsQuery.data, search]);

  const { selectedId, setSelectedId, selectedItem: selectedCohort } = useMasterDetailSelection(
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

  function openEdit(row: CohortRow) {
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
            placeholder={t('cohortSearch')}
            aria-label={t('cohortSearch')}
          />
          <Button type="button" variant="primary" size="sm" onClick={openCreate}>
            {t('createCohort')}
          </Button>
        </header>

        {cohortsQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : filtered.length === 0 ? (
          <EmptyState title={t('noCohorts')} />
        ) : (
          <MasterDetailLayout
            list={filtered.map((row) => (
              <MasterDetailListItem
                key={row.id}
                selected={row.id === selectedId}
                onSelect={() => setSelectedId(row.id)}
                icon={<Users size={16} strokeWidth={2} aria-hidden />}
                title={row.name}
                subtitle={formatDateOnly(row.createdAt)}
                meta={
                  <span className="text-muted">
                    {row.definition.conditions.length} {t('cohortConditions').toLowerCase()}
                  </span>
                }
              />
            ))}
            detail={
              selectedCohort ? (
                <MasterDetailPane
                  title={selectedCohort.name}
                  description={
                    <span className="text-muted">
                      {t('cohortCreated')}: {formatDateOnly(selectedCohort.createdAt)}
                    </span>
                  }
                  actions={
                    <div className="cohorts-row-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(selectedCohort)}
                      >
                        {t('edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="btn-danger-text"
                        onClick={() => setDeleteTarget(selectedCohort)}
                      >
                        {t('delete')}
                      </Button>
                      <Button type="button" variant="secondary" size="sm" asChild>
                        <Link to={`/websites/${websiteId}?cohort=${encodeURIComponent(selectedCohort.id)}`}>
                          {t('dashboard')}
                        </Link>
                      </Button>
                    </div>
                  }
                >
                  <div className="detail-section">
                    <h4 className="section-title experiment-title">{t('cohortConditions')}</h4>
                    {selectedCohort.definition.conditions.length ? (
                      <ul className="cohort-conditions-list">
                        {selectedCohort.definition.conditions.map((condition, index) => (
                          <li key={`${condition.field}-${index}`} className="text-muted">
                            <span className="badge">{condition.field}</span>{' '}
                            {condition.operator} {condition.value}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted">—</p>
                    )}
                  </div>
                </MasterDetailPane>
              ) : null
            }
          />
        )}
      </section>

      <CohortFormDialog open={formOpen} onClose={closeForm} websiteId={websiteId} cohortId={editId} />

      {deleteTarget ? (
        <div className="dialog-backdrop" onClick={() => setDeleteTarget(null)}>
          <div
            className="dialog-panel cohort-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cohort-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="dialog-header">
              <h2 id="cohort-delete-title" className="dialog-title">
                {t('delete')}
              </h2>
            </header>
            <p className="dialog-body cohort-delete-message">
              {t('cohortDeleteConfirm').replace('{name}', deleteTarget.name)}
            </p>
            <footer className="dialog-footer">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteMutation.isPending}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
              >
                {t('delete')}
              </Button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
