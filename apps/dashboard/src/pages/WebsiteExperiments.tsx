import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ExternalLink, FlaskConical } from 'lucide-react';
import { DataViewState } from '../components/DataViewState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  useMasterDetailSelection,
} from '../components/master-detail';
import { ResourceEditDialog } from '../components/ResourceEditDialog';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { StatCard } from '../components/ui/stat-card';
import { api, type Experiment, type ExperimentApplyResult, type ExperimentResults, type FeatureFlag } from '../lib/api';
import { formatDateTime, formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

function formatLift(lift: number | null) {
  if (lift == null) return '-';
  return formatPercent(lift, { digits: 2, signed: true });
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
          goalEvent: draft.goalEvent.trim(),
          status: draft.status,
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
    </ResourceEditDialog>
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
  const formatLiftValue = formatLift;
  const decisionClass =
    summary?.decision === 'ship_variant' || summary?.decision === 'keep_control'
      ? 'text-success'
      : summary?.decision === 'fix_setup'
        ? 'text-danger'
        : undefined;

  return (
    <DataViewState
      loading={resultsQuery.isLoading && !resultsQuery.data}
      error={resultsQuery.isError ? resultsQuery.error : null}
      onRetry={() => resultsQuery.refetch()}
    >
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
            <div className="experiment-summary-decision">
              <StatCard
                label={t('experimentDecision')}
                value={
                  <span className={decisionClass}>
                    {t(`experimentDecision_${summary.decision}`)}
                  </span>
                }
                hint={
                  <>
                    <span className="text-muted">{t(`experimentRecommendation_${summary.recommendation}`)}</span>
                    <span className="text-muted">
                      {t(`experimentConclusion_${summary.conclusion.status}`)
                        .replace('{variant}', summary.conclusion.variant ?? '-')
                        .replace('{confidence}', formatPercent(summary.conclusion.confidence, { digits: 2 }))}
                    </span>
                  </>
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
              {applyMutation.error ? (
                <span className="text-danger">{(applyMutation.error as Error).message}</span>
              ) : null}
            </div>
            <StatCard
              label={t('experimentLeader')}
              value={summary.leaderVariant ?? '-'}
              hint={
                summary.leaderConversionRate == null
                  ? '-'
                  : `${formatPercent(summary.leaderConversionRate, { digits: 2 })}${
                      summary.leaderLift == null ? '' : ` · ${formatLiftValue(summary.leaderLift)}`
                    }`
              }
            />
            <StatCard
              label={t('experimentOverallConversion')}
              value={formatPercent(summary.conversionRate, { digits: 2 })}
              hint={`${formatNumber(summary.totalConversions)} / ${formatNumber(summary.totalExposures)}`}
            />
            <StatCard
              label={t('experimentSignificance')}
              value={
                <span className={summary.significantVariant ? 'text-success' : undefined}>
                  {summary.significantVariant ?? '-'}
                </span>
              }
              hint={`${t('experimentMaxConfidence')}: ${formatPercent(summary.maxConfidence, { digits: 2 })}`}
            />
            <StatCard
              label={t('experimentSampleStatus')}
              value={
                <span className={summary.sampleReady ? 'text-success' : undefined}>
                  {summary.sampleReady ? t('experimentSampleReady') : t('experimentSampleCollecting')}
                </span>
              }
              hint={
                <>
                  <span className="text-muted">
                    {t('experimentSampleTarget')
                      .replace('{exposures}', formatNumber(summary.sampleSize.minimumExposuresPerVariant))
                      .replace('{conversions}', formatNumber(summary.sampleSize.minimumConversions))}
                  </span>
                  <span className="text-muted">
                    {summary.sampleSize.ready
                      ? t('experimentSampleEnough')
                      : t('experimentSampleRemaining')
                          .replace('{exposures}', formatNumber(summary.sampleSize.remainingExposures))
                          .replace('{conversions}', formatNumber(summary.sampleSize.remainingConversions))}
                  </span>
                </>
              }
            />
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
                    <td className="num">{formatNumber(item.exposures)}</td>
                    <td className="num">{formatNumber(item.conversions)}</td>
                    <td className="num">{formatPercent(item.conversionRate, { digits: 2 })}</td>
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
                  <td className="num">{formatNumber(row.exposures)}</td>
                  <td className="num">{formatNumber(row.conversions)}</td>
                  <td className="num">{formatPercent(row.conversionRate, { digits: 2 })}</td>
                  <td className="num">
                    {formatPercent(row.confidenceIntervalLow, { digits: 2 })}–
                    {formatPercent(row.confidenceIntervalHigh, { digits: 2 })}
                  </td>
                  <td className={row.significant ? 'num text-success' : 'num'}>
                    {formatPercent(row.confidence, { digits: 2 })}
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
                    {row.baseline ? t('experimentBaseline') : formatLiftValue(row.lift)}
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
                        <div className="text-muted">{formatDateTime(item.convertedAt)}</div>
                      ) : null}
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
    </DataViewState>
  );
}

export default function WebsiteExperimentsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit } = useWebsitePermissions(websiteId, 'experiments');
  const [searchParams, setSearchParams] = useSearchParams();
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
    onSuccess: (experiment) => {
      setDraft({ name: '', description: '', featureFlagId: '', goalEvent: '', status: 'draft' });
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
    if (
      !selectedExperimentId ||
      !experiments.some((experiment) => experiment.id === selectedExperimentId)
    ) {
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

  const canCreate = Boolean(draft.name.trim() && draft.featureFlagId && draft.goalEvent.trim());

  return (
    <Page className="page-experiments">
      <PageHeader title={t('experiments')} lead={t('experimentsLead')} />

      <PageBody>

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
                subtitle={`${experiment.featureFlagKey} · ${experiment.goalEvent}`}
                meta={
                  <span className="badge">{t(`experimentStatus_${experiment.status}`)}</span>
                }
              />
            ))}
            detail={
              selectedExperiment && websiteId ? (
                <MasterDetailPane
                  title={selectedExperiment.name}
                  description={
                    <>
                      <p className="text-muted">
                        {selectedExperiment.featureFlagKey} · {t('experimentGoalEvent')}:{' '}
                        {selectedExperiment.goalEvent}
                      </p>
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
                              updateMutation.mutate({
                                id: selectedExperiment.id,
                                patch: { status: 'running' },
                              })
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
                              updateMutation.mutate({
                                id: selectedExperiment.id,
                                patch: { status: 'paused' },
                              })
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
                            updateMutation.mutate({
                              id: selectedExperiment.id,
                              patch: { status: 'completed' },
                            })
                          }
                        >
                          {t('complete')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingExperiment(selectedExperiment)}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="btn-danger-text"
                          onClick={() => deleteMutation.mutate(selectedExperiment.id)}
                        >
                          {t('delete')}
                        </Button>
                      </div>
                    ) : (
                      <span className="badge">{t(`experimentStatus_${selectedExperiment.status}`)}</span>
                    )
                  }
                >
                  <ExperimentResultPanel
                    websiteId={websiteId}
                    experiment={selectedExperiment}
                    canEdit={canEdit}
                  />
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
