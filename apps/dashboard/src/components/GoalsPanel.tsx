import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, LabelList } from 'recharts';
import { AnalyticsChart } from './AnalyticsChart';
import { deleteTitle, useConfirm } from './ConfirmDialog';
import { DataViewState } from './DataViewState';
import { EmptyState } from './EmptyState';
import { type GoalConfigRow, type GoalFormState } from './GoalFormDialog';
import { KpiCell, KpiStrip, KpiStripSkeleton } from './KpiStrip';
import { SectionCard } from './SectionCard';
import { StatusBadge, type StatusTone } from './StatusBadge';
import { ProgressMeter } from './behavior/ProgressMeter';
import { formatRate } from './behavior/format';
import { goalPace, sharePercent, type GoalStatus } from './behavior/goal-metrics';
import { ResourceSearchField } from './master-detail';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { api, type Website } from '../lib/api';
import { HBAR_MARK } from '../lib/chartMarks';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { cn } from '../lib/utils';

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

/** `/api/reports/stickiness` — only the totals are used here. */
type StickinessTotals = {
  totalActors: number;
  distribution: Array<{ events: number }>;
};

type GoalView = {
  goal: GoalConfigRow;
  /** Completions in the goal's current period (today, this week, this month). */
  count: number;
  /** Uncapped: 132 when a goal is beaten by a third. */
  progress: number;
  status: GoalStatus;
  /** Completions expected by now at an even pace. */
  expected: number;
  elapsed: number;
  /** Selected range: completions, visitors who completed it, and their share of all visitors. */
  completions: number | null;
  converted: number | null;
  rate: number | null;
};

const EVENTS_PAGE_SIZE = 8;
/** API limit on values in one `is` filter (MAX_PROPERTY_FILTER_VALUES). */
const MAX_UNION_EVENTS = 10;

const STATUS_TONE: Record<GoalStatus, StatusTone> = {
  reached: 'success',
  onTrack: 'neutral',
  behind: 'warning',
};

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

function sumEvents(data: StickinessTotals | undefined) {
  return data ? data.distribution.reduce((sum, row) => sum + row.events, 0) : null;
}

export function GoalsPanel({
  websiteId,
  reportUrl,
  range,
  segmentId,
  canEdit,
  onOpenForm,
}: {
  websiteId: string;
  reportUrl: (kind: string, extra?: string) => string;
  range: { startAt: number; endAt: number };
  segmentId: string;
  canEdit: boolean;
  onOpenForm: (state: GoalFormState) => void;
}) {
  const confirm = useConfirm();
  const chartColors = useChartColors();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const scope = [range.startAt, range.endAt, segmentId] as const;

  const goalQuery = useQuery({
    queryKey: ['reports-goal', websiteId, ...scope],
    enabled: Boolean(websiteId),
    queryFn: () => api<GoalReportRow[]>(reportUrl('goal')),
    placeholderData: keepPreviousData,
  });

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<Website & { goalConfig?: { goals: GoalConfigRow[] } }>(`/api/websites/${websiteId}`),
  });

  const configuredGoals = useMemo(
    () => normalizeGoalConfig(websiteQuery.data?.goalConfig?.goals),
    [websiteQuery.data?.goalConfig?.goals],
  );
  const goalEvents = useMemo(() => configuredGoals.map((goal) => goal.event), [configuredGoals]);

  // Range metrics come from the stickiness report (session actors): it honours the date range
  // and segment, and `totalActors` is the number of visitors who did the event.
  const stickiness = (extra: string) => api<StickinessTotals>(reportUrl('stickiness', `&actor=session${extra}`));

  const perGoalQueries = useQueries({
    queries: goalEvents.map((event) => ({
      queryKey: ['goal-conversions', websiteId, 'event', event, ...scope],
      queryFn: () => stickiness(`&event=${encodeURIComponent(event)}`),
      // Keep the last numbers of the same goal while a new range loads; never another goal's.
      placeholderData: (previous: StickinessTotals | undefined, previousQuery?: { queryKey: readonly unknown[] }) =>
        previousQuery?.queryKey[3] === event ? previous : undefined,
      staleTime: 60_000,
    })),
  });

  const visitorsQuery = useQuery({
    queryKey: ['goal-conversions', websiteId, 'all', ...scope],
    enabled: Boolean(websiteId) && goalEvents.length > 0,
    queryFn: () => stickiness(''),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const unionEvents = goalEvents.slice(0, MAX_UNION_EVENTS);
  const convertedQuery = useQuery({
    queryKey: ['goal-conversions', websiteId, 'any', unionEvents.join('\n'), ...scope],
    enabled: Boolean(websiteId) && goalEvents.length > 0 && goalEvents.length <= MAX_UNION_EVENTS,
    queryFn: () =>
      stickiness(
        `&filters=${encodeURIComponent(
          JSON.stringify([{ type: 'dimension', key: 'event', operator: 'is', value: unionEvents }]),
        )}`,
      ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (event: string) => {
      const existing = websiteQuery.data?.goalConfig?.goals ?? [];
      return api(`/api/websites/${websiteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ goalConfig: { goals: existing.filter((goal) => goal.event !== event) } }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['website', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['reports-goal', websiteId] });
    },
  });

  const rows = goalQuery.data ?? [];
  const totalVisitors = visitorsQuery.data?.totalActors ?? null;
  const now = Date.now();

  const goals: GoalView[] = configuredGoals.map((goal, index) => {
    const report = rows.find((row) => row.event === goal.event && row.target != null);
    const count = report?.count ?? 0;
    const pace = goalPace({
      count,
      target: goal.target,
      period: report?.periodLabel ?? goal.period,
      periodStart: report?.periodStart ?? now,
      now,
    });
    const stats = perGoalQueries[index]?.data;
    const converted = stats?.totalActors ?? null;
    return {
      goal,
      count,
      progress: goal.target > 0 ? (count / goal.target) * 100 : 0,
      status: pace.status,
      expected: pace.expected,
      elapsed: pace.elapsed,
      completions: sumEvents(stats),
      converted,
      rate: converted == null || totalVisitors == null ? null : sharePercent(converted, totalVisitors),
    };
  });

  const otherEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((row) => row.target == null && !goalEvents.includes(row.event))
      .filter((row) => !query || row.event.toLowerCase().includes(query));
  }, [rows, goalEvents, search]);

  const pageCount = Math.max(1, Math.ceil(otherEvents.length / EVENTS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = otherEvents.slice(safePage * EVENTS_PAGE_SIZE, (safePage + 1) * EVENTS_PAGE_SIZE);
  const maxOtherCount = Math.max(1, ...otherEvents.map((row) => row.count));

  const initialLoading = (goalQuery.isLoading && !goalQuery.data) || (websiteQuery.isLoading && !websiteQuery.data);
  const conversionsLoading = perGoalQueries.some((query) => query.isLoading) || visitorsQuery.isLoading;
  const refetching = goalQuery.isPlaceholderData || perGoalQueries.some((query) => query.isPlaceholderData);

  const chartData = goals
    .filter((view) => view.rate != null)
    .map((view) => ({ event: view.goal.event, rate: view.rate ?? 0, converted: view.converted ?? 0 }))
    .sort((a, b) => b.rate - a.rate);
  const longestName = Math.max(0, ...chartData.map((row) => row.event.length));
  const chartAxisWidth = Math.min(220, Math.max(88, Math.round(longestName * 7.4) + 16));

  function confirmDelete(goal: GoalConfigRow) {
    confirm({ title: deleteTitle(goal.event), onConfirm: () => deleteMutation.mutate(goal.event) });
  }

  return (
    <DataViewState
      loading={initialLoading}
      error={goalQuery.isError ? goalQuery.error : websiteQuery.isError ? websiteQuery.error : null}
      onRetry={() => {
        void goalQuery.refetch();
        void websiteQuery.refetch();
      }}
      loadingFallback={<GoalsSkeleton />}
    >
      <div className={cn('stack behavior-goals', refetching && 'behavior-refetching')}>
        {goals.length ? (
          <>
            <GoalsKpiStrip
              goals={goals}
              converted={convertedQuery.data?.totalActors ?? null}
              totalVisitors={totalVisitors}
              conversionsLoading={conversionsLoading || (convertedQuery.isLoading && goalEvents.length <= MAX_UNION_EVENTS)}
            />

            {chartData.length >= 2 ? (
              <SectionCard title={t('behaviorGoalChartTitle')} description={t('behaviorGoalChartLead')}>
                <div className="behavior-hbar-chart">
                  <AnalyticsChart
                    Chart={BarChart}
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 0, right: 56, bottom: 0, left: 0 }}
                    grid={{ vertical: false, horizontal: false }}
                    xAxis={{ type: 'number', hide: true }}
                    yAxis={{ type: 'category', dataKey: 'event', width: chartAxisWidth }}
                    valueFormatter={(value) => formatRate(value)}
                    responsive={{ height: chartData.length * 36 + 8 }}
                  >
                    <Bar dataKey="rate" name={t('behaviorGoalConversionRate')} fill={chartColors.accent} {...HBAR_MARK}>
                      <LabelList
                        dataKey="rate"
                        position="right"
                        offset={8}
                        formatter={(value) => formatRate(Number(value))}
                        fill={chartColors.text}
                        fontSize={12}
                      />
                    </Bar>
                  </AnalyticsChart>
                </div>
              </SectionCard>
            ) : null}

            <SectionCard
              flush
              title={t('goals')}
              description={t('behaviorGoalTableLead')}
            >
              <div className="table-scroll">
                <table className="data-table behavior-goals-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('behaviorGoalColumn')}</th>
                      <th scope="col">{t('goalProgress')}</th>
                      <th scope="col">{t('behaviorGoalStatus')}</th>
                      <th scope="col" className="num">{t('behaviorGoalCompletions')}</th>
                      <th scope="col" className="num">{t('behaviorGoalConversionRate')}</th>
                      {canEdit ? (
                        <th scope="col" className="behavior-actions-col">
                          <span className="visually-hidden">{t('actions')}</span>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {goals.map((view) => (
                      <GoalRow
                        key={view.goal.event}
                        view={view}
                        websiteId={websiteId}
                        canEdit={canEdit}
                        conversionsLoading={conversionsLoading}
                        onEdit={() => onOpenForm({ mode: 'edit', goal: view.goal })}
                        onDelete={() => confirmDelete(view.goal)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </>
        ) : (
          <EmptyState
            variant="rich"
            icon={<Target strokeWidth={2} />}
            title={t('noGoals')}
            description={t('behaviorGoalsEmptyBody')}
            action={
              canEdit ? (
                <Button type="button" variant="primary" onClick={() => onOpenForm({ mode: 'create' })}>
                  {t('createGoal')}
                </Button>
              ) : undefined
            }
          />
        )}

        {rows.some((row) => row.target == null && !goalEvents.includes(row.event)) ? (
          <SectionCard
            flush
            title={t('behaviorGoalOtherEvents')}
            description={t('behaviorGoalOtherEventsLead')}
            actions={
              <ResourceSearchField
                className="behavior-search"
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(0);
                }}
                placeholder={t('goalSearch')}
                aria-label={t('goalSearch')}
              />
            }
            footer={
              pageCount > 1 ? (
                <>
                  <span>
                    {t('cohortPageOf')
                      .replace('{page}', String(safePage + 1))
                      .replace('{total}', String(pageCount))}
                  </span>
                  <span className="behavior-pager">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={safePage <= 0}
                      onClick={() => setPage(Math.max(0, safePage - 1))}
                    >
                      {t('cohortPrevPage')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={safePage >= pageCount - 1}
                      onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                    >
                      {t('cohortNextPage')}
                    </Button>
                  </span>
                </>
              ) : undefined
            }
          >
            {pageRows.length ? (
              <div className="table-scroll">
                <table className="data-table behavior-events-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('event')}</th>
                      <th scope="col" className="num">{t('events')}</th>
                      {canEdit ? (
                        <th scope="col" className="behavior-actions-col">
                          <span className="visually-hidden">{t('actions')}</span>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => (
                      <tr key={row.event}>
                        <td>
                          <span className="behavior-share-cell">
                            <span
                              className="behavior-share-bar"
                              style={{ width: `${(row.count / maxOtherCount) * 100}%` }}
                              aria-hidden
                            />
                            <span className="mono behavior-event-name" title={row.event}>
                              {row.event}
                            </span>
                          </span>
                        </td>
                        <td className="num">{formatNumber(row.count)}</td>
                        {canEdit ? (
                          <td className="behavior-actions-col">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => onOpenForm({ mode: 'create', prefillEvent: row.event })}
                            >
                              {t('goalSetTarget')}
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title={t('behaviorNoMatches')} description={t('behaviorNoMatchesHint')} />
            )}
          </SectionCard>
        ) : null}
      </div>
    </DataViewState>
  );
}

function GoalsKpiStrip({
  goals,
  converted,
  totalVisitors,
  conversionsLoading,
}: {
  goals: GoalView[];
  converted: number | null;
  totalVisitors: number | null;
  conversionsLoading: boolean;
}) {
  const counts = { reached: 0, onTrack: 0, behind: 0 };
  for (const view of goals) counts[view.status] += 1;
  const statusHint = [
    counts.reached ? t('behaviorGoalsReachedN').replace('{n}', formatNumber(counts.reached)) : null,
    counts.onTrack ? t('behaviorGoalsOnTrackN').replace('{n}', formatNumber(counts.onTrack)) : null,
    counts.behind ? t('behaviorGoalsBehindN').replace('{n}', formatNumber(counts.behind)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const completions = goals.every((view) => view.completions != null)
    ? goals.reduce((sum, view) => sum + (view.completions ?? 0), 0)
    : null;
  const rate = converted != null && totalVisitors != null ? sharePercent(converted, totalVisitors) : null;
  const best = [...goals].sort((a, b) => b.progress - a.progress)[0];
  const pending = <Skeleton className="h-7 w-20" />;

  return (
    <KpiStrip columns={4}>
      <KpiCell label={t('goals')} value={formatNumber(goals.length)} hint={statusHint || undefined} />
      <KpiCell
        label={t('behaviorGoalCompletions')}
        value={completions != null ? formatNumber(completions) : conversionsLoading ? pending : '—'}
        hint={t('behaviorInSelectedPeriod')}
      />
      <KpiCell
        label={t('behaviorGoalConversionRate')}
        value={rate != null ? formatRate(rate) : conversionsLoading ? pending : '—'}
        hint={
          converted != null && totalVisitors != null
            ? t('behaviorGoalConvertedOf')
                .replace('{converted}', formatNumber(converted))
                .replace('{total}', formatNumber(totalVisitors))
            : goals.length > MAX_UNION_EVENTS
              ? t('behaviorGoalTooManyForRate')
              : undefined
        }
      />
      <KpiCell
        label={t('behaviorGoalBest')}
        value={best ? <span className="behavior-kpi-text">{best.goal.event}</span> : '—'}
        title={best?.goal.event}
        hint={
          best
            ? t(`behaviorGoalBestHint_${best.goal.period}`).replace('{pct}', formatRate(best.progress))
            : undefined
        }
      />
    </KpiStrip>
  );
}

function GoalRow({
  view,
  websiteId,
  canEdit,
  conversionsLoading,
  onEdit,
  onDelete,
}: {
  view: GoalView;
  websiteId: string;
  canEdit: boolean;
  conversionsLoading: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { goal } = view;
  const pending = <Skeleton className="ml-auto h-4 w-12" />;
  return (
    <tr>
      <td>
        <Link
          className="behavior-goal-link mono"
          to={`/websites/${websiteId}/attribution?type=event&step=${encodeURIComponent(goal.event)}&model=last`}
          title={goal.event}
        >
          {goal.event}
        </Link>
      </td>
      <td>
        <div className="behavior-goal-progress">
          <div className="behavior-goal-progress-line">
            <span>
              <strong>{formatNumber(view.count)}</strong>
              <span className="text-muted">
                {' / '}
                {formatNumber(goal.target)} {t(`behaviorGoalPeriodNow_${goal.period}`)}
              </span>
            </span>
            <span className="behavior-goal-progress-pct">{formatRate(view.progress)}</span>
          </div>
          <ProgressMeter
            value={view.progress / 100}
            marker={view.status === 'reached' ? null : view.elapsed}
            label={`${goal.event} ${formatRate(view.progress)}`}
            markerLabel={t('behaviorGoalExpectedByNow').replace('{n}', formatNumber(Math.round(view.expected)))}
          />
        </div>
      </td>
      <td>
        <StatusBadge tone={STATUS_TONE[view.status]}>{t(`behaviorGoalStatus_${view.status}`)}</StatusBadge>
      </td>
      <td className="num">
        {view.completions != null ? formatNumber(view.completions) : conversionsLoading ? pending : '—'}
      </td>
      <td className="num">{view.rate != null ? formatRate(view.rate) : conversionsLoading ? pending : '—'}</td>
      {canEdit ? (
        <td className="behavior-actions-col">
          <span className="behavior-row-actions">
            <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
              {t('edit')}
            </Button>
            <Button type="button" variant="destructive-ghost" size="sm" onClick={onDelete}>
              {t('delete')}
            </Button>
          </span>
        </td>
      ) : null}
    </tr>
  );
}

function GoalsSkeleton() {
  return (
    <div className="stack" aria-hidden>
      <KpiStripSkeleton cells={4} />
      <SectionCard flush title={t('goals')}>
        <div className="behavior-table-skeleton">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-9 w-full" />
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
