import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DateRangePicker } from '../components/DateRangePicker';
import { RetentionHeatmap } from '../components/RetentionHeatmap';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { ReportSection, SectionDataSkeleton } from '../components/ReportSection';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, getToken, type UtmRow, type Website } from '../lib/api';
import { type DateRangePreset, presetToRange, rangeQueryString } from '../lib/dateRange';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';

export default function ReportsPage() {
  const chartColors = useChartColors();
  const navigate = useNavigate();
  const [websiteId, setWebsiteId] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [funnelSteps, setFunnelSteps] = useState('signup,purchase');
  const [savedName, setSavedName] = useState('');
  const [savedType, setSavedType] = useState('funnel');
  const [range, setRange] = useState({
    preset: '30d' as DateRangePreset,
    ...presetToRange('30d'),
  });
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    funnel: true,
    retention: false,
    journey: false,
    attribution: false,
    breakdown: false,
    performance: false,
    utm: false,
    revenue: false,
    goals: false,
    cohorts: false,
  });
  const [cohortName, setCohortName] = useState('');
  type CohortCondition = {
    field: 'event_name' | 'url_path';
    operator: 'equals' | 'contains';
    value: string;
  };
  const [cohortConditions, setCohortConditions] = useState<CohortCondition[]>([
    { field: 'event_name', operator: 'equals', value: '' },
  ]);
  const [selectedCohortId, setSelectedCohortId] = useState('');
  const [compareCohortId, setCompareCohortId] = useState('');
  const [cohortWindow, setCohortWindow] = useState({
    preset: '30d' as DateRangePreset,
    ...presetToRange('30d'),
  });
  const [goalEvent, setGoalEvent] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalPeriod, setGoalPeriod] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const queryClient = useQueryClient();

  function setSectionOpen(id: string, open: boolean) {
    setOpenSections((prev) => ({ ...prev, [id]: open }));
  }

  function GatedReportSection({
    id,
    title,
    loading,
    children,
  }: {
    id: string;
    title: string;
    loading?: boolean;
    children: ReactNode;
  }) {
    const open = openSections[id];
    if (!open) {
      return (
        <section className="panel section-gap">
          <button type="button" className="section-title reports-section-toggle" onClick={() => setSectionOpen(id, true)}>
            {title}
          </button>
          <p className="text-muted">{t('clickToLoadReport')}</p>
        </section>
      );
    }
    return (
      <ReportSection title={title} variant="flat" loading={loading}>
        {children}
      </ReportSection>
    );
  }

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

  const websitesQuery = useQuery({
    queryKey: ['websites'],
    queryFn: () => api<Website[]>('/api/websites'),
  });

  useEffect(() => {
    if (websitesQuery.data?.length && !websiteId) {
      setWebsiteId(websitesQuery.data[0].id);
    }
  }, [websitesQuery.data, websiteId]);

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<
        Website & { goalConfig?: { goals: Array<{ event: string; target: number; period: string }> } }
      >(`/api/websites/${websiteId}`),
  });

  const rangeQs = rangeQueryString(range.startAt, range.endAt);
  const segmentQs = segmentId ? `&segmentId=${encodeURIComponent(segmentId)}` : '';
  const q = (path: string) =>
    `/api/reports/${path}?websiteId=${websiteId}&${rangeQs}${segmentQs}`;

  const segmentsQuery = useQuery({
    queryKey: ['segments', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Array<{ id: string; name: string }>>(`/api/websites/${websiteId}/segments`),
  });

  const savedReportsQuery = useQuery({
    queryKey: ['saved-reports'],
    queryFn: () =>
      api<
        Array<{
          id: string;
          name: string;
          type: string;
          websiteId: string;
          parameters: Record<string, unknown>;
        }>
      >('/api/reports'),
  });

  const utmQuery = useQuery({
    queryKey: ['reports-utm', websiteId, range, segmentId],
    enabled: Boolean(websiteId) && openSections.utm,
    queryFn: () => api<UtmRow[]>(q('utm')),
  });

  const goalQuery = useQuery({
    queryKey: ['reports-goal', websiteId, range, segmentId],
    enabled: Boolean(websiteId) && openSections.goals,
    queryFn: () =>
      api<
        Array<{
          event: string;
          count: number;
          target: number | null;
          period: string | null;
          periodStart?: number;
          periodEnd?: number;
          periodLabel?: string | null;
          progress: number | null;
        }>
      >(q('goal')),
  });

  const revenueQuery = useQuery({
    queryKey: ['reports-revenue', websiteId, range, segmentId],
    enabled: Boolean(websiteId) && openSections.revenue,
    queryFn: () =>
      api<{
        byDay: Array<{ date: string; currency: string; total: number; transactions: number }>;
        byEvent: Array<{ eventName: string; currency: string; total: number; transactions: number }>;
      }>(q('revenue')),
  });

  const funnelQuery = useQuery({
    queryKey: ['reports-funnel', websiteId, funnelSteps, range, segmentId],
    enabled: Boolean(websiteId) && openSections.funnel,
    queryFn: () =>
      api<{ steps: Array<{ step: string; count: number; rate: number }>; conversion: number }>(
        `${q('funnel')}&steps=${encodeURIComponent(funnelSteps)}`,
      ),
  });

  const retentionQuery = useQuery({
    queryKey: ['reports-retention', websiteId, range, segmentId],
    enabled: Boolean(websiteId) && openSections.retention,
    queryFn: () => api<{ cohorts: Array<{ cohortWeek: string; weekOffset: number; users: number }> }>(q('retention')),
  });

  const journeyQuery = useQuery({
    queryKey: ['reports-journey', websiteId, range, segmentId],
    enabled: Boolean(websiteId) && openSections.journey,
    queryFn: () => api<{ paths: Array<{ path: string; count: number }> }>(q('journey')),
  });

  const attributionQuery = useQuery({
    queryKey: ['reports-attribution', websiteId, range, segmentId],
    enabled: Boolean(websiteId) && openSections.attribution,
    queryFn: () =>
      api<{ model: string; sources: Array<{ source: string; sessions: number; pageviews: number }> }>(
        q('attribution'),
      ),
  });

  const breakdownQuery = useQuery({
    queryKey: ['reports-breakdown', websiteId, range, segmentId],
    enabled: Boolean(websiteId) && openSections.breakdown,
    queryFn: () =>
      api<{ dimension: string; rows: Array<{ dimension: string; value: number }> }>(
        `${q('breakdown')}&dimension=country`,
      ),
  });

  const cohortsListQuery = useQuery({
    queryKey: ['cohorts', websiteId],
    enabled: Boolean(websiteId) && openSections.cohorts,
    queryFn: () =>
      api<
        Array<{
          id: string;
          name: string;
          definition: {
            conditions: Array<{
              field: 'event_name' | 'url_path';
              operator: 'equals' | 'contains';
              value: string;
            }>;
          };
        }>
      >(`/api/websites/${websiteId}/cohorts`),
  });

  useEffect(() => {
    const list = cohortsListQuery.data ?? [];
    if (list.length && !selectedCohortId) setSelectedCohortId(list[0]!.id);
  }, [cohortsListQuery.data, selectedCohortId]);

  const cohortReportQuery = useQuery({
    queryKey: ['cohort-report', selectedCohortId, compareCohortId, range],
    enabled: Boolean(selectedCohortId) && openSections.cohorts,
    queryFn: () => {
      const compareQs = compareCohortId ? `&compareCohortId=${compareCohortId}` : '';
      return api<
        | {
            totalUsers: number;
            series: Array<{ bucket: string; users: number }>;
            name: string;
            definition: { conditions: Array<{ field: string; operator: string; value: string }> };
          }
        | {
            cohortA: { name: string; totalUsers: number; series: Array<{ bucket: string; users: number }> };
            cohortB: { name: string; totalUsers: number; series: Array<{ bucket: string; users: number }> };
          }
      >(`/api/reports/cohort?cohortId=${selectedCohortId}&${rangeQs}${compareQs}`);
    },
  });

  const isCohortCompare =
    cohortReportQuery.data != null && 'cohortA' in cohortReportQuery.data;

  const cohortCompareChartData = useMemo(() => {
    const data = cohortReportQuery.data;
    if (!data || !('cohortA' in data)) return [];
    const buckets = new Set([
      ...(data.cohortA.series ?? []).map((s) => s.bucket),
      ...(data.cohortB.series ?? []).map((s) => s.bucket),
    ]);
    return [...buckets].sort().map((bucket) => ({
      bucket,
      a: data.cohortA.series.find((s) => s.bucket === bucket)?.users ?? 0,
      b: data.cohortB.series.find((s) => s.bucket === bucket)?.users ?? 0,
    }));
  }, [cohortReportQuery.data]);

  const cohortSingleChartData = useMemo(() => {
    const data = cohortReportQuery.data;
    if (!data || 'cohortA' in data) return [];
    return (data.series ?? []).map((s) => ({ bucket: s.bucket, users: s.users }));
  }, [cohortReportQuery.data]);

  const createCohortMutation = useMutation({
    mutationFn: () =>
      api(`/api/websites/${websiteId}/cohorts`, {
        method: 'POST',
        body: JSON.stringify({
          name: cohortName,
          definition: {
            conditions: cohortConditions.filter((c) => c.value.trim()),
            windowStart: cohortWindow.startAt,
            windowEnd: cohortWindow.endAt,
          },
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cohorts', websiteId] });
      setCohortName('');
      setCohortConditions([{ field: 'event_name', operator: 'equals', value: '' }]);
    },
  });

  const saveGoalMutation = useMutation({
    mutationFn: () => {
      const existing = websiteQuery.data?.goalConfig?.goals ?? [];
      const target = parseInt(goalTarget, 10);
      if (!goalEvent.trim() || !target || target < 1) throw new Error(t('goalInvalid'));
      const goals = [
        ...existing.filter((g) => g.event !== goalEvent.trim()),
        { event: goalEvent.trim(), target, period: goalPeriod },
      ];
      return api(`/api/websites/${websiteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ goalConfig: { goals } }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['website', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['reports-goal', websiteId] });
      setGoalEvent('');
      setGoalTarget('');
    },
  });

  const performanceQuery = useQuery({
    queryKey: ['reports-performance', websiteId, range, segmentId],
    enabled: Boolean(websiteId) && openSections.performance,
    queryFn: () =>
      api<{ lcp: number | null; inp: number | null; cls: number | null; fcp: number | null; ttfb: number | null; samples: number }>(
        q('performance'),
      ),
  });

  const funnelChartData = useMemo(
    () => (funnelQuery.data?.steps ?? []).map((s) => ({ name: s.step, count: s.count })),
    [funnelQuery.data?.steps],
  );

  const funnelHasData = useMemo(
    () => (funnelQuery.data?.steps ?? []).some((s) => s.count > 0),
    [funnelQuery.data?.steps],
  );

  const noWebsite = !websitesQuery.isLoading && !(websitesQuery.data ?? []).length;

  return (
    <div className="page page-reports">
      <PageHeader
        title={t('reports')}
        subtitle={t('reportsSubtitle')}
        backTo="/websites"
        backLabel={t('websites')}
      />

      {noWebsite ? (
        <div className="panel empty-state-rich section-gap">
          <h3>{t('noWebsites')}</h3>
          <p className="text-muted">{t('noWebsitesHint')}</p>
        </div>
      ) : (
        <div className="reports-layout">
          <aside className="reports-sidebar">
            <section className="panel reports-sidebar-panel">
              <h2 className="section-title">{t('reportConfig')}</h2>
              <div className="field">
                <Label>{t('dateRange')}</Label>
                <DateRangePicker value={range} onChange={setRange} popover />
              </div>
              <div className="field">
                <Label htmlFor="report-website">{t('website')}</Label>
                <select
                  id="report-website"
                  className="select"
                  value={websiteId}
                  onChange={(e) => setWebsiteId(e.target.value)}
                >
                  {(websitesQuery.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              {(segmentsQuery.data ?? []).length ? (
                <div className="field">
                  <Label htmlFor="report-segment">{t('segment')}</Label>
                  <select
                    id="report-segment"
                    className="select"
                    value={segmentId}
                    onChange={(e) => setSegmentId(e.target.value)}
                  >
                    <option value="">{t('allVisitors')}</option>
                    {(segmentsQuery.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <h3 className="reports-sidebar-subtitle">{t('savedReports')}</h3>
              <form
                className="reports-sidebar-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!savedName.trim() || !websiteId) return;
                  api('/api/reports', {
                    method: 'POST',
                    body: JSON.stringify({
                      websiteId,
                      type: savedType,
                      name: savedName.trim(),
                      parameters: { steps: funnelSteps.split(','), segmentId: segmentId || null },
                    }),
                  }).then(() => {
                    setSavedName('');
                    savedReportsQuery.refetch();
                  });
                }}
              >
                <Input
                  placeholder={t('reportName')}
                  value={savedName}
                  onChange={(e) => setSavedName(e.target.value)}
                />
                <select className="select" value={savedType} onChange={(e) => setSavedType(e.target.value)}>
                  <option value="funnel">{t('funnel')}</option>
                  <option value="retention">{t('retention')}</option>
                  <option value="journey">{t('journey')}</option>
                </select>
                <Button type="submit" variant="primary" size="sm">{t('save')}</Button>
              </form>
              <div className="section-gap">
                {savedReportsQuery.isLoading ? (
                  <SectionDataSkeleton className="" />
                ) : (savedReportsQuery.data ?? []).filter((r) => r.websiteId === websiteId).length === 0 ? (
                  <EmptyState title={t('noSavedReports')} />
                ) : (
                  <ul className="list-plain">
                    {(savedReportsQuery.data ?? [])
                      .filter((r) => r.websiteId === websiteId)
                      .map((r) => (
                        <li key={r.id} className="list-item list-row">
                          <span>
                            {r.name} <span className="badge">{r.type}</span>
                          </span>
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() =>
                              api(`/api/reports/${r.id}`, { method: 'DELETE' }).then(() => savedReportsQuery.refetch())
                            }
                          >
                            {t('delete')}
                          </Button>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              <h3 id="funnel-steps-heading" className="reports-sidebar-subtitle">
                {t('funnel')}
              </h3>
              <div className="field">
                <Input
                  id="funnel-steps"
                  aria-labelledby="funnel-steps-heading"
                  value={funnelSteps}
                  onChange={(e) => setFunnelSteps(e.target.value)}
                  placeholder={t('funnelStepsPlaceholder')}
                />
              </div>
            </section>
          </aside>

          <div className="reports-main">
            <ReportSection title={t('funnel')} variant="flat" skeletonPlacement="none">
              {funnelQuery.isLoading ? (
                <SectionDataSkeleton busy />
              ) : funnelChartData.length === 0 || !funnelHasData ? (
                <EmptyState
                  title={t('noDataInPeriod')}
                  description={funnelChartData.length > 0 ? t('funnelNoDataHint') : t('noDataInPeriodHint')}
                />
              ) : (
                <>
                  <div className="chart-wrap chart-wrap-compact">
                    <ResponsiveContainer>
                      <BarChart data={funnelChartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={100}
                          tick={{ fontSize: 11, fill: chartColors.muted }}
                          stroke={chartColors.border}
                        />
                        <Tooltip
                          contentStyle={{
                            background: chartColors.panel,
                            border: `1px solid ${chartColors.border}`,
                            borderRadius: 8,
                            fontSize: 13,
                            color: chartColors.text,
                          }}
                        />
                        <Bar dataKey="count" fill={chartColors.accent} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="list-plain">
                    {(funnelQuery.data?.steps ?? []).map((s) => (
                      <li key={s.step} className="list-item list-row">
                        <span>{s.step}</span>
                        <span className="list-row-value">
                          {s.count} ({s.rate}%)
                        </span>
                      </li>
                    ))}
                  </ul>
                  {funnelQuery.data ? (
                    <p className="text-muted reports-funnel-conversion">
                      {t('overallConversion')}: {funnelQuery.data.conversion}%
                    </p>
                  ) : null}
                </>
              )}
            </ReportSection>

            <GatedReportSection id="retention" title={t('retentionCohorts')} loading={retentionQuery.isLoading}>
              {(retentionQuery.data?.cohorts ?? []).length === 0 && !retentionQuery.isLoading ? (
                <EmptyState title={t('noDataInPeriod')} />
              ) : (
                <RetentionHeatmap cohorts={retentionQuery.data?.cohorts ?? []} />
              )}
            </GatedReportSection>

            <GatedReportSection id="journey" title={t('userJourneys')} loading={journeyQuery.isLoading}>
              {(journeyQuery.data?.paths ?? []).length === 0 && !journeyQuery.isLoading ? (
                <EmptyState title={t('noDataInPeriod')} />
              ) : (
                <ul className="list-plain">
                  {(journeyQuery.data?.paths ?? []).slice(0, 15).map((p, i) => (
                    <li key={i} className="list-item list-row">
                      <span className="reports-path-mono">{p.path}</span>
                      <strong className="list-row-value">{p.count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </GatedReportSection>

            <GatedReportSection id="attribution" title={t('attribution')} loading={attributionQuery.isLoading}>
              {(attributionQuery.data?.sources ?? []).length === 0 && !attributionQuery.isLoading ? (
                <EmptyState title={t('noDataInPeriod')} />
              ) : (
                <ul className="list-plain">
                  {(attributionQuery.data?.sources ?? []).map((s) => (
                    <li key={s.source} className="list-item list-row">
                      <span>{s.source}</span>
                      <span className="list-row-value">
                        {s.sessions} {t('sessionsCount')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GatedReportSection>

            <GatedReportSection id="breakdown" title={t('breakdownCountry')} loading={breakdownQuery.isLoading}>
              {(breakdownQuery.data?.rows ?? []).length === 0 && !breakdownQuery.isLoading ? (
                <EmptyState title={t('noDataInPeriod')} />
              ) : (
                <ul className="list-plain">
                  {(breakdownQuery.data?.rows ?? []).map((r) => (
                    <li key={r.dimension} className="list-item list-row">
                      <span>{r.dimension}</span>
                      <strong className="list-row-value">{r.value}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </GatedReportSection>

            <GatedReportSection id="performance" title={t('webVitals')} loading={performanceQuery.isLoading}>
              {performanceQuery.data ? (
                <dl className="kv-grid">
                  <dt>LCP</dt>
                  <dd>{performanceQuery.data.lcp ?? '-'} ms</dd>
                  <dt>INP</dt>
                  <dd>{performanceQuery.data.inp ?? '-'} ms</dd>
                  <dt>CLS</dt>
                  <dd>{performanceQuery.data.cls ?? '-'}</dd>
                  <dt>FCP</dt>
                  <dd>{performanceQuery.data.fcp ?? '-'} ms</dd>
                  <dt>TTFB</dt>
                  <dd>{performanceQuery.data.ttfb ?? '-'} ms</dd>
                  <dt>{t('samples')}</dt>
                  <dd>{performanceQuery.data.samples}</dd>
                </dl>
              ) : !performanceQuery.isLoading ? (
                <EmptyState title={t('noDataInPeriod')} />
              ) : null}
            </GatedReportSection>

            <GatedReportSection id="utm" title={t('utmBreakdown')} loading={utmQuery.isLoading}>
              {(utmQuery.data ?? []).length === 0 && !utmQuery.isLoading ? (
                <EmptyState title={t('noDataInPeriod')} />
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('source')}</th>
                        <th>{t('medium')}</th>
                        <th>{t('campaign')}</th>
                        <th className="num">{t('pageviews')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(utmQuery.data ?? []).map((row, i) => (
                        <tr key={i}>
                          <td>{row.source}</td>
                          <td>{row.medium}</td>
                          <td>{row.campaign}</td>
                          <td className="num">{row.pageviews}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GatedReportSection>

            <GatedReportSection id="revenue" title={t('revenue')} loading={revenueQuery.isLoading}>
              {(revenueQuery.data?.byEvent ?? []).length === 0 && !revenueQuery.isLoading ? (
                <EmptyState title={t('noDataInPeriod')} />
              ) : (
                <ul className="list-plain">
                  {(revenueQuery.data?.byEvent ?? []).map((row) => (
                    <li key={`${row.eventName}-${row.currency}`} className="list-item list-row">
                      <span>
                        {row.eventName} ({row.currency})
                      </span>
                      <strong className="list-row-value">
                        {row.total.toFixed(2)} · {row.transactions} tx
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </GatedReportSection>

            <GatedReportSection id="cohorts" title={t('cohorts')} loading={cohortReportQuery.isLoading}>
              <div className="field">
                <Label htmlFor="cohort-select">{t('cohortSelect')}</Label>
                <select
                  id="cohort-select"
                  className="select"
                  value={selectedCohortId}
                  onChange={(e) => setSelectedCohortId(e.target.value)}
                >
                  {(cohortsListQuery.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <Label htmlFor="cohort-compare">{t('cohortCompare')}</Label>
                <select
                  id="cohort-compare"
                  className="select"
                  value={compareCohortId}
                  onChange={(e) => setCompareCohortId(e.target.value)}
                >
                  <option value="">{t('cohortNone')}</option>
                  {(cohortsListQuery.data ?? [])
                    .filter((c) => c.id !== selectedCohortId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
              {cohortReportQuery.data &&
              (isCohortCompare ? cohortCompareChartData.length : cohortSingleChartData.length) > 0 ? (
                <>
                  {'cohortA' in cohortReportQuery.data ? (
                    <p className="text-muted">
                      {cohortReportQuery.data.cohortA.name}: {cohortReportQuery.data.cohortA.totalUsers} ·{' '}
                      {cohortReportQuery.data.cohortB.name}: {cohortReportQuery.data.cohortB.totalUsers}
                    </p>
                  ) : (
                    <p className="text-muted">
                      {t('cohortTotal')}: {cohortReportQuery.data.totalUsers}
                    </p>
                  )}
                  <div className="chart-wrap chart-wrap-compact">
                    <ResponsiveContainer>
                      {isCohortCompare ? (
                        <LineChart data={cohortCompareChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} />
                          <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                          <YAxis tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                          <Tooltip
                            contentStyle={{
                              background: chartColors.panel,
                              border: `1px solid ${chartColors.border}`,
                              borderRadius: 8,
                              fontSize: 13,
                              color: chartColors.text,
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="a"
                            name={(cohortReportQuery.data as { cohortA: { name: string } }).cohortA.name}
                            stroke={chartColors.accent}
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="b"
                            name={(cohortReportQuery.data as { cohortB: { name: string } }).cohortB.name}
                            stroke={chartColors.muted}
                            dot={false}
                          />
                        </LineChart>
                      ) : (
                        <LineChart data={cohortSingleChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} />
                          <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                          <YAxis tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                          <Tooltip
                            contentStyle={{
                              background: chartColors.panel,
                              border: `1px solid ${chartColors.border}`,
                              borderRadius: 8,
                              fontSize: 13,
                              color: chartColors.text,
                            }}
                          />
                          <Line type="monotone" dataKey="users" name={t('cohortActiveDaily')} stroke={chartColors.accent} dot={false} />
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </>
              ) : !cohortReportQuery.isLoading ? (
                <EmptyState title={t('noCohorts')} />
              ) : null}
              <div className="panel" style={{ marginTop: '1rem' }}>
                <h3 className="section-title">{t('createCohort')}</h3>
                <div className="field">
                  <Label htmlFor="cohort-name">{t('name')}</Label>
                  <Input id="cohort-name" value={cohortName} onChange={(e) => setCohortName(e.target.value)} />
                </div>
                <p className="text-muted">{t('cohortConditions')}</p>
                <div className="field">
                  <Label>{t('cohortDateWindow')}</Label>
                  <DateRangePicker value={cohortWindow} onChange={setCohortWindow} />
                </div>
                {cohortConditions.map((cond, idx) => (
                  <div key={idx} className="stats-toolbar" style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <select
                      className="select"
                      value={cond.field}
                      onChange={(e) => {
                        const next = [...cohortConditions];
                        next[idx] = { ...cond, field: e.target.value as CohortCondition['field'] };
                        setCohortConditions(next);
                      }}
                    >
                      <option value="event_name">{t('cohortEvent')}</option>
                      <option value="url_path">{t('cohortPath')}</option>
                    </select>
                    <select
                      className="select"
                      value={cond.operator}
                      onChange={(e) => {
                        const next = [...cohortConditions];
                        next[idx] = { ...cond, operator: e.target.value as CohortCondition['operator'] };
                        setCohortConditions(next);
                      }}
                    >
                      <option value="equals">{t('cohortEquals')}</option>
                      <option value="contains">{t('cohortContains')}</option>
                    </select>
                    <Input
                      value={cond.value}
                      onChange={(e) => {
                        const next = [...cohortConditions];
                        next[idx] = { ...cond, value: e.target.value };
                        setCohortConditions(next);
                      }}
                      placeholder={cond.field === 'event_name' ? 'signup' : '/pricing'}
                    />
                    {cohortConditions.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCohortConditions(cohortConditions.filter((_, i) => i !== idx))}
                      >
                        {t('cohortRemoveCondition')}
                      </Button>
                    ) : null}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setCohortConditions([
                      ...cohortConditions,
                      { field: 'event_name', operator: 'equals', value: '' },
                    ])
                  }
                >
                  {t('cohortAddCondition')}
                </Button>
                <div style={{ marginTop: '0.75rem' }}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={
                      !cohortName ||
                      !cohortConditions.some((c) => c.value.trim()) ||
                      createCohortMutation.isPending
                    }
                    onClick={() => createCohortMutation.mutate()}
                  >
                    {t('createCohort')}
                  </Button>
                </div>
              </div>
            </GatedReportSection>

            <GatedReportSection id="goals" title={t('goals')} loading={goalQuery.isLoading}>
              {(goalQuery.data ?? []).length === 0 && !goalQuery.isLoading ? (
                <EmptyState title={t('noDataInPeriod')} />
              ) : (
                <ul className="list-plain goals-list">
                  {(goalQuery.data ?? []).map((row) => (
                    <li key={row.event} className="list-item goal-row">
                      <div className="goal-row-head">
                        <span>{row.event}</span>
                        <strong className="list-row-value">
                          {row.count}
                          {row.target != null ? ` / ${row.target}` : ''}
                          {row.periodLabel
                            ? ` (${t(`goalPeriod_${row.periodLabel}`)})`
                            : row.period
                              ? ` (${row.period})`
                              : ''}
                        </strong>
                      </div>
                      {row.periodLabel && row.periodStart != null ? (
                        <p className="text-muted" style={{ fontSize: '0.8125rem', margin: '0.25rem 0' }}>
                          {t('goalPeriodUsed')}:{' '}
                          {new Date(row.periodStart).toLocaleDateString()} –{' '}
                          {new Date(row.periodEnd ?? Date.now()).toLocaleDateString()}
                        </p>
                      ) : null}
                      {row.progress != null && row.target != null ? (
                        <div className="goal-progress-track">
                          <div className="goal-progress-bar" style={{ width: `${row.progress}%` }} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <div className="panel goal-config-panel">
                <h3 className="section-title">{t('goalConfigure')}</h3>
                <div className="stats-toolbar" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                  <Input
                    placeholder={t('goalEventName')}
                    value={goalEvent}
                    onChange={(e) => setGoalEvent(e.target.value)}
                  />
                  <Input
                    type="number"
                    min={1}
                    placeholder={t('goalTarget')}
                    value={goalTarget}
                    onChange={(e) => setGoalTarget(e.target.value)}
                  />
                  <select
                    className="select"
                    value={goalPeriod}
                    onChange={(e) => setGoalPeriod(e.target.value as 'daily' | 'weekly' | 'monthly')}
                  >
                    <option value="daily">{t('emailDaily')}</option>
                    <option value="weekly">{t('emailWeekly')}</option>
                    <option value="monthly">{t('emailMonthly')}</option>
                  </select>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={saveGoalMutation.isPending}
                    onClick={() => saveGoalMutation.mutate()}
                  >
                    {t('save')}
                  </Button>
                </div>
              </div>
            </GatedReportSection>
          </div>
        </div>
      )}
    </div>
  );
}
