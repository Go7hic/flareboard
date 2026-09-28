import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ExternalLink, FlaskConical } from 'lucide-react';
import { DataViewState } from '../components/DataViewState';
import {
  ExperimentMetricsEditor,
  cleanMetric,
  emptyMetric,
  isMetricComplete,
  metricLabel,
  parseMdeInput,
} from '../components/ExperimentMetricsEditor';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  useMasterDetailSelection,
} from '../components/master-detail';
import { ResourceEditDialog } from '../components/ResourceEditDialog';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SegmentTabs } from '../components/SegmentTabs';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { StatCard } from '../components/ui/stat-card';
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
import { chartSeriesColor } from '../lib/chart-colors';
import { formatDateTime, formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';

type StatsMethod = 'frequentist' | 'bayesian';

type MetricsDraft = {
  primary: ExperimentMetric;
  secondary: ExperimentMetric[];
  mde: string;
};

function metricsDraftFrom(experiment?: Experiment): MetricsDraft {
  return {
    primary: experiment?.primaryMetric ?? emptyMetric(),
    secondary: experiment?.secondaryMetrics ?? [],
    mde: experiment?.minimumDetectableEffect == null ? '' : String(experiment.minimumDetectableEffect),
  };
}

function metricsDraftValid(draft: MetricsDraft) {
  return (
    isMetricComplete(draft.primary) &&
    draft.secondary.every(isMetricComplete) &&
    parseMdeInput(draft.mde) !== 'invalid'
  );
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

function VariantSwatch({ index }: { index: number }) {
  return <span className="experiment-variant-swatch" style={{ background: chartSeriesColor(index) }} aria-hidden />;
}

function ExperimentEditDialog({
  experiment,
  flags,
  saving,
  error,
  onClose,
  onSave,
}: {
  experiment: Experiment;
  flags: FeatureFlag[];
  saving: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: (experiment: Experiment, patch: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState({
    name: experiment.name,
    description: experiment.description,
    featureFlagId: experiment.featureFlagId,
    status: experiment.status,
  });
  const [metrics, setMetrics] = useState<MetricsDraft>(() => metricsDraftFrom(experiment));

  useEffect(() => {
    setDraft({
      name: experiment.name,
      description: experiment.description,
      featureFlagId: experiment.featureFlagId,
      status: experiment.status,
    });
    setMetrics(metricsDraftFrom(experiment));
  }, [experiment]);

  const canSave = Boolean(draft.name.trim() && draft.featureFlagId) && metricsDraftValid(metrics) && !saving;

  return (
    <ResourceEditDialog
      title={t('experimentEdit')}
      ariaLabel={t('experimentEdit')}
      panelClassName="experiment-dialog"
      bodyClassName="experiment-dialog-body"
      saving={saving}
      error={error}
      canSave={canSave}
      onClose={onClose}
      onSave={() =>
        onSave(experiment, {
          name: draft.name.trim(),
          description: draft.description.trim(),
          featureFlagId: draft.featureFlagId,
          status: draft.status,
          ...metricsPayload(metrics),
        })
      }
    >
      <div className="field">
        <Label htmlFor="experiment-dialog-name">{t('name')}</Label>
        <Input
          id="experiment-dialog-name"
          value={draft.name}
          onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
        />
      </div>
      <div className="field">
        <Label htmlFor="experiment-dialog-flag">{t('featureFlag')}</Label>
        <select
          id="experiment-dialog-flag"
          className="select"
          value={draft.featureFlagId}
          onChange={(event) => setDraft((prev) => ({ ...prev, featureFlagId: event.target.value }))}
        >
          <option value="">{t('selectFeatureFlag')}</option>
          {flags.map((flag) => (
            <option key={flag.id} value={flag.id}>
              {flag.name} ({flag.key})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
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
      <div className="field">
        <Label htmlFor="experiment-dialog-description">{t('description')}</Label>
        <Input
          id="experiment-dialog-description"
          value={draft.description}
          onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
        />
      </div>
      <div className="experiment-dialog-description">
        <ExperimentMetricsEditor
          websiteId={experiment.websiteId}
          idPrefix="experiment-dialog"
          primary={metrics.primary}
          secondary={metrics.secondary}
          minimumDetectableEffect={metrics.mde}
          onPrimaryChange={(primary) => setMetrics((prev) => ({ ...prev, primary }))}
          onSecondaryChange={(secondary) => setMetrics((prev) => ({ ...prev, secondary }))}
          onMinimumDetectableEffectChange={(mde) => setMetrics((prev) => ({ ...prev, mde }))}
        />
      </div>
    </ResourceEditDialog>
  );
}

function MetricTable({
  role,
  metric,
  rows,
  method,
  colorIndex,
}: {
  role: 'primary' | 'secondary';
  metric: ExperimentMetric;
  rows: ExperimentMetricVariantResult[];
  method: StatsMethod;
  colorIndex: Map<string, number>;
}) {
  const valueHeader =
    metric.type === 'conversion'
      ? t('experimentConversionRate')
      : metric.type === 'count'
        ? t('experimentMeanPerUnit')
        : metric.type === 'property_sum'
          ? t('experimentSumPerUnit')
          : t('experimentMeanValue');
  return (
    <section className="experiment-metric" aria-label={metricLabel(metric)}>
      <header className="experiment-metric-header">
        <span className="badge">{role === 'primary' ? t('experimentPrimaryMetric') : t('experimentSecondaryMetric')}</span>
        <h4 className="section-title experiment-title">{metricLabel(metric)}</h4>
      </header>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('variant')}</th>
              <th className="num">{metric.type === 'property_mean' ? t('experimentUnitsWithValue') : t('experimentUnits')}</th>
              <th className="num">{valueHeader}</th>
              <th className="num">{t('experimentLift')}</th>
              <th className="num">{method === 'frequentist' ? t('experimentConfidenceInterval') : t('experimentCredibleInterval')}</th>
              <th className="num">{method === 'frequentist' ? t('experimentSignificance') : t('experimentProbabilityToBeat')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const comparison = row.comparison;
              const liftInterval =
                method === 'frequentist' ? comparison?.frequentist.liftInterval : comparison?.bayesian.liftInterval;
              const probability = comparison?.bayesian.probabilityToBeatControl ?? null;
              const significant = method === 'frequentist' ? comparison?.frequentist.significant : probability != null && (probability >= 0.95 || probability <= 0.05);
              const direction = (comparison?.difference ?? 0) > 0 ? 'text-success' : (comparison?.difference ?? 0) < 0 ? 'text-danger' : '';
              return (
                <tr key={row.variant}>
                  <td>
                    <span className="experiment-variant-name">
                      <VariantSwatch index={colorIndex.get(row.variant) ?? 0} />
                      {row.variant}
                    </span>
                  </td>
                  <td className="num">{formatNumber(row.sampleSize)}</td>
                  <td className="num">
                    {formatMetricValue(metric, row.value)}
                    {metric.type === 'conversion' ? (
                      <div className="text-muted experiment-cell-sub">
                        {formatNumber(row.total)} / {formatNumber(row.sampleSize)}
                      </div>
                    ) : null}
                  </td>
                  <td className={`num ${row.baseline ? 'text-muted' : significant ? direction : ''}`}>
                    {row.baseline ? t('experimentBaseline') : formatLift(comparison?.lift)}
                  </td>
                  <td className="num">{row.baseline ? '–' : formatLiftInterval(liftInterval)}</td>
                  <td className="num">
                    {row.baseline || !comparison ? (
                      '–'
                    ) : method === 'frequentist' ? (
                      <>
                        <span className={significant ? direction : 'text-muted'}>
                          {significant ? t('experimentSignificant') : t('experimentNotSignificant')}
                        </span>
                        <div className="text-muted experiment-cell-sub">{formatPValue(comparison.frequentist.pValue)}</div>
                      </>
                    ) : (
                      <span className={significant ? direction : undefined}>
                        {probability == null ? '–' : formatPercent(probability * 100, { digits: 1 })}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GuidanceText({ results }: { results: ExperimentResults }) {
  const guidance = results.guidance;
  if (!guidance) return null;
  const primary = results.metrics[0]?.metric;
  const mde = formatPercent(guidance.minimumDetectableEffect * 100, { digits: 1 });
  if (guidance.requiredUnitsPerVariant == null) {
    return <p className="text-muted experiment-guidance">{t('experimentGuidanceUnavailable').replace('{mde}', mde)}</p>;
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
  return <p className="text-muted experiment-guidance">{lines.join(' ')}</p>;
}

function ExperimentResultPanel({
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
  const summary = results?.summary;
  const colorIndex = useMemo(
    () => new Map((results?.variants ?? []).map((row, index) => [row.variant, index])),
    [results?.variants],
  );
  const primaryMetric = results?.metrics[0]?.metric ?? experiment.primaryMetric;
  const decisionClass =
    summary?.decision === 'ship_variant' || summary?.decision === 'keep_control'
      ? 'text-success'
      : summary?.decision === 'fix_setup'
        ? 'text-danger'
        : undefined;

  return (
    <DataViewState
      loading={resultsQuery.isLoading && !results}
      error={resultsQuery.isError ? resultsQuery.error : null}
      onRetry={() => resultsQuery.refetch()}
    >
      {results && summary ? (
        <div className="experiment-results">
          {results.srm?.status === 'mismatch' ? (
            <div className="experiment-banner experiment-banner-danger" role="alert">
              <AlertTriangle size={16} strokeWidth={2} aria-hidden />
              <div>
                <strong>{t('experimentSrmTitle')}</strong>
                <p>
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
                </p>
              </div>
            </div>
          ) : results.srm?.status === 'not_applicable' && results.srm.reason ? (
            <p className="text-muted experiment-note">{t(`experimentSrmSkipped_${results.srm.reason}`)}</p>
          ) : null}
          {summary.excludedUnits > 0 ? (
            <p className="text-muted experiment-note" role="status">
              {t('experimentExcludedUnits').replace('{count}', formatNumber(summary.excludedUnits))}
            </p>
          ) : null}

          <div className="experiment-summary-grid">
            <div className="experiment-summary-decision">
              <StatCard
                label={t('experimentDecision')}
                value={<span className={decisionClass}>{t(`experimentDecision_${summary.decision}`)}</span>}
                hint={
                  summary.significantVariant
                    ? t('experimentWinnerHint').replace('{variant}', summary.significantVariant)
                    : undefined
                }
              />
              {canEdit && summary.decision === 'ship_variant' && experiment.status !== 'completed' ? (
                <div className="stat-card-actions">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={applyMutation.isPending}
                    onClick={() => applyMutation.mutate()}
                  >
                    {applyMutation.isPending ? t('saving') : t('experimentApplyWinner')}
                  </Button>
                </div>
              ) : null}
              {applyMutation.error ? <span className="text-danger">{(applyMutation.error as Error).message}</span> : null}
            </div>
            <StatCard
              label={t('experimentUnits')}
              value={formatNumber(summary.totalUnits)}
              hint={results.variants
                .map((row) => `${row.variant} ${formatPercent(row.share * 100, { digits: 1 })}`)
                .join(' · ')}
            />
            <StatCard
              label={t('experimentLeader')}
              value={summary.leaderVariant ?? '–'}
              hint={summary.leaderLift == null ? undefined : `${formatLift(summary.leaderLift)} ${t('experimentVsControl')}`}
            />
            <StatCard
              label={t('experimentProbabilityToBeat')}
              value={
                summary.bayesianLeaderProbability == null
                  ? '–'
                  : formatPercent(summary.bayesianLeaderProbability * 100, { digits: 1 })
              }
              hint={summary.bayesianLeader ?? undefined}
            />
          </div>

          {summary.diagnostics.length ? (
            <div className="experiment-diagnostics">
              {summary.diagnostics.map((item) => (
                <span key={item.code} className={`badge experiment-diagnostic-${item.level}`}>
                  {t(`experimentDiagnostic_${item.code}`)}
                </span>
              ))}
            </div>
          ) : null}

          <GuidanceText results={results} />

          {summary.totalUnits > 0 ? (
            <>
              <div className="experiment-method-row">
                <SegmentTabs
                  aria-label={t('experimentStatsMethod')}
                  tabs={[
                    { id: 'frequentist', label: t('experimentMethodFrequentist') },
                    { id: 'bayesian', label: t('experimentMethodBayesian') },
                  ]}
                  value={method}
                  onChange={(id) => setMethod(id as StatsMethod)}
                />
                <span className="text-muted experiment-method-hint">
                  {method === 'frequentist' ? t('experimentMethodFrequentistHint') : t('experimentMethodBayesianHint')}
                </span>
              </div>
              {results.metrics.map((item, index) => (
                <MetricTable
                  key={`${index}-${item.metric.type}-${item.metric.event}-${item.metric.property ?? ''}`}
                  role={item.role}
                  metric={item.metric}
                  rows={item.variants}
                  method={method}
                  colorIndex={colorIndex}
                />
              ))}
            </>
          ) : (
            <p className="text-muted">{t('experimentNoResults')}</p>
          )}

          {results.trend.length ? (
            <div className="experiment-trend">
              <h4 className="section-title experiment-title">{t('experimentTrend')}</h4>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('date')}</th>
                      <th>{t('variant')}</th>
                      <th className="num">{t('experimentNewUnits')}</th>
                      <th className="num">{metricLabel(primaryMetric)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.trend.map((item) => (
                      <tr key={`${item.date}-${item.variant}`}>
                        <td className="text-muted">{item.date}</td>
                        <td>
                          <span className="experiment-variant-name">
                            <VariantSwatch index={colorIndex.get(item.variant) ?? 0} />
                            {item.variant}
                          </span>
                        </td>
                        <td className="num">{formatNumber(item.units)}</td>
                        <td className="num">{formatMetricValue(primaryMetric, item.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {results.recent.length ? (
            <div className="experiment-recent">
              <h4 className="section-title experiment-title">{t('experimentRecentSamples')}</h4>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('variant')}</th>
                      <th>{t('session')}</th>
                      <th>{t('page')}</th>
                      <th>{t('experimentConverted')}</th>
                      <th>{t('created')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.recent.slice(0, 10).map((item) => (
                      <tr key={item.id}>
                        <td>
                          <span className="badge">{item.variant}</span>
                        </td>
                        <td>
                          <Link to={`/websites/${websiteId}/sessions/${item.sessionId}`} className="inline-link">
                            {item.sessionId.slice(0, 8)}
                            <ExternalLink size={12} strokeWidth={2} aria-hidden />
                          </Link>
                        </td>
                        <td className="text-muted">{item.urlPath || '/'}</td>
                        <td>
                          <span className={`badge ${item.converted ? 'badge-accent' : ''}`}>
                            {item.converted ? t('yes') : t('no')}
                          </span>
                          {item.convertedAt ? <div className="text-muted">{formatDateTime(item.convertedAt)}</div> : null}
                        </td>
                        <td className="text-muted">{formatDateTime(item.exposedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </DataViewState>
  );
}

const EMPTY_DRAFT = { name: '', description: '', featureFlagId: '', status: 'draft' as Experiment['status'] };

export default function WebsiteExperimentsPage() {
  const confirm = useConfirm();
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit } = useWebsitePermissions(websiteId, 'experiments');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [metricsDraft, setMetricsDraft] = useState<MetricsDraft>(() => metricsDraftFrom());
  const [editingExperiment, setEditingExperiment] = useState<Experiment | null>(null);

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

  const createMutation = useMutation({
    mutationFn: () =>
      api<Experiment>(`/api/websites/${websiteId}/experiments`, {
        method: 'POST',
        body: JSON.stringify({ ...draft, ...metricsPayload(metricsDraft) }),
      }),
    onSuccess: (experiment) => {
      setDraft(EMPTY_DRAFT);
      setMetricsDraft(metricsDraftFrom());
      setSelectedExperimentId(experiment.id);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('experiment', experiment.id);
          return next;
        },
        { replace: true },
      );
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
      setEditingExperiment(null);
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
  const {
    selectedId: selectedExperimentId,
    setSelectedId: setSelectedExperimentId,
    selectedItem: selectedExperiment,
  } = useMasterDetailSelection(experiments, (experiment) => experiment.id);

  useEffect(() => {
    if (!experiments.length) {
      setSelectedExperimentId(null);
      return;
    }
    const requestedExperimentId = searchParams.get('experiment');
    if (requestedExperimentId && experiments.some((experiment) => experiment.id === requestedExperimentId)) {
      setSelectedExperimentId(requestedExperimentId);
      return;
    }
    if (!selectedExperimentId || !experiments.some((experiment) => experiment.id === selectedExperimentId)) {
      const nextExperimentId = experiments[0].id;
      setSelectedExperimentId(nextExperimentId);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('experiment', nextExperimentId);
          return next;
        },
        { replace: true },
      );
    }
  }, [experiments, searchParams, selectedExperimentId, setSearchParams, setSelectedExperimentId]);

  const canCreate = Boolean(draft.name.trim() && draft.featureFlagId) && metricsDraftValid(metricsDraft);

  return (
    <Page className="page-experiments">
      <PageHeader title={t('experiments')} lead={t('experimentsLead')} />

      <PageBody>
        {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

        {canEdit ? (
          <section className="panel section-gap">
            <div className="panel-form">
              <div className="field">
                <Label htmlFor="experiment-name">{t('name')}</Label>
                <Input
                  id="experiment-name"
                  value={draft.name}
                  placeholder={t('experimentNamePlaceholder')}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <div className="field">
                <Label htmlFor="experiment-flag">{t('featureFlag')}</Label>
                <select
                  id="experiment-flag"
                  className="select"
                  value={draft.featureFlagId}
                  onChange={(event) => setDraft((prev) => ({ ...prev, featureFlagId: event.target.value }))}
                >
                  <option value="">{t('selectFeatureFlag')}</option>
                  {flags.map((flag) => (
                    <option key={flag.id} value={flag.id}>
                      {flag.name} ({flag.key})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field feature-flag-description-field">
                <Label htmlFor="experiment-description">{t('description')}</Label>
                <Input
                  id="experiment-description"
                  value={draft.description}
                  placeholder={t('experimentDescriptionPlaceholder')}
                  onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
                />
              </div>
              <div className="feature-flag-description-field">
                <ExperimentMetricsEditor
                  websiteId={websiteId}
                  idPrefix="experiment"
                  primary={metricsDraft.primary}
                  secondary={metricsDraft.secondary}
                  minimumDetectableEffect={metricsDraft.mde}
                  onPrimaryChange={(primary) => setMetricsDraft((prev) => ({ ...prev, primary }))}
                  onSecondaryChange={(secondary) => setMetricsDraft((prev) => ({ ...prev, secondary }))}
                  onMinimumDetectableEffectChange={(mde) => setMetricsDraft((prev) => ({ ...prev, mde }))}
                />
              </div>
              <div className="form-actions">
                <Button
                  type="button"
                  variant="primary"
                  disabled={!canCreate || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? t('saving') : t('createExperiment')}
                </Button>
              </div>
            </div>
            {createMutation.error ? <p className="text-danger">{(createMutation.error as Error).message}</p> : null}
          </section>
        ) : null}

        <section className="section-gap">
          <DataViewState
            loading={experimentsQuery.isLoading && !experimentsQuery.data}
            error={experimentsQuery.isError ? experimentsQuery.error : null}
            onRetry={() => experimentsQuery.refetch()}
            isEmpty={!experimentsQuery.isLoading && !experiments.length}
            emptyTitle={t('experimentsEmptyTitle')}
            emptyDescription={t('experimentsEmptyBody')}
          >
            <MasterDetailLayout
              list={experiments.map((experiment) => (
                <MasterDetailListItem
                  key={experiment.id}
                  selected={experiment.id === selectedExperimentId}
                  onSelect={() => {
                    setSelectedExperimentId(experiment.id);
                    setSearchParams((current) => {
                      const next = new URLSearchParams(current);
                      next.set('experiment', experiment.id);
                      return next;
                    });
                  }}
                  icon={<FlaskConical size={16} strokeWidth={2} aria-hidden />}
                  title={experiment.name}
                  subtitle={`${experiment.featureFlagKey} · ${metricLabel(experiment.primaryMetric)}`}
                  meta={<span className="badge">{t(`experimentStatus_${experiment.status}`)}</span>}
                />
              ))}
              detail={
                selectedExperiment && websiteId ? (
                  <MasterDetailPane
                    title={selectedExperiment.name}
                    description={
                      <>
                        <p className="text-muted">
                          {selectedExperiment.featureFlagKey} · {t('experimentPrimaryMetric')}:{' '}
                          {metricLabel(selectedExperiment.primaryMetric)}
                          {selectedExperiment.secondaryMetrics.length
                            ? ` · ${t('experimentSecondaryMetrics')}: ${selectedExperiment.secondaryMetrics.length}`
                            : ''}
                        </p>
                        {selectedExperiment.startedAt ? (
                          <p className="text-muted">
                            {t('experimentWindow')
                              .replace('{start}', formatDateTime(Number(selectedExperiment.startedAt)))
                              .replace(
                                '{end}',
                                selectedExperiment.endedAt
                                  ? formatDateTime(Number(selectedExperiment.endedAt))
                                  : t('experimentWindowNow'),
                              )}
                          </p>
                        ) : (
                          <p className="text-muted">{t('experimentNotStartedHint')}</p>
                        )}
                        {selectedExperiment.description ? (
                          <p className="text-muted">{selectedExperiment.description}</p>
                        ) : null}
                      </>
                    }
                    actions={
                      canEdit ? (
                        <div className="cohorts-row-actions">
                          {selectedExperiment.status !== 'running' ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                updateMutation.mutate({ id: selectedExperiment.id, patch: { status: 'running' } })
                              }
                            >
                              {t('start')}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                updateMutation.mutate({ id: selectedExperiment.id, patch: { status: 'paused' } })
                              }
                            >
                              {t('pause')}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              updateMutation.mutate({ id: selectedExperiment.id, patch: { status: 'completed' } })
                            }
                          >
                            {t('complete')}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setEditingExperiment(selectedExperiment)}>
                            {t('edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive-ghost"
                            size="sm"
                            onClick={() =>
                              confirm({
                                title: deleteTitle(selectedExperiment.name),
                                onConfirm: () => deleteMutation.mutate(selectedExperiment.id),
                              })
                            }
                          >
                            {t('delete')}
                          </Button>
                        </div>
                      ) : (
                        <span className="badge">{t(`experimentStatus_${selectedExperiment.status}`)}</span>
                      )
                    }
                  >
                    <ExperimentResultPanel websiteId={websiteId} experiment={selectedExperiment} canEdit={canEdit} />
                  </MasterDetailPane>
                ) : null
              }
            />
          </DataViewState>
        </section>

        {canEdit && editingExperiment ? (
          <ExperimentEditDialog
            experiment={editingExperiment}
            flags={flags}
            saving={updateMutation.isPending}
            error={updateMutation.error as Error | null}
            onClose={() => setEditingExperiment(null)}
            onSave={(experiment, patch) => updateMutation.mutate({ id: experiment.id, patch })}
          />
        ) : null}
      </PageBody>
    </Page>
  );
}
