import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CohortFormDialog } from './CohortFormDialog';
import { EmptyState } from './EmptyState';
import { Button } from './ui/button';
import { api } from '../lib/api';
import { t } from '../lib/i18n';

type CohortRow = {
  id: string;
  name: string;
  createdAt: string;
  definition: {
    conditions: Array<{ field: string; operator: string; value: string }>;
  };
};

const PAGE_SIZE = 10;

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CohortsPanel({ websiteId }: { websiteId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

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
      <section className="panel cohorts-panel">
        <header className="cohorts-panel-head">
          <div className="cohorts-search-wrap">
            <svg
              className="cohorts-search-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3-3" />
            </svg>
            <input
              type="search"
              className="input cohorts-search"
              placeholder={t('cohortSearch')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              aria-label={t('cohortSearch')}
            />
          </div>
          <Button type="button" variant="primary" size="sm" onClick={openCreate}>
            {t('createCohort')}
          </Button>
        </header>

        {cohortsQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : filtered.length === 0 ? (
          <EmptyState title={t('noCohorts')} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table cohorts-table">
                <thead>
                  <tr>
                    <th scope="col">{t('name')}</th>
                    <th scope="col">{t('cohortCreated')}</th>
                    <th scope="col" className="cohorts-actions-col">
                      <span className="visually-hidden">{t('actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link
                          to={`/websites/${websiteId}?cohort=${encodeURIComponent(row.id)}`}
                          className="cohorts-name-link"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="text-muted">{formatCreatedAt(row.createdAt)}</td>
                      <td className="cohorts-actions-col">
                        <div className="cohorts-row-actions">
                          <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(row)}>
                            {t('edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="btn-danger-text"
                            onClick={() => setDeleteTarget(row)}
                          >
                            {t('delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pageCount > 1 ? (
              <footer className="cohorts-pagination">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={safePage <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  {t('cohortPrevPage')}
                </Button>
                <span className="text-muted cohorts-page-label">
                  {t('cohortPageOf').replace('{page}', String(safePage + 1)).replace('{total}', String(pageCount))}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  {t('cohortNextPage')}
                </Button>
              </footer>
            ) : null}
          </>
        )}
      </section>

      <CohortFormDialog
        open={formOpen}
        onClose={closeForm}
        websiteId={websiteId}
        cohortId={editId}
      />

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
