import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Braces, Pencil, Plus, Trash2, Users } from 'lucide-react';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { RelativeTime } from './audience/ActivityLists';
import { cohortConditionRows, ConditionList, conditionSummary } from './audience/ConditionChips';
import { DetailSection } from './audience/DetailSheet';
import { MasterDetailSkeleton } from './audience/MasterDetailSkeleton';
import { TrendArea } from './audience/TrendArea';
import { CohortFormDialog } from './CohortFormDialog';
import { deleteTitle, useConfirm } from './ConfirmDialog';
import { DataViewState } from './DataViewState';
import { DateRangePicker } from './DateRangePicker';
import { EmptyState } from './EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from './KpiStrip';
import { MasterDetailLayout, MasterDetailListItem, MasterDetailPane, ResourceSearchField } from './master-detail';
import { PageBody } from './Page';
import { PageHeader } from './PageHeader';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { api } from '../lib/api';
import { formatNumber, formatShortDate } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

type CohortRow = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
  definition: {
    conditions: Array<{ field: string; operator: string; value: string; filters?: PropertyFilter[] }>;
    windowStart?: number;
    windowEnd?: number;
  };
};

/** GET /api/reports/cohort: member sessions (all of the definition) and daily activity in range. */
type CohortReport = {
  unit: 'day' | 'week';
  totalUsers: number;
  series: Array<{ bucket: string; users: number }>;
};

function CohortActivity({ cohortId, rangeQs }: { cohortId: string; rangeQs: string }) {
  const reportQuery = useQuery({
    queryKey: ['cohort-report', cohortId, rangeQs],
    // A new date range keeps this cohort's numbers until the new ones land.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === cohortId ? previous : undefined),
    queryFn: () => api<CohortReport>(`/api/reports/cohort?cohortId=${encodeURIComponent(cohortId)}&${rangeQs}`),
  });
  const report = reportQuery.data;
  const points = useMemo(
    () => (report?.series ?? []).map((point) => ({ label: formatShortDate(`${point.bucket}T00:00:00`), value: point.users })),
    [report?.series],
  );

  if (reportQuery.isLoading) {
    return (
      <>
        <div className="audience-pane-kpis">
          <KpiStripSkeleton cells={3} inline />
        </div>
        <DetailSection title={t('audienceActiveMembers')}>
          <Skeleton className="h-[180px] w-full" />
        </DetailSection>
      </>
    );
  }
  if (reportQuery.isError || !report) {
    return (
      <div className="audience-pane-kpis">
        <p className="audience-inline-error" role="alert">
          {t('audienceCohortSizeFailed')}
          <Button type="button" variant="link" size="sm" onClick={() => reportQuery.refetch()}>
            {t('retry')}
          </Button>
        </p>
      </div>
    );
  }

  const active = report.series.reduce((sum, point) => sum + point.users, 0);
  const perBucket = report.series.length ? active / report.series.length : 0;
  return (
    <>
      <div className="audience-pane-kpis">
        <KpiStrip inline columns={3}>
          <KpiCell label={t('members')} value={formatNumber(report.totalUsers)} hint={t('audienceMembersHint')} />
          <KpiCell label={t('audienceActiveInPeriod')} value={formatNumber(active)} />
          <KpiCell
            label={report.unit === 'week' ? t('audienceActivePerWeek') : t('audienceActivePerDay')}
            value={formatNumber(perBucket, { maximumFractionDigits: perBucket < 10 ? 1 : 0 })}
          />
        </KpiStrip>
      </div>
      <DetailSection title={t('audienceActiveMembers')}>
        {points.length > 1 ? (
          <TrendArea data={points} name={t('audienceActiveMembers')} />
        ) : (
          <p className="audience-section-empty">
            {report.totalUsers ? t('audienceNoActivityInPeriod') : t('audienceCohortNoMembers')}
          </p>
        )}
      </DetailSection>
    </>
  );
}

/** Cohorts catalog (console v2 master–detail): behavioral groups, their size and definition. */
export function CohortsPanel({ websiteId }: { websiteId: string }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  // View-only members (and the demo) see the list without create, edit or delete.
  const { canEdit } = useWebsitePermissions(websiteId, 'analytics');
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '30d');
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ open: boolean; editId?: string }>({ open: false });
  const [showJson, setShowJson] = useState(false);

  const cohortsQuery = useQuery({
    queryKey: ['cohorts', websiteId],
    queryFn: () => api<CohortRow[]>(`/api/websites/${websiteId}/cohorts`),
  });

  const deleteMutation = useMutation({
    mutationFn: (cohortId: string) => api(`/api/websites/${websiteId}/cohorts/${cohortId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cohorts', websiteId] }),
  });

  const all = cohortsQuery.data ?? [];
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? all.filter((row) => row.name.toLowerCase().includes(query)) : all;
  }, [all, search]);

  const requestedId = searchParams.get('id');
  const selected = filtered.find((row) => row.id === requestedId) ?? filtered[0] ?? null;
  const rows = useMemo(() => (selected ? cohortConditionRows(selected.definition.conditions) : []), [selected]);

  function select(id: string) {
    const next = new URLSearchParams(searchParams);
    next.set('id', id);
    setSearchParams(next, { replace: true });
    setShowJson(false);
  }

  function remove(row: CohortRow) {
    confirm({ title: deleteTitle(row.name), onConfirm: () => deleteMutation.mutate(row.id) });
  }

  const createButton = canEdit ? (
    <Button type="button" variant="primary" onClick={() => setForm({ open: true })}>
      <Plus data-icon="inline-start" aria-hidden />
      {t('createCohort')}
    </Button>
  ) : null;

  const definition = selected?.definition;
  const windowLabel =
    definition?.windowStart != null && definition.windowEnd != null
      ? `${formatShortDate(definition.windowStart)} – ${formatShortDate(definition.windowEnd)}`
      : null;

  return (
    <>
      <PageHeader
        title={t('cohorts')}
        lead={t('audienceCohortsLead')}
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} popover timezone={timezone} />
            {createButton}
          </>
        }
      />

      <PageBody>
        <DataViewState
          loading={cohortsQuery.isLoading}
          loadingFallback={<MasterDetailSkeleton />}
          error={cohortsQuery.isError ? cohortsQuery.error : null}
          onRetry={() => cohortsQuery.refetch()}
        >
          {all.length === 0 ? (
            <EmptyState
              variant="rich"
              icon={<Users />}
              title={t('audienceCohortsEmptyTitle')}
              description={t('audienceCohortsEmptyBody')}
              action={createButton}
            />
          ) : (
            <MasterDetailLayout
              listHeader={
                <>
                  <ResourceSearchField
                    value={search}
                    onChange={setSearch}
                    placeholder={t('cohortSearch')}
                    aria-label={t('cohortSearch')}
                    className="audience-list-search"
                  />
                  <span className="master-detail-list-count">
                    {t('audienceCohortCount').replace('{count}', formatNumber(filtered.length))}
                  </span>
                </>
              }
              list={
                filtered.length ? (
                  filtered.map((row) => (
                    <MasterDetailListItem
                      key={row.id}
                      selected={row.id === selected?.id}
                      onSelect={() => select(row.id)}
                      icon={<Users size={16} strokeWidth={2} aria-hidden />}
                      title={row.name}
                      subtitle={conditionSummary(cohortConditionRows(row.definition.conditions)) || undefined}
                      meta={<RelativeTime value={row.updatedAt ?? row.createdAt} />}
                    />
                  ))
                ) : (
                  <p className="audience-list-empty">{t('audienceNoMatchTitle')}</p>
                )
              }
              detail={
                selected ? (
                  <MasterDetailPane
                    title={selected.name}
                    meta={
                      <>
                        <span>{t('audienceConditionCount').replace('{count}', formatNumber(rows.length))}</span>
                        {windowLabel ? (
                          <span>
                            {t('cohortDateWindow')} {windowLabel}
                          </span>
                        ) : null}
                        <span>{t('audienceCreatedOn').replace('{date}', formatShortDate(selected.createdAt))}</span>
                      </>
                    }
                    actions={
                      <>
                        <Button type="button" variant="secondary" size="sm" asChild>
                          <Link to={`/websites/${websiteId}?cohort=${encodeURIComponent(selected.id)}`}>
                            <ArrowUpRight data-icon="inline-start" aria-hidden />
                            {t('audienceOpenInOverview')}
                          </Link>
                        </Button>
                        {canEdit ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setForm({ open: true, editId: selected.id })}
                            >
                              <Pencil data-icon="inline-start" aria-hidden />
                              {t('edit')}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive-ghost"
                              size="icon-sm"
                              aria-label={t('delete')}
                              title={t('delete')}
                              onClick={() => remove(selected)}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </>
                        ) : null}
                      </>
                    }
                  >
                    <CohortActivity cohortId={selected.id} rangeQs={rangeQs} />

                    <DetailSection
                      title={t('cohortConditions')}
                      actions={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-pressed={showJson}
                          onClick={() => setShowJson((open) => !open)}
                        >
                          <Braces data-icon="inline-start" aria-hidden />
                          {showJson ? t('audienceHideJson') : t('audienceViewJson')}
                        </Button>
                      }
                    >
                      {rows.length ? (
                        <ConditionList rows={rows} />
                      ) : (
                        <p className="audience-section-empty">{t('audienceNoConditions')}</p>
                      )}
                      {showJson ? (
                        <pre className="code-block audience-json">{JSON.stringify(selected.definition, null, 2)}</pre>
                      ) : null}
                    </DetailSection>
                  </MasterDetailPane>
                ) : (
                  <div className="master-detail-pane">
                    <EmptyState icon={<Users />} title={t('audienceSelectCohort')} description={t('audienceNoMatchBody')} />
                  </div>
                )
              }
            />
          )}
        </DataViewState>
      </PageBody>

      <CohortFormDialog
        open={form.open}
        onClose={() => setForm({ open: false })}
        websiteId={websiteId}
        cohortId={form.editId}
        onSaved={(id) => (id ? select(id) : undefined)}
      />
    </>
  );
}
