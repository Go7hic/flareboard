import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState } from './EmptyState';
import { GoalFormDialog, type GoalConfigRow } from './GoalFormDialog';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { api, type Website } from '../lib/api';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { chartTooltipStyle } from '../lib/chartStyles';

export type GoalReportRow = {
  event: string;
  count: number;
  target: number | null;
  period: string | null;
  periodStart?: number;
  periodEnd?: number;
  periodLabel?: string | null;
  progress: number | null;
};

const PAGE_SIZE = 10;

function formatPeriodLabel(row: GoalReportRow) {
  if (row.periodLabel) return t(`goalPeriod_${row.periodLabel}`);
  if (row.period) return row.period;
  return '—';
}

function normalizeGoalConfig(
  goals: Array<{ event: string; target: number; period: string }> | undefined,
): GoalConfigRow[] {
  return (goals ?? []).map((goal) => ({
    event: goal.event,
    target: goal.target,
    period:
      goal.period === 'daily' || goal.period === 'weekly' || goal.period === 'monthly'
        ? goal.period
        : 'monthly',
  }));
}

function StatCard({ label, value, primary }: { label: string; value: number; primary?: boolean }) {
  return (
    <div className={`stat-card${primary ? ' stat-card-primary' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value.toLocaleString()}</div>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="stat-card stat-card-skeleton" aria-hidden>
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="mt-[0.65rem] h-7 w-full" />
    </div>
  );
}

export function GoalsPanel({
  websiteId,
  reportUrl,
}: {
  websiteId: string;
  reportUrl: (kind: string, extra?: string) => string;
}) {
  const chartColors = useChartColors();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<GoalConfigRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GoalConfigRow | null>(null);

  const goalQuery = useQuery({
    queryKey: ['reports-goal', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<GoalReportRow[]>(reportUrl('goal')),
  });

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<Website & { goalConfig?: { goals: GoalConfigRow[] } }>(`/api/websites/${websiteId}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (event: string) => {
      const existing = websiteQuery.data?.goalConfig?.goals ?? [];
      const goals = existing.filter((g) => g.event !== event);
      return api(`/api/websites/${websiteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ goalConfig: { goals } }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['website', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['reports-goal', websiteId] });
      setDeleteTarget(null);
    },
  });

  const rows = goalQuery.data ?? [];
  const configuredGoals = normalizeGoalConfig(websiteQuery.data?.goalConfig?.goals);
  const configuredSet = useMemo(() => new Set(configuredGoals.map((g) => g.event)), [configuredGoals]);

  const stats = useMemo(() => {
    const configuredRows = rows.filter((r) => configuredSet.has(r.event));
    const onTrack = configuredRows.filter((r) => r.progress != null && r.progress >= 100).length;
    const conversions = configuredRows.reduce((sum, r) => sum + r.count, 0);
    const eventsWithData = rows.filter((r) => r.count > 0).length;
    return {
      configured: configuredGoals.length,
      conversions,
      onTrack,
      eventsWithData,
    };
  }, [rows, configuredSet, configuredGoals.length]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => row.event.toLowerCase().includes(query));
  }, [rows, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const chartData = useMemo(() => {
    return rows
      .filter((r) => r.target != null && r.count > 0)
      .slice(0, 8)
      .map((r) => ({ name: r.event, count: r.count, target: r.target ?? 0 }));
  }, [rows]);

  const loading = goalQuery.isLoading;

  function openCreate(prefillEvent?: string) {
    setEditGoal(
      prefillEvent
        ? { event: prefillEvent, target: 100, period: 'monthly' }
        : null,
    );
    setFormOpen(true);
  }

  function openEdit(row: GoalReportRow) {
    const config = configuredGoals.find((g) => g.event === row.event);
    if (!config) {
      openCreate(row.event);
      return;
    }
    setEditGoal(config);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditGoal(null);
  }

  return (
    <div className="goals-layout">
      <section className="analytics-hero-stats goals-stats-grid section-gap">
        {loading ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StatCard label={t('goalConfiguredCount')} value={stats.configured} primary />
            <StatCard label={t('goalConversions')} value={stats.conversions} />
            <StatCard label={t('goalOnTrack')} value={stats.onTrack} />
            <StatCard label={t('goalEventsTracked')} value={stats.eventsWithData} />
          </>
        )}
      </section>

      {!loading && chartData.length > 0 ? (
        <section className="panel goals-chart-panel section-gap" aria-label={t('goalChartTitle')}>
          <h2 className="section-title goals-chart-title">{t('goalChartTitle')}</h2>
          <p className="text-muted goals-chart-lead">{t('goalChartLead')}</p>
          <div className="chart-wrap chart-wrap-compact goals-chart-wrap">
            <ResponsiveContainer>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  tick={{ fontSize: 11, fill: chartColors.muted }}
                  stroke={chartColors.border}
                />
                <Tooltip contentStyle={chartTooltipStyle(chartColors, { fontSize: 12 })} />
                <Bar dataKey="count" fill={chartColors.accent} radius={[0, 4, 4, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      <section className="panel section-gap goals-panel">
        <header className="goals-panel-head">
          <h2 className="section-title goals-list-title">{t('goalListTitle')}</h2>
          <div className="goals-panel-toolbar">
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
              placeholder={t('goalSearch')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              aria-label={t('goalSearch')}
            />
          </div>
          <Button type="button" variant="primary" size="sm" onClick={() => openCreate()}>
            {t('createGoal')}
          </Button>
          </div>
        </header>

        {loading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={configuredGoals.length === 0 ? t('noGoals') : t('noDataInPeriod')}
            description={configuredGoals.length === 0 ? t('noGoalsHint') : undefined}
          >
            {configuredGoals.length === 0 ? (
              <Button type="button" variant="primary" size="sm" onClick={() => openCreate()}>
                {t('createGoal')}
              </Button>
            ) : null}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table goals-table">
                <thead>
                  <tr>
                    <th scope="col">{t('goalEventName')}</th>
                    <th scope="col">{t('goalCount')}</th>
                    <th scope="col">{t('goalTarget')}</th>
                    <th scope="col">{t('goalPeriodUsed')}</th>
                    <th scope="col">{t('goalProgress')}</th>
                    <th scope="col" className="cohorts-actions-col">
                      <span className="visually-hidden">{t('actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => {
                    const isConfigured = configuredSet.has(row.event);
                    return (
                      <tr key={row.event}>
                        <td>
                          <Link
                            to={`/websites/${websiteId}/attribution?type=event&step=${encodeURIComponent(row.event)}&model=last`}
                            className="goals-event-link"
                          >
                            {row.event}
                          </Link>
                          {!isConfigured ? (
                            <span className="goals-unconfigured-badge">{t('goalUnconfigured')}</span>
                          ) : null}
                        </td>
                        <td className="stat-value">{row.count.toLocaleString()}</td>
                        <td>{row.target != null ? row.target.toLocaleString() : '—'}</td>
                        <td className="text-muted">{formatPeriodLabel(row)}</td>
                        <td>
                          {row.progress != null && row.target != null ? (
                            <div className="goals-progress-cell">
                              <span className="goals-progress-label">{row.progress}%</span>
                              <div className="goal-progress-track">
                                <div
                                  className="goal-progress-bar"
                                  style={{ width: `${Math.min(100, row.progress)}%` }}
                                />
                              </div>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="cohorts-actions-col">
                          <div className="cohorts-row-actions">
                            <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(row)}>
                              {isConfigured ? t('edit') : t('goalSetTarget')}
                            </Button>
                            {isConfigured ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="btn-danger-text"
                                onClick={() => {
                                  const config = configuredGoals.find((g) => g.event === row.event);
                                  if (config) setDeleteTarget(config);
                                }}
                              >
                                {t('delete')}
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
                  {t('cohortPageOf')
                    .replace('{page}', String(safePage + 1))
                    .replace('{total}', String(pageCount))}
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

      <GoalFormDialog open={formOpen} onClose={closeForm} websiteId={websiteId} editGoal={editGoal} />

      {deleteTarget ? (
        <div className="dialog-backdrop" onClick={() => setDeleteTarget(null)}>
          <div
            className="dialog-panel cohort-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="goal-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="dialog-header">
              <h2 id="goal-delete-title" className="dialog-title">
                {t('delete')}
              </h2>
            </header>
            <p className="dialog-body cohort-delete-message">
              {t('goalDeleteConfirm').replace('{event}', deleteTarget.event)}
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
                onClick={() => deleteMutation.mutate(deleteTarget.event)}
              >
                {t('delete')}
              </Button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
