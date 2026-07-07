import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, FlaskConical } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { ModalDialog } from '../components/ModalDialog';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, type Experiment, type ExperimentApplyResult, type ExperimentResults, type FeatureFlag } from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

function formatTime(value: number | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  onSave: (experiment: Experiment, patch: Partial<Experiment>) => void;
}) {
  const [draft, setDraft] = useState({
    name: experiment.name,
    description: experiment.description,
    featureFlagId: experiment.featureFlagId,
    goalEvent: experiment.goalEvent,
    status: experiment.status,
  });

  useEffect(() => {
    setDraft({
      name: experiment.name,
      description: experiment.description,
      featureFlagId: experiment.featureFlagId,
      goalEvent: experiment.goalEvent,
      status: experiment.status,
    });
  }, [experiment]);

  const canSave = Boolean(draft.name.trim() && draft.featureFlagId && draft.goalEvent.trim()) && !saving;

  return (
    <ModalDialog className="experiment-dialog" aria-label={t('experimentEdit')} onClose={onClose}>
        <header className="dialog-header">
          <h2 className="dialog-title">{t('experimentEdit')}</h2>
        </header>
        <div className="dialog-body experiment-dialog-body">
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
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, featureFlagId: event.target.value }))
              }
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
            <Label htmlFor="experiment-dialog-goal">{t('experimentGoalEvent')}</Label>
            <Input
              id="experiment-dialog-goal"
              value={draft.goalEvent}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, goalEvent: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <Label htmlFor="experiment-dialog-status">{t('status')}</Label>
            <select
              id="experiment-dialog-status"
              className="select"
              value={draft.status}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, status: event.target.value as Experiment['status'] }))
              }
            >
              <option value="draft">{t('experimentStatus_draft')}</option>
              <option value="running">{t('experimentStatus_running')}</option>
              <option value="paused">{t('experimentStatus_paused')}</option>
              <option value="completed">{t('experimentStatus_completed')}</option>
            </select>
          </div>
          <div className="field experiment-dialog-description">
            <Label htmlFor="experiment-dialog-description">{t('description')}</Label>
            <Input
              id="experiment-dialog-description"
              value={draft.description}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </div>
          {error ? <p className="text-danger">{error.message}</p> : null}
        </div>
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSave}
            onClick={() =>
              onSave(experiment, {
                name: draft.name.trim(),
                description: draft.description.trim(),
                featureFlagId: draft.featureFlagId,
                goalEvent: draft.goalEvent.trim(),
                status: draft.status,
              })
            }
          >
            {saving ? t('saving') : t('save')}
          </Button>
        </footer>
    </ModalDialog>
  );
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
  const { rangeQs } = useWebsiteRange(websiteId, '30d');
  const queryClient = useQueryClient();
  const resultsQuery = useQuery({
    queryKey: ['experiment-results', websiteId, experiment.id, rangeQs],
    queryFn: () =>
      api<ExperimentResults>(`/api/websites/${websiteId}/experiments/${experiment.id}/results?${rangeQs}`),
  });

  const rows = resultsQuery.data?.variants ?? [];
  const recent = resultsQuery.data?.recent ?? [];
  const trend = resultsQuery.data?.trend ?? [];
  const summary = resultsQuery.data?.summary;
  const applyMutation = useMutation({
    mutationFn: () =>
      api<ExperimentApplyResult>(`/api/websites/${websiteId}/experiments/${experiment.id}/apply?${rangeQs}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['experiment-results', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['feature-flags', websiteId] });
    },
  });
  const formatLift = (lift: number | null) => {
    if (lift == null) return '-';
    const prefix = lift > 0 ? '+' : '';
    return `${prefix}${lift.toFixed(2)}%`;
  };
  const formatPercent = (value: number | null) => (value == null ? '-' : `${value.toFixed(2)}%`);
  const decisionClass =
    summary?.decision === 'ship_variant' || summary?.decision === 'keep_control'
      ? 'stat-value text-success'
      : summary?.decision === 'fix_setup'
        ? 'stat-value text-danger'
        : 'stat-value';

  return (
    <div className="experiment-results">
      {summary?.truncated ? (
        <p className="experiment-results-truncated" role="status">
          {t('experimentResultsTruncated').replace(
            '{limit}',
            String(summary.exposureSampleLimit ?? 500),
          )}
        </p>
      ) : null}
      {summary ? (
        <>
          <div className="experiment-summary-grid">
            <div className="stat-card">
              <span className="stat-label">{t('experimentDecision')}</span>
              <strong className={decisionClass}>{t(`experimentDecision_${summary.decision}`)}</strong>
              <span className="text-muted">{t(`experimentRecommendation_${summary.recommendation}`)}</span>
              <span className="text-muted">
                {t(`experimentConclusion_${summary.conclusion.status}`)
                  .replace('{variant}', summary.conclusion.variant ?? '-')
                  .replace('{confidence}', formatPercent(summary.conclusion.confidence))}
              </span>
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
              {applyMutation.error ? (
                <span className="text-danger">{(applyMutation.error as Error).message}</span>
              ) : null}
            </div>
          <div className="stat-card">
            <span className="stat-label">{t('experimentLeader')}</span>
            <strong className="stat-value">{summary.leaderVariant ?? '-'}</strong>
            <span className="text-muted">
              {summary.leaderConversionRate == null
                ? '-'
                : `${summary.leaderConversionRate.toFixed(2)}%`}
              {summary.leaderLift == null ? '' : ` · ${formatLift(summary.leaderLift)}`}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t('experimentOverallConversion')}</span>
            <strong className="stat-value">{summary.conversionRate.toFixed(2)}%</strong>
            <span className="text-muted">
              {summary.totalConversions.toLocaleString()} / {summary.totalExposures.toLocaleString()}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t('experimentSignificance')}</span>
            <strong className={summary.significantVariant ? 'stat-value text-success' : 'stat-value'}>
              {summary.significantVariant ?? '-'}
            </strong>
            <span className="text-muted">
              {t('experimentMaxConfidence')}: {formatPercent(summary.maxConfidence)}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t('experimentSampleStatus')}</span>
            <strong className={summary.sampleReady ? 'stat-value text-success' : 'stat-value'}>
              {summary.sampleReady ? t('experimentSampleReady') : t('experimentSampleCollecting')}
            </strong>
            <span className="text-muted">
              {t('experimentSampleTarget')
                .replace('{exposures}', summary.sampleSize.minimumExposuresPerVariant.toLocaleString())
                .replace('{conversions}', summary.sampleSize.minimumConversions.toLocaleString())}
            </span>
            <span className="text-muted">
              {summary.sampleSize.ready
                ? t('experimentSampleEnough')
                : t('experimentSampleRemaining')
                    .replace('{exposures}', summary.sampleSize.remainingExposures.toLocaleString())
                    .replace('{conversions}', summary.sampleSize.remainingConversions.toLocaleString())}
            </span>
          </div>
          </div>
        </>
      ) : null}

      {summary?.diagnostics?.length ? (
        <div className="experiment-diagnostics">
          {summary.diagnostics.map((item) => (
            <span key={item.code} className={`badge experiment-diagnostic-${item.level}`}>
              {t(`experimentDiagnostic_${item.code}`)}
            </span>
          ))}
        </div>
      ) : null}

      {trend.length ? (
        <div className="experiment-trend">
          <h4 className="section-title experiment-title">{t('experimentTrend')}</h4>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('date')}</th>
                  <th>{t('variant')}</th>
                  <th>{t('experimentExposures')}</th>
                  <th>{t('experimentConversions')}</th>
                  <th>{t('experimentConversionRate')}</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((item) => (
                  <tr key={`${item.date}-${item.variant}`}>
                    <td className="text-muted">{item.date}</td>
                    <td>
                      <span className="badge">{item.variant}</span>
                    </td>
                    <td className="num">{item.exposures.toLocaleString()}</td>
                    <td className="num">{item.conversions.toLocaleString()}</td>
                    <td className="num">{item.conversionRate.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('variant')}</th>
              <th>{t('experimentExposures')}</th>
              <th>{t('experimentConversions')}</th>
              <th>{t('experimentConversionRate')}</th>
              <th>{t('experimentConfidenceInterval')}</th>
              <th>{t('experimentConfidence')}</th>
              <th>{t('experimentLift')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.variant}>
                  <td>{row.variant}</td>
                  <td className="num">{row.exposures.toLocaleString()}</td>
                  <td className="num">{row.conversions.toLocaleString()}</td>
                  <td className="num">{row.conversionRate.toFixed(2)}%</td>
                  <td className="num">
                    {row.confidenceIntervalLow.toFixed(2)}–{row.confidenceIntervalHigh.toFixed(2)}%
                  </td>
                  <td className={row.significant ? 'num text-success' : 'num'}>
                    {formatPercent(row.confidence)}
                  </td>
                  <td
                    className={
                      row.baseline
                        ? 'text-muted'
                        : row.lift != null && row.lift > 0
                          ? 'num text-success'
                          : row.lift != null && row.lift < 0
                            ? 'num text-danger'
                            : 'num'
                    }
                  >
                    {row.baseline ? t('experimentBaseline') : formatLift(row.lift)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="text-muted">
                  {resultsQuery.isLoading ? t('loading') : t('experimentNoResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {recent.length ? (
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
                {recent.slice(0, 10).map((item) => (
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
                      {item.convertedAt ? (
                        <div className="text-muted">{formatTime(item.convertedAt)}</div>
                      ) : null}
                    </td>
                    <td className="text-muted">{formatTime(item.exposedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function WebsiteExperimentsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit } = useWebsitePermissions(websiteId, 'experiments');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({
    name: '',
    description: '',
    featureFlagId: '',
    goalEvent: '',
    status: 'draft' as Experiment['status'],
  });
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
        body: JSON.stringify(draft),
      }),
    onSuccess: () => {
      setDraft({ name: '', description: '', featureFlagId: '', goalEvent: '', status: 'draft' });
      queryClient.invalidateQueries({ queryKey: ['experiments', websiteId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Experiment> }) =>
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
    mutationFn: (id: string) =>
      api(`/api/websites/${websiteId}/experiments/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['experiments', websiteId] }),
  });

  const flags = flagsQuery.data ?? [];
  const experiments = experimentsQuery.data ?? [];
  const canCreate = Boolean(draft.name.trim() && draft.featureFlagId && draft.goalEvent.trim());

  return (
    <div className="page page-experiments">
      <WebsitePageShell websiteId={websiteId} />

      {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

      {canEdit ? (
      <section className="panel section-gap">
        <header className="panel-header">
          <div>
            <h2 className="section-title">{t('experiments')}</h2>
            <p className="text-muted">{t('experimentsLead')}</p>
          </div>
        </header>

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
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, featureFlagId: event.target.value }))
              }
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
            <Label htmlFor="experiment-goal">{t('experimentGoalEvent')}</Label>
            <Input
              id="experiment-goal"
              value={draft.goalEvent}
              placeholder="checkout_completed"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, goalEvent: event.target.value }))
              }
            />
          </div>
          <div className="field feature-flag-description-field">
            <Label htmlFor="experiment-description">{t('description')}</Label>
            <Input
              id="experiment-description"
              value={draft.description}
              placeholder={t('experimentDescriptionPlaceholder')}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, description: event.target.value }))
              }
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
        {createMutation.error ? (
          <p className="text-danger">{(createMutation.error as Error).message}</p>
        ) : null}
      </section>
      ) : null}

      <section className="panel section-gap">
        {experimentsQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : experiments.length ? (
          <div className="experiments-list">
            {experiments.map((experiment) => (
              <article key={experiment.id} className="experiment-item">
                <header className="experiment-item-head">
                  <div className="errors-name-cell">
                    <FlaskConical size={16} strokeWidth={2} aria-hidden />
                    <div>
                      <h3 className="section-title experiment-title">{experiment.name}</h3>
                      <p className="text-muted">
                        {experiment.featureFlagKey} · {t('experimentGoalEvent')}: {experiment.goalEvent}
                      </p>
                      {experiment.description ? <p className="text-muted">{experiment.description}</p> : null}
                    </div>
                  </div>
                  <div className="cohorts-row-actions">
                    <span className="badge">{t(`experimentStatus_${experiment.status}`)}</span>
                    {canEdit ? (
                      <>
                    {experiment.status !== 'running' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateMutation.mutate({ id: experiment.id, patch: { status: 'running' } })
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
                          updateMutation.mutate({ id: experiment.id, patch: { status: 'paused' } })
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
                        updateMutation.mutate({ id: experiment.id, patch: { status: 'completed' } })
                      }
                    >
                      {t('complete')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingExperiment(experiment)}
                    >
                      {t('edit')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="btn-danger-text"
                      onClick={() => deleteMutation.mutate(experiment.id)}
                    >
                      {t('delete')}
                    </Button>
                      </>
                    ) : null}
                  </div>
                </header>
                {websiteId ? (
                  <ExperimentResultPanel websiteId={websiteId} experiment={experiment} canEdit={canEdit} />
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title={t('experimentsEmptyTitle')} description={t('experimentsEmptyBody')} />
        )}
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
    </div>
  );
}
