import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, Line, LineChart } from 'recharts';
import {
  CheckCheck,
  CheckCircle2,
  Clock,
  Flag,
  FlaskConical,
  Inbox,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  Wrench,
} from 'lucide-react';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { ChartLegend } from '../components/ChartLegend';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import {
  ExperimentMetricsEditor,
  cleanMetric,
  emptyMetric,
  isMetricComplete,
  metricLabel,
  parseMdeInput,
} from '../components/ExperimentMetricsEditor';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { MasterDetailLayout, MasterDetailListItem, MasterDetailPane } from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { formatShare, tf, utcDay } from '../components/product/format';
import { LiftInterval, liftDomain } from '../components/product/LiftInterval';
import { FormErrors, FormSection } from '../components/product/ProductForm';
import { ProductListHeader, ProductMasterDetailSkeleton, ProductNoMatches } from '../components/product/ProductList';
import { ProductCallout, ProductNote, ProductSection, type CalloutTone } from '../components/product/ProductSection';
import { ShortDate } from '../components/product/ProductTime';
import { SessionLink } from '../components/product/SessionLink';
import { SeriesKey } from '../components/product/SplitBar';
import { experimentStatus } from '../components/product/status';
import { ResourceEditDialog } from '../components/ResourceEditDialog';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Textarea } from '../components/ui/textarea';
import {
  api,
  type Experiment,
  type ExperimentApplyResult,
  type ExperimentInterval,
  type ExperimentMetric,
  type ExperimentMetricVariantResult,
  type ExperimentResults,
  type FeatureFlag,
} from '../lib/api';
import { BAR_MARK, lineMark } from '../lib/chartMarks';
import { formatNumber, formatPercent, formatShortDate, formatShortDateTime } from '../lib/format';
import { pluralKey, t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

type StatsMethod = 'frequentist' | 'bayesian';

type MetricsDraft = {
  primary: ExperimentMetric;
  secondary: ExperimentMetric[];
  mde: string;
};

function metricsDraftFrom(experiment?: Experiment | null): MetricsDraft {
  return {
    primary: experiment?.primaryMetric ?? emptyMetric(),
    secondary: experiment?.secondaryMetrics ?? [],
    mde: experiment?.minimumDetectableEffect == null ? '' : String(experiment.minimumDetectableEffect),
  };
}

function metricsPayload(draft: MetricsDraft) {
  const mde = parseMdeInput(draft.mde);
  return {
    primaryMetric: cleanMetric(draft.primary),
    secondaryMetrics: draft.secondary.map(cleanMetric),
    minimumDetectableEffect: mde === 'invalid' ? null : mde,
  };
}

/** Fraction → signed percent text. */
function formatLift(lift: number | null | undefined) {
  if (lift == null) return '–';
  return formatPercent(lift * 100, { digits: 1, signed: true });
}

function formatLiftInterval(interval: ExperimentInterval | null | undefined) {
  if (!interval) return '–';
  return `${formatLift(interval[0])} … ${formatLift(interval[1])}`;
}

function formatMetricValue(metric: ExperimentMetric, value: number | null | undefined) {
  if (value == null) return '–';
  if (metric.type === 'conversion') return formatPercent(value * 100, { digits: 2 });
  return formatNumber(value, { maximumFractionDigits: 2 });
}

function formatPValue(pValue: number | null) {
  if (pValue == null) return '–';
  if (pValue < 0.001) return 'p < 0.001';
  return `p = ${formatNumber(pValue, { maximumFractionDigits: 3 })}`;
}

/** A probability as a percent that never claims certainty (">99.9%"). */
function formatProbability(probability: number | null | undefined) {
  if (probability == null) return '–';
  if (probability > 0.999) return `>${formatPercent(99.9, { digits: 1 })}`;
  if (probability < 0.001) return `<${formatPercent(0.1, { digits: 1 })}`;
  return formatPercent(probability * 100, { digits: 1 });
}

function valueHeader(metric: ExperimentMetric) {
  if (metric.type === 'conversion') return t('experimentConversionRate');
  if (metric.type === 'count') return t('experimentMeanPerUnit');
  if (metric.type === 'property_sum') return t('experimentSumPerUnit');
  return t('experimentMeanValue');
}

/* ── Create / edit dialog ──────────────────────────────────────────────────── */

function ExperimentDialog({
  websiteId,
  experiment,
  flags,
  saving,
  error,
  onClose,
  onSave,
}: {
  websiteId: string;
  /** Null creates a draft experiment. */
  experiment: Experiment | null;
  flags: FeatureFlag[];
  saving: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState({
    name: experiment?.name ?? '',
    description: experiment?.description ?? '',
    featureFlagId: experiment?.featureFlagId ?? '',
    status: experiment?.status ?? ('draft' as Experiment['status']),
  });
  const [metrics, setMetrics] = useState<MetricsDraft>(() => metricsDraftFrom(experiment));
  const [showErrors, setShowErrors] = useState(false);
  const flag = flags.find((item) => item.id === draft.featureFlagId);

  const errors: string[] = [];
  if (!draft.name.trim()) errors.push(t('productExpErrorName'));
  if (!draft.featureFlagId) errors.push(t('productExpErrorFlag'));
  if (!isMetricComplete(metrics.primary) || !metrics.secondary.every(isMetricComplete)) {
    errors.push(t('productExpErrorMetric'));
  }
  if (parseMdeInput(metrics.mde) === 'invalid') errors.push(t('productExpErrorMde'));

  const title = experiment ? t('experimentEdit') : t('createExperiment');
  return (
    <ResourceEditDialog
      title={title}
      description={experiment ? undefined : t('productExpCreateLead')}
      ariaLabel={title}
      panelClassName="product-dialog product-dialog--wide"
      bodyClassName="product-form"
      saving={saving}
      error={error}
      canSave={!saving}
      saveLabel={experiment ? undefined : t('createExperiment')}
      onClose={onClose}
      onSave={() => {
        if (errors.length) {
          setShowErrors(true);
          return;
        }
        onSave({
          name: draft.name.trim(),
          description: draft.description.trim(),
          featureFlagId: draft.featureFlagId,
          status: draft.status,
          ...metricsPayload(metrics),
        });
      }}
    >
      <div className="product-form-grid">
        <div className="field product-field">
          <Label htmlFor="experiment-dialog-name">{t('name')}</Label>
          <Input
            id="experiment-dialog-name"
            value={draft.name}
            placeholder={t('experimentNamePlaceholder')}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
        </div>
        <div className="field product-field">
          <Label htmlFor="experiment-dialog-flag">{t('featureFlag')}</Label>
          <select
            id="experiment-dialog-flag"
            className="select"
            value={draft.featureFlagId}
            onChange={(event) => setDraft((prev) => ({ ...prev, featureFlagId: event.target.value }))}
          >
            <option value="">{t('selectFeatureFlag')}</option>
            {flags.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.key})
              </option>
            ))}
          </select>
          {flag ? (
            <p className="field-hint">
              {flag.variants.length
                ? tf('productExpFlagVariants', {
                    variants: flag.variants.map((variant) => `${variant.key} ${variant.weight}%`).join(' · '),
                  })
                : t('productExpFlagBoolean')}
            </p>
          ) : null}
        </div>
        {experiment ? (
          <div className="field product-field">
            <Label htmlFor="experiment-dialog-status">{t('status')}</Label>
            <select
              id="experiment-dialog-status"
              className="select"
              value={draft.status}
              onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value as Experiment['status'] }))}
            >
              <option value="draft">{t('experimentStatus_draft')}</option>
              <option value="running">{t('experimentStatus_running')}</option>
              <option value="paused">{t('experimentStatus_paused')}</option>
              <option value="completed">{t('experimentStatus_completed')}</option>
            </select>
          </div>
        ) : null}
        <div className="field product-field product-form-wide">
          <Label htmlFor="experiment-dialog-description">{t('productExpHypothesis')}</Label>
          <Textarea
            id="experiment-dialog-description"
            rows={2}
            value={draft.description}
            placeholder={t('experimentDescriptionPlaceholder')}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
      </div>
      <ExperimentMetricsEditor
        websiteId={websiteId}
        idPrefix="experiment-dialog"
        primary={metrics.primary}
        secondary={metrics.secondary}
        minimumDetectableEffect={metrics.mde}
        onPrimaryChange={(primary) => setMetrics((prev) => ({ ...prev, primary }))}
        onSecondaryChange={(secondary) => setMetrics((prev) => ({ ...prev, secondary }))}
        onMinimumDetectableEffectChange={(mde) => setMetrics((prev) => ({ ...prev, mde }))}
      />
      {showErrors ? (
        <FormSection>
          <FormErrors errors={errors} />
        </FormSection>
      ) : null}
    </ResourceEditDialog>
  );
}

/* ── Results ───────────────────────────────────────────────────────────────── */

function MetricTable({
  role,
  metric,
  rows,
  method,
  colors,
}: {
  role: 'primary' | 'secondary';
  metric: ExperimentMetric;
  rows: ExperimentMetricVariantResult[];
  method: StatsMethod;
  colors: Map<string, string>;
}) {
  const intervals = rows.map((row) =>
    method === 'frequentist' ? row.comparison?.frequentist.liftInterval : row.comparison?.bayesian.liftInterval,
  );
  const domain = liftDomain(intervals);
  return (
    <div className="product-metric" aria-label={metricLabel(metric)}>
      <div className="product-metric-head">
        <StatusBadge tone={role === 'primary' ? 'info' : 'neutral'} dot={false}>
          {role === 'primary' ? t('experimentPrimaryMetric') : t('experimentSecondaryMetric')}
        </StatusBadge>
        <h4 className="product-metric-title">{metricLabel(metric)}</h4>
      </div>
      <div className="table-scroll">
        <table className="data-table product-table product-metric-table">
          <colgroup>
            <col className="product-col-variant" />
            <col className="product-col-users" />
            <col className="product-col-value" />
            <col className="product-col-lift" />
            <col className="product-col-interval" />
            <col className="product-col-significance" />
          </colgroup>
          <thead>
            <tr>
              <th>{t('variant')}</th>
              <th className="num">{metric.type === 'property_mean' ? t('experimentUnitsWithValue') : t('experimentUnits')}</th>
              <th className="num">{valueHeader(metric)}</th>
              <th className="num">{t('experimentLift')}</th>
              <th>{method === 'frequentist' ? t('experimentConfidenceInterval') : t('experimentCredibleInterval')}</th>
              <th className="num">{method === 'frequentist' ? t('experimentSignificance') : t('experimentProbabilityToBeat')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const comparison = row.comparison;
              const interval = intervals[index];
              const probability = comparison?.bayesian.probabilityToBeatControl ?? null;
              const significant =
                method === 'frequentist'
                  ? Boolean(comparison?.frequentist.significant)
                  : probability != null && (probability >= 0.95 || probability <= 0.05);
              const tone = !significant ? 'neutral' : (comparison?.difference ?? 0) > 0 ? 'success' : 'danger';
              return (
                <tr key={row.variant}>
                  <td>
                    <span className="product-series-cell">
                      <SeriesKey color={colors.get(row.variant) ?? 'var(--product-other)'} />
                      <span className="mono">{row.variant}</span>
                    </span>
                  </td>
                  <td className="num">{formatNumber(row.sampleSize)}</td>
                  <td className="num">
                    {formatMetricValue(metric, row.value)}
                    {metric.type === 'conversion' ? (
                      <span className="product-cell-sub">
                        {formatNumber(row.total)} / {formatNumber(row.sampleSize)}
                      </span>
                    ) : null}
                  </td>
                  <td className="num product-lift-cell">
                    {row.baseline ? <span className="text-muted">{t('experimentBaseline')}</span> : formatLift(comparison?.lift)}
                  </td>
                  <td className="product-interval-cell">
                    {row.baseline || !interval ? (
                      <span className="text-muted">–</span>
                    ) : (
                      <>
                        <LiftInterval
                          interval={interval}
                          lift={comparison?.lift}
                          domain={domain}
                          label={formatLiftInterval(interval)}
                        />
                        <span className="product-cell-sub">{formatLiftInterval(interval)}</span>
                      </>
                    )}
                  </td>
                  <td className="num">
                    {row.baseline || !comparison ? (
                      <span className="text-muted">–</span>
                    ) : method === 'frequentist' ? (
                      <>
                        <StatusBadge tone={tone} dot={tone !== 'neutral'}>
                          {significant ? t('experimentSignificant') : t('experimentNotSignificant')}
                        </StatusBadge>
                        <span className="product-cell-sub">{formatPValue(comparison.frequentist.pValue)}</span>
                      </>
                    ) : (
                      formatProbability(probability)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function guidanceText(results: ExperimentResults) {
  const guidance = results.guidance;
  if (!guidance) return null;
  const primary = results.metrics[0]?.metric;
  const mde = formatPercent(guidance.minimumDetectableEffect * 100, { digits: 1 });
  if (guidance.requiredUnitsPerVariant == null) {
    return t('experimentGuidanceUnavailable').replace('{mde}', mde);
  }
  const lines = [
    t('experimentGuidanceRequired')
      .replace('{mde}', mde)
      .replace('{baseline}', primary ? formatMetricValue(primary, guidance.baseline) : '–')
      .replace('{required}', formatNumber(guidance.requiredUnitsPerVariant))
      .replace('{current}', formatNumber(guidance.currentUnitsPerVariant)),
  ];
  if (guidance.detectableEffect != null) {
    lines.push(
      t('experimentGuidanceDetectable').replace('{effect}', formatPercent(guidance.detectableEffect * 100, { digits: 1 })),
    );
  }
  if (guidance.estimatedDaysRemaining === 0) lines.push(t('experimentGuidanceReached'));
  else if (guidance.estimatedDaysRemaining != null) {
    lines.push(t('experimentGuidanceDays').replace('{days}', formatNumber(guidance.estimatedDaysRemaining)));
  }
  return lines.join(' ');
}

const DECISION_TONE: Record<ExperimentResults['summary']['decision'], CalloutTone> = {
  ship_variant: 'success',
  keep_control: 'success',
  keep_collecting: 'neutral',
  fix_setup: 'danger',
  no_data: 'neutral',
};

function DecisionCallout({
  results,
  canApply,
  applying,
  applyError,
  onApply,
}: {
  results: ExperimentResults;
  canApply: boolean;
  applying: boolean;
  applyError: Error | null;
  onApply: () => void;
}) {
  const { summary } = results;
  const primary = results.metrics[0];
  const metricName = primary ? metricLabel(primary.metric) : '';
  const winnerRow = primary?.variants.find((row) => row.variant === summary.significantVariant);
  const loserRow = primary?.variants.find(
    (row) => !row.baseline && row.comparison?.frequentist.significant && (row.comparison?.difference ?? 0) < 0,
  );
  const shown = new Set<string>(['significant_variant']);
  if (summary.decision === 'no_data') shown.add('no_exposures');

  let title = t(`experimentDecision_${summary.decision}`);
  let body: string | null = null;
  let icon = <Clock strokeWidth={2} aria-hidden />;
  if (summary.decision === 'ship_variant' && summary.significantVariant) {
    title = tf('productExpShipVariant', { variant: summary.significantVariant });
    body = tf('productExpShipBody', {
      variant: summary.significantVariant,
      metric: metricName,
      lift: formatLift(winnerRow?.comparison?.lift ?? summary.leaderLift),
      interval: formatLiftInterval(winnerRow?.comparison?.frequentist.liftInterval),
      probability: formatProbability(winnerRow?.comparison?.bayesian.probabilityToBeatControl ?? summary.bayesianLeaderProbability),
    });
    icon = <CheckCircle2 strokeWidth={2} aria-hidden />;
  } else if (summary.decision === 'keep_control') {
    body = loserRow
      ? tf('productExpKeepControlBody', { variant: loserRow.variant, metric: metricName, lift: formatLift(loserRow.comparison?.lift) })
      : t('experimentDiagnostic_variant_worse');
    shown.add('variant_worse');
    icon = <CheckCircle2 strokeWidth={2} aria-hidden />;
  } else if (summary.decision === 'keep_collecting') {
    const days = results.guidance?.estimatedDaysRemaining;
    body =
      days != null && days > 0
        ? tf('productExpCollectBody', { days: formatNumber(days) })
        : t('experimentDiagnostic_no_significant_winner');
    shown.add('no_significant_winner');
  } else if (summary.decision === 'fix_setup') {
    body = t('productExpFixBody');
    icon = <Wrench strokeWidth={2} aria-hidden />;
  } else {
    body = t('experimentNoResults');
    icon = <Inbox strokeWidth={2} aria-hidden />;
  }
  const diagnostics = summary.diagnostics.filter((item) => !shown.has(item.code));

  return (
    <ProductCallout
      tone={DECISION_TONE[summary.decision]}
      icon={icon}
      title={title}
      role="status"
      actions={
        canApply && summary.decision === 'ship_variant' ? (
          <Button type="button" variant="primary" size="sm" disabled={applying} onClick={onApply}>
            {applying ? t('saving') : t('experimentApplyWinner')}
          </Button>
        ) : null
      }
    >
      {body}
      {diagnostics.length ? (
        <div className="product-badges">
          {diagnostics.map((item) => (
            <StatusBadge
              key={item.code}
              tone={item.level === 'error' ? 'danger' : item.level === 'warning' ? 'warning' : item.level === 'success' ? 'success' : 'neutral'}
            >
              {t(`experimentDiagnostic_${item.code}`)}
            </StatusBadge>
          ))}
        </div>
      ) : null}
      {applyError ? <p className="text-danger product-callout-error">{applyError.message}</p> : null}
    </ProductCallout>
  );
}

function ExperimentKpis({ results }: { results: ExperimentResults }) {
  const { summary, guidance } = results;
  const leaderIsVariant = summary.leaderVariant && summary.leaderVariant !== summary.controlVariant;
  const progress =
    guidance?.requiredUnitsPerVariant && guidance.requiredUnitsPerVariant > 0
      ? Math.min(100, (guidance.currentUnitsPerVariant / guidance.requiredUnitsPerVariant) * 100)
      : null;
  return (
    <KpiStrip inline columns={4}>
      <KpiCell
        label={t('experimentUnits')}
        value={formatNumber(summary.totalUnits)}
        hint={results.variants.map((row) => `${row.variant} ${formatShare(row.share * 100)}`).join(' · ') || undefined}
      />
      <KpiCell
        label={t('productExpLift')}
        value={leaderIsVariant ? formatLift(summary.leaderLift) : '–'}
        hint={leaderIsVariant ? tf('productExpVsControl', { variant: summary.leaderVariant! }) : t('productExpNoLeader')}
      />
      <KpiCell
        label={t('experimentProbabilityToBeat')}
        value={formatProbability(summary.bayesianLeaderProbability)}
        hint={summary.bayesianLeader ?? undefined}
      />
      <KpiCell
        label={t('productExpSampleProgress')}
        value={progress == null ? '–' : formatShare(progress)}
        hint={
          progress == null
            ? t('productExpSampleUnknown')
            : guidance?.estimatedDaysRemaining === 0 || progress >= 100
              ? t('experimentGuidanceReached')
              : guidance?.estimatedDaysRemaining != null
                ? tf('productExpDaysLeft', { days: formatNumber(guidance.estimatedDaysRemaining) })
                : tf('productExpOfPlanned', { required: formatNumber(guidance!.requiredUnitsPerVariant!) })
        }
      />
    </KpiStrip>
  );
}

type TrendView = 'metric' | 'units';

function ExperimentTrend({ results, colors }: { results: ExperimentResults; colors: Map<string, string> }) {
  const chartColors = useChartColors();
  const [view, setView] = useState<TrendView>('metric');
  const primary = results.metrics[0]?.metric ?? results.experiment.primaryMetric;
  const conversion = primary.type === 'conversion';
  const variants = results.variants.map((row) => row.variant);
  const resolved = (variant: string) => {
    const index = variants.indexOf(variant);
    return index >= 0 && index < 6 ? chartColors.palette[index] || chartColors.accent : chartColors.muted;
  };
  const data = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const row of results.trend) {
      const entry = byDate.get(row.date) ?? { x: formatShortDate(utcDay(row.date), { timeZone: 'UTC' }) };
      if (row.value != null) entry[`m:${row.variant}`] = conversion ? row.value * 100 : row.value;
      entry[`u:${row.variant}`] = row.units;
      byDate.set(row.date, entry);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry);
  }, [results.trend, conversion]);

  if (data.length < 2) return null;
  const legend = variants.map((variant) => ({
    label: variant,
    color: colors.get(variant) ?? 'var(--product-other)',
    shape: view === 'units' ? ('box' as const) : ('line' as const),
  }));
  const metricFormatter = (value: number) =>
    conversion
      ? formatPercent(value, { digits: Number.isInteger(value) || value >= 10 ? 0 : 1 })
      : formatNumber(value, { maximumFractionDigits: 2 });

  return (
    <ProductSection
      title={t('productExpTrendTitle')}
      description={view === 'metric' ? tf('productExpTrendMetricLead', { metric: metricLabel(primary) }) : t('productExpTrendUnitsLead')}
      actions={
        <>
          <ChartLegend items={legend} />
          <div className="segmented" role="group" aria-label={t('productExpTrendTitle')}>
            <button type="button" aria-pressed={view === 'metric'} onClick={() => setView('metric')}>
              {t('productExpTrendMetric')}
            </button>
            <button type="button" aria-pressed={view === 'units'} onClick={() => setView('units')}>
              {t('experimentNewUnits')}
            </button>
          </div>
        </>
      }
    >
      <div className="product-chart">
        {view === 'metric' ? (
          <AnalyticsChart
            Chart={LineChart}
            data={data}
            responsive={{ height: 220 }}
            valueFormatter={metricFormatter}
            xAxis={{ dataKey: 'x', interval: 'preserveStartEnd', minTickGap: 32 }}
            yAxis={{ allowDecimals: !conversion }}
          >
            {variants.map((variant) => (
              <Line
                key={variant}
                dataKey={`m:${variant}`}
                name={variant}
                stroke={resolved(variant)}
                connectNulls
                {...lineMark(chartColors.panel)}
              />
            ))}
          </AnalyticsChart>
        ) : (
          <AnalyticsChart
            Chart={BarChart}
            data={data}
            responsive={{ height: 220 }}
            xAxis={{ dataKey: 'x', interval: 'preserveStartEnd', minTickGap: 32 }}
          >
            {variants.map((variant) => (
              <Bar key={variant} dataKey={`u:${variant}`} name={variant} fill={resolved(variant)} {...BAR_MARK} maxBarSize={12} />
            ))}
          </AnalyticsChart>
        )}
      </div>
    </ProductSection>
  );
}

function ExperimentResultsView({
  websiteId,
  experiment,
  canEdit,
}: {
  websiteId: string;
  experiment: Experiment;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<StatsMethod>('frequentist');
  const resultsQuery = useQuery({
    queryKey: ['experiment-results', websiteId, experiment.id],
    queryFn: () => api<ExperimentResults>(`/api/websites/${websiteId}/experiments/${experiment.id}/results`),
  });
  const applyMutation = useMutation({
    mutationFn: () =>
      api<ExperimentApplyResult>(`/api/websites/${websiteId}/experiments/${experiment.id}/apply`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['experiment-results', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['feature-flags', websiteId] });
    },
  });

  const results = resultsQuery.data;
  const colors = useMemo(
    () =>
      new Map(
        (results?.variants ?? []).map((row, index) => [
          row.variant,
          index < 6 ? `var(--chart-${index + 1})` : 'var(--product-other)',
        ]),
      ),
    [results?.variants],
  );

  if (resultsQuery.isLoading && !results) {
    return (
      <div aria-busy className="product-results-loading">
        <Skeleton className="h-16 w-full" />
        <div className="product-skeleton-kpis">
          <KpiStripSkeleton cells={4} inline />
        </div>
        <Skeleton className="mt-5 h-[220px] w-full" />
      </div>
    );
  }
  if (resultsQuery.isError || !results) {
    return (
      <DataViewState error={resultsQuery.error ?? t('requestFailed')} onRetry={() => resultsQuery.refetch()}>
        {null}
      </DataViewState>
    );
  }

  const { summary } = results;
  const guidance = guidanceText(results);

  return (
    <>
      {results.srm?.status === 'mismatch' ? (
        <ProductCallout tone="danger" title={t('experimentSrmTitle')} role="alert">
          {t('experimentSrmBody')
            .replace('{pValue}', formatPValue(results.srm.pValue))
            .replace(
              '{split}',
              results.variants
                .filter((row) => row.expectedShare != null)
                .map(
                  (row) =>
                    `${row.variant} ${formatPercent(row.share * 100, { digits: 1 })} / ${formatPercent(
                      row.expectedShare! * 100,
                      { digits: 1 },
                    )}`,
                )
                .join(', '),
            )}
        </ProductCallout>
      ) : null}
      <DecisionCallout
        results={results}
        canApply={canEdit && experiment.status !== 'completed'}
        applying={applyMutation.isPending}
        applyError={applyMutation.error as Error | null}
        onApply={() => applyMutation.mutate()}
      />
      <div className="product-kpi-gap">
        <ExperimentKpis results={results} />
      </div>
      {results.srm?.status === 'not_applicable' && results.srm.reason ? (
        <ProductNote className="product-kpi-note">{t(`experimentSrmSkipped_${results.srm.reason}`)}</ProductNote>
      ) : null}
      {summary.excludedUnits > 0 ? (
        <ProductNote className="product-kpi-note">
          {t('experimentExcludedUnits').replace('{count}', formatNumber(summary.excludedUnits))}
        </ProductNote>
      ) : null}

      <ExperimentTrend results={results} colors={colors} />

      <ProductSection
        title={t('productExpMetrics')}
        description={method === 'frequentist' ? t('experimentMethodFrequentistHint') : t('experimentMethodBayesianHint')}
        actions={
          summary.totalUnits > 0 ? (
            <div className="segmented" role="group" aria-label={t('experimentStatsMethod')}>
              <button type="button" aria-pressed={method === 'frequentist'} onClick={() => setMethod('frequentist')}>
                {t('experimentMethodFrequentist')}
              </button>
              <button type="button" aria-pressed={method === 'bayesian'} onClick={() => setMethod('bayesian')}>
                {t('experimentMethodBayesian')}
              </button>
            </div>
          ) : null
        }
      >
        {summary.totalUnits > 0 ? (
          <div className="product-metric-list">
            {results.metrics.map((item, index) => (
              <MetricTable
                key={`${index}-${item.metric.type}-${item.metric.event}-${item.metric.property ?? ''}`}
                role={item.role}
                metric={item.metric}
                rows={item.variants}
                method={method}
                colors={colors}
              />
            ))}
          </div>
        ) : (
          <p className="product-muted-line">{t('experimentNoResults')}</p>
        )}
        {guidance ? <ProductNote>{guidance}</ProductNote> : null}
      </ProductSection>

      {results.recent.length ? (
        <ProductSection title={t('experimentRecentSamples')} description={t('productExpRecentLead')}>
          <div className="table-scroll">
            <table className="data-table product-table">
              <thead>
                <tr>
                  <th>{t('productExposed')}</th>
                  <th>{t('variant')}</th>
                  <th>{t('page')}</th>
                  <th>{t('experimentConverted')}</th>
                  <th>{t('session')}</th>
                </tr>
              </thead>
              <tbody>
                {results.recent.slice(0, 10).map((item) => (
                  <tr key={item.id}>
                    <td className="text-muted product-nowrap">
                      <ShortDate value={item.exposedAt} withTime />
                    </td>
                    <td>
                      <span className="product-series-cell">
                        <SeriesKey color={colors.get(item.variant) ?? 'var(--product-other)'} />
                        <span className="mono">{item.variant}</span>
                      </span>
                    </td>
                    <td className="mono product-path-cell">{item.urlPath || '/'}</td>
                    <td>
                      {item.converted ? (
                        <StatusBadge tone="success" title={item.convertedAt ? formatShortDateTime(item.convertedAt) : undefined}>
                          {t('yes')}
                        </StatusBadge>
                      ) : (
                        <StatusBadge>{t('no')}</StatusBadge>
                      )}
                    </td>
                    <td>
                      <SessionLink websiteId={websiteId} sessionId={item.sessionId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ProductSection>
      ) : null}
    </>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function WebsiteExperimentsPage() {
  const confirm = useConfirm();
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId, 'experiments');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  /** null = closed, 'new' = create dialog, otherwise the experiment being edited. */
  const [dialog, setDialog] = useState<Experiment | 'new' | null>(null);

  const flagsQuery = useQuery({
    queryKey: ['feature-flags', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<FeatureFlag[]>(`/api/websites/${websiteId}/feature-flags`),
  });

  const experimentsQuery = useQuery({
    queryKey: ['experiments', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Experiment[]>(`/api/websites/${websiteId}/experiments`),
  });

  function selectExperiment(id: string, replace = false) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('experiment', id);
        return next;
      },
      { replace },
    );
  }

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Experiment>(`/api/websites/${websiteId}/experiments`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (experiment) => {
      setDialog(null);
      setSearch('');
      selectExperiment(experiment.id, true);
      queryClient.invalidateQueries({ queryKey: ['experiments', websiteId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api<Experiment>(`/api/websites/${websiteId}/experiments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      setDialog(null);
      queryClient.invalidateQueries({ queryKey: ['experiments', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['experiment-results', websiteId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/experiments/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['experiments', websiteId] }),
  });

  const flags = flagsQuery.data ?? [];
  const experiments = useMemo(() => experimentsQuery.data ?? [], [experimentsQuery.data]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return experiments;
    return experiments.filter(
      (experiment) =>
        experiment.name.toLowerCase().includes(needle) ||
        (experiment.featureFlagKey ?? '').toLowerCase().includes(needle) ||
        experiment.description.toLowerCase().includes(needle),
    );
  }, [experiments, search]);
  const requestedId = searchParams.get('experiment');
  const selected = rows.find((experiment) => experiment.id === requestedId) ?? rows[0] ?? null;
  const running = experiments.filter((experiment) => experiment.status === 'running').length;

  useEffect(() => {
    updateMutation.reset();
    // Mutation errors belong to the experiment they were made on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const createButton = canEdit ? (
    <Button type="button" variant="primary" onClick={() => setDialog('new')}>
      <Plus strokeWidth={2} aria-hidden />
      {t('createExperiment')}
    </Button>
  ) : null;

  return (
    <Page className="page-experiments product-page">
      <PageHeader title={t('experiments')} lead={t('experimentsLead')} actions={createButton} />

      <PageBody>
        {viewOnly ? <p className="product-view-only">{t('viewOnlyHint')}</p> : null}

        <DataViewState
          loading={experimentsQuery.isLoading}
          loadingFallback={<ProductMasterDetailSkeleton rows={3} />}
          error={experimentsQuery.isError ? experimentsQuery.error : null}
          onRetry={() => experimentsQuery.refetch()}
        >
          {experiments.length ? (
            <MasterDetailLayout
              listHeader={
                <ProductListHeader
                  search={search}
                  onSearch={setSearch}
                  placeholder={t('productExpSearch')}
                  summary={tf(pluralKey('productExpListSummary', experiments.length), {
                    count: formatNumber(experiments.length),
                    running: formatNumber(running),
                  })}
                />
              }
              list={
                rows.length ? (
                  rows.map((experiment) => {
                    const status = experimentStatus(experiment);
                    return (
                      <MasterDetailListItem
                        key={experiment.id}
                        selected={experiment.id === selected?.id}
                        onSelect={() => selectExperiment(experiment.id)}
                        title={experiment.name}
                        subtitle={
                          <>
                            <span className="mono">{experiment.featureFlagKey ?? '–'}</span>
                            {' · '}
                            {metricLabel(experiment.primaryMetric)}
                          </>
                        }
                        meta={
                          <>
                            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                            {experiment.startedAt ? <ShortDate value={experiment.startedAt} /> : null}
                          </>
                        }
                      />
                    );
                  })
                ) : (
                  <ProductNoMatches query={search} onClear={() => setSearch('')} />
                )
              }
              detail={
                selected && websiteId ? (
                  <ExperimentDetail
                    key={selected.id}
                    websiteId={websiteId}
                    experiment={selected}
                    canEdit={canEdit}
                    updating={updateMutation.isPending}
                    error={((dialog === null && updateMutation.error) || deleteMutation.error) as Error | null}
                    onStatus={(status) => updateMutation.mutate({ id: selected.id, patch: { status } })}
                    onEdit={() => {
                      updateMutation.reset();
                      setDialog(selected);
                    }}
                    onDelete={() =>
                      confirm({
                        title: deleteTitle(selected.name),
                        onConfirm: () => deleteMutation.mutate(selected.id),
                      })
                    }
                  />
                ) : (
                  <div className="master-detail-pane">
                    <EmptyState icon={<FlaskConical strokeWidth={2} />} title={t('productSelectExperiment')} />
                  </div>
                )
              }
            />
          ) : (
            <EmptyState
              variant="rich"
              icon={<FlaskConical strokeWidth={2} />}
              title={t('experimentsEmptyTitle')}
              description={t('experimentsEmptyBody')}
              action={createButton}
            />
          )}
        </DataViewState>

        {canEdit && dialog && websiteId ? (
          <ExperimentDialog
            websiteId={websiteId}
            experiment={dialog === 'new' ? null : dialog}
            flags={flags}
            saving={dialog === 'new' ? createMutation.isPending : updateMutation.isPending}
            error={(dialog === 'new' ? createMutation.error : updateMutation.error) as Error | null}
            onClose={() => {
              createMutation.reset();
              updateMutation.reset();
              setDialog(null);
            }}
            onSave={(body) =>
              dialog === 'new' ? createMutation.mutate(body) : updateMutation.mutate({ id: dialog.id, patch: body })
            }
          />
        ) : null}
      </PageBody>
    </Page>
  );
}

function ExperimentDetail({
  websiteId,
  experiment,
  canEdit,
  updating,
  error,
  onStatus,
  onEdit,
  onDelete,
}: {
  websiteId: string;
  experiment: Experiment;
  canEdit: boolean;
  updating: boolean;
  error: Error | null;
  onStatus: (status: Experiment['status']) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = experimentStatus(experiment);
  return (
    <MasterDetailPane
      title={experiment.name}
      meta={
        <>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {experiment.featureFlagKey ? (
            <Link
              className="product-meta-link"
              to={`/websites/${websiteId}/feature-flags?flag=${encodeURIComponent(experiment.featureFlagKey)}`}
              title={experiment.featureFlagName ?? experiment.featureFlagKey}
            >
              <Flag strokeWidth={2} aria-hidden />
              <span className="mono">{experiment.featureFlagKey}</span>
            </Link>
          ) : null}
          {experiment.startedAt ? (
            <span>
              <ShortDate value={experiment.startedAt} />
              {' – '}
              {experiment.endedAt ? <ShortDate value={experiment.endedAt} /> : t('experimentWindowNow')}
            </span>
          ) : (
            <span>{t('productExpNotStarted')}</span>
          )}
        </>
      }
      description={experiment.description || undefined}
      actions={
        canEdit ? (
          <>
            {experiment.status === 'running' ? (
              <Button type="button" variant="outline" size="sm" disabled={updating} onClick={() => onStatus('paused')}>
                <Pause strokeWidth={2} aria-hidden />
                {t('pause')}
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" disabled={updating} onClick={() => onStatus('running')}>
                <Play strokeWidth={2} aria-hidden />
                {t('start')}
              </Button>
            )}
            {experiment.status !== 'completed' ? (
              <Button type="button" variant="outline" size="sm" disabled={updating} onClick={() => onStatus('completed')}>
                <CheckCheck strokeWidth={2} aria-hidden />
                {t('complete')}
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              <Pencil strokeWidth={2} aria-hidden />
              {t('edit')}
            </Button>
            <Button type="button" variant="destructive-ghost" size="sm" onClick={onDelete}>
              <Trash2 strokeWidth={2} aria-hidden />
              {t('delete')}
            </Button>
          </>
        ) : null
      }
    >
      {error ? (
        <p className="text-danger product-inline-error" role="alert">
          {error.message}
        </p>
      ) : null}
      {!experiment.startedAt ? <ProductNote className="product-kpi-note">{t('experimentNotStartedHint')}</ProductNote> : null}
      <ExperimentResultsView websiteId={websiteId} experiment={experiment} canEdit={canEdit} />
    </MasterDetailPane>
  );
}
