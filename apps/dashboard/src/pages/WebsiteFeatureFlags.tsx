import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ExternalLink, Flag } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  ResourceSearchField,
  useMasterDetailSelection,
} from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, type FeatureFlag, type FeatureFlagEvaluateResult } from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { formatDateOnly, formatDateTime, formatNumber, formatPercent } from '../lib/format';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import {
  FeatureFlagConditionSummary,
  FeatureFlagEditorDialog,
  FeatureFlagHistory,
  type FeatureFlagBody,
} from '../components/FeatureFlagEditor';
import { SegmentTabs } from '../components/SegmentTabs';

type DetailTab = 'overview' | 'conditions' | 'history';

function formatDate(value: string | number | undefined) {
  return formatDateOnly(value);
}

function formatTime(value: number | null | undefined) {
  return formatDateTime(value);
}

function formatTrendDate(value: string | undefined) {
  if (!value) return '-';
  return formatDateOnly(`${value}T00:00:00Z`);
}

function featureFlagIssueLabel(issue: NonNullable<FeatureFlag['summary']>['health']['issues'][number]) {
  if (issue === 'no_exposures') return t('featureFlagIssue_no_exposures');
  if (issue === 'missing_variant_data') return t('featureFlagIssue_missing_variant_data');
  return t('featureFlagIssue_traffic_concentrated');
}

function featureFlagHealthClass(status: NonNullable<FeatureFlag['summary']>['health']['status']) {
  if (status === 'healthy') return 'badge experiment-diagnostic-success';
  if (status === 'needs_attention') return 'badge experiment-diagnostic-warning';
  return 'badge experiment-diagnostic-info';
}

/**
 * Inline rollout editor with a local draft so typing does not PATCH per
 * keystroke; the change is committed on blur or Enter, and only when the
 * value is valid (0-100) and actually different.
 */
function FeatureFlagRolloutInput({
  flag,
  onCommit,
}: {
  flag: FeatureFlag;
  onCommit: (rollout: number) => void;
}) {
  const [draft, setDraft] = useState(String(flag.rollout));

  useEffect(() => {
    setDraft(String(flag.rollout));
  }, [flag.rollout]);

  function commit() {
    const next = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(next) || next < 0 || next > 100) {
      setDraft(String(flag.rollout));
      return;
    }
    if (next !== flag.rollout) onCommit(next);
  }

  return (
    <input
      className="input feature-flag-rollout-input"
      type="number"
      min={0}
      max={100}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      aria-label={t('featureFlagRollout')}
    />
  );
}

export default function WebsiteFeatureFlagsPage() {
  const confirm = useConfirm();
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId, 'featureFlags');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  /** null = closed, 'new' = create dialog, otherwise the flag being edited. */
  const [editor, setEditor] = useState<FeatureFlag | 'new' | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [evaluateDraft, setEvaluateDraft] = useState({
    key: '',
    distinctId: '',
    path: '',
    environment: '',
    release: '',
  });
  const [evaluateResult, setEvaluateResult] = useState<FeatureFlagEvaluateResult | null>(null);
  const flagsQuery = useQuery({
    queryKey: ['feature-flags', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<FeatureFlag[]>(`/api/websites/${websiteId}/feature-flags`),
  });

  const rows = useMemo(() => {
    const all = flagsQuery.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (flag) =>
        flag.key.toLowerCase().includes(needle) ||
        flag.name.toLowerCase().includes(needle) ||
        flag.description.toLowerCase().includes(needle),
    );
  }, [flagsQuery.data, search]);

  const {
    selectedId: selectedFlagId,
    setSelectedId: setSelectedFlagId,
    selectedItem: selectedFlag,
  } = useMasterDetailSelection(rows, (flag) => flag.id);

  useEffect(() => {
    if (!rows.length) {
      setSelectedFlagId(null);
      return;
    }
    const requestedKey = searchParams.get('flag');
    if (requestedKey) {
      const match = rows.find((flag) => flag.key === requestedKey);
      if (match) {
        setSelectedFlagId(match.id);
        return;
      }
    }
    if (!selectedFlagId || !rows.some((flag) => flag.id === selectedFlagId)) {
      const nextFlag = rows[0];
      setSelectedFlagId(nextFlag.id);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('flag', nextFlag.key);
          return next;
        },
        { replace: true },
      );
    }
  }, [rows, searchParams, selectedFlagId, setSearchParams, setSelectedFlagId]);

  const createMutation = useMutation({
    mutationFn: (body: FeatureFlagBody) =>
      api<FeatureFlag>(`/api/websites/${websiteId}/feature-flags`, {
        method: 'POST',
        body: JSON.stringify({ ...body, enabled: true }),
      }),
    onSuccess: (flag) => {
      setEditor(null);
      setSelectedFlagId(flag.id);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('flag', flag.key);
          return next;
        },
        { replace: true },
      );
      queryClient.invalidateQueries({ queryKey: ['feature-flags', websiteId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<FeatureFlagBody> & { enabled?: boolean } }) =>
      api<FeatureFlag>(`/api/websites/${websiteId}/feature-flags/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      setEditor(null);
      queryClient.invalidateQueries({ queryKey: ['feature-flags', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['feature-flag-history', websiteId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/websites/${websiteId}/feature-flags/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feature-flags', websiteId] }),
  });

  const evaluateMutation = useMutation({
    mutationFn: () =>
      api<FeatureFlagEvaluateResult>(`/api/websites/${websiteId}/feature-flags/evaluate`, {
        method: 'POST',
        body: JSON.stringify({
          key: evaluateDraft.key.trim(),
          distinctId: evaluateDraft.distinctId.trim() || undefined,
          path: evaluateDraft.path.trim() || undefined,
          environment: evaluateDraft.environment.trim() || undefined,
          release: evaluateDraft.release.trim() || undefined,
        }),
      }),
    onSuccess: (result) => {
      setEvaluateResult(result);
      queryClient.invalidateQueries({ queryKey: ['feature-flags', websiteId] });
    },
  });

  return (
    <Page className="page-feature-flags">
      <PageHeader
        title={t('featureFlags')}
        lead={t('featureFlagsLead')}
        actions={
          canEdit ? (
            <Button type="button" variant="primary" onClick={() => setEditor('new')}>
              {t('createFeatureFlag')}
            </Button>
          ) : null
        }
      />

      <PageBody>

      {viewOnly ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

      <section className="panel section-gap">
        <header className="panel-header">
          <div>
            <h2 className="section-title">{t('featureFlagEvaluate')}</h2>
            <p className="text-muted">{t('featureFlagEvaluateLead')}</p>
          </div>
        </header>
        <div className="panel-form">
          <div className="field">
            <Label htmlFor="evaluate-key">{t('featureFlagEvaluateKey')}</Label>
            <Input
              id="evaluate-key"
              value={evaluateDraft.key}
              list="feature-flag-keys"
              onChange={(event) => setEvaluateDraft((prev) => ({ ...prev, key: event.target.value }))}
            />
            <datalist id="feature-flag-keys">
              {(flagsQuery.data ?? []).map((flag) => (
                <option key={flag.id} value={flag.key} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <Label htmlFor="evaluate-distinct-id">{t('featureFlagEvaluateDistinctId')}</Label>
            <Input
              id="evaluate-distinct-id"
              value={evaluateDraft.distinctId}
              onChange={(event) => setEvaluateDraft((prev) => ({ ...prev, distinctId: event.target.value }))}
            />
          </div>
          <div className="field">
            <Label htmlFor="evaluate-path">{t('featureFlagEvaluatePath')}</Label>
            <Input
              id="evaluate-path"
              value={evaluateDraft.path}
              placeholder="/checkout"
              onChange={(event) => setEvaluateDraft((prev) => ({ ...prev, path: event.target.value }))}
            />
          </div>
          <div className="field">
            <Label htmlFor="evaluate-environment">{t('featureFlagEvaluateEnvironment')}</Label>
            <Input
              id="evaluate-environment"
              value={evaluateDraft.environment}
              onChange={(event) => setEvaluateDraft((prev) => ({ ...prev, environment: event.target.value }))}
            />
          </div>
          <div className="field">
            <Label htmlFor="evaluate-release">{t('featureFlagEvaluateRelease')}</Label>
            <Input
              id="evaluate-release"
              value={evaluateDraft.release}
              onChange={(event) => setEvaluateDraft((prev) => ({ ...prev, release: event.target.value }))}
            />
          </div>
          <div className="form-actions">
            <Button
              type="button"
              variant="primary"
              disabled={!evaluateDraft.key.trim() || evaluateMutation.isPending}
              onClick={() => evaluateMutation.mutate()}
            >
              {evaluateMutation.isPending ? t('loading') : t('featureFlagRunEvaluate')}
            </Button>
          </div>
        </div>
        {evaluateMutation.error ? (
          <p className="text-danger">{(evaluateMutation.error as Error).message}</p>
        ) : null}
        {evaluateResult ? (
          <div className="workflow-action-note section-gap">
            <strong>{t('featureFlagEvaluateResult')}</strong>
            <div className="text-muted">
              {evaluateResult.key} · {evaluateResult.variant ?? '-'} ·{' '}
              {evaluateResult.enabled ? t('enabled') : t('disabled')}
            </div>
            <div className="text-muted">
              {t('featureFlagEvaluateReason')}: {t(`featureFlagReason_${evaluateResult.reason}`)}
              {typeof evaluateResult.conditionGroup === 'number'
                ? ` · ${t('featureFlagGroupTitle').replace('{n}', String(evaluateResult.conditionGroup + 1))}`
                : ''}
            </div>
            {evaluateResult.payload !== undefined && evaluateResult.payload !== null ? (
              <pre className="flag-json">{JSON.stringify(evaluateResult.payload, null, 2)}</pre>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="section-gap">
        <header className="cohorts-panel-head">
          <ResourceSearchField
            value={search}
            onChange={setSearch}
            placeholder={t('featureFlagSearch')}
            aria-label={t('featureFlagSearch')}
          />
        </header>

        {flagsQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : rows.length ? (
          <MasterDetailLayout
            list={rows.map((flag) => (
              <MasterDetailListItem
                key={flag.id}
                selected={flag.id === selectedFlagId}
                onSelect={() => {
                  setSelectedFlagId(flag.id);
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set('flag', flag.key);
                    return next;
                  });
                }}
                icon={<Flag size={16} strokeWidth={2} aria-hidden />}
                title={flag.name}
                subtitle={flag.key}
                meta={
                  <>
                    <span className="badge">{flag.enabled ? t('enabled') : t('disabled')}</span>
                    {flag.summary?.health ? (
                      <span className={featureFlagHealthClass(flag.summary.health.status)}>
                        {t(`featureFlagHealth_${flag.summary.health.status}`)}
                      </span>
                    ) : null}
                  </>
                }
              />
            ))}
            detail={
              selectedFlag ? (
                <MasterDetailPane
                  title={selectedFlag.name}
                  description={
                    <>
                      <p className="text-muted mono">{selectedFlag.key}</p>
                      {selectedFlag.description ? (
                        <p className="text-muted">{selectedFlag.description}</p>
                      ) : null}
                      {selectedFlag.variants.length ? (
                        <div className="feature-flag-variants">
                          {selectedFlag.variants.map((variant) => (
                            <span key={variant.key} className="badge">
                              {variant.key} · {variant.weight}%
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="feature-flag-variants">
                        <span className="badge">
                          {t('featureFlagGroupCount').replace('{count}', String(selectedFlag.conditionGroups.length))}
                        </span>
                        {selectedFlag.earlyAccess ? (
                          <span className="badge">{t('featureFlagEarlyAccess')}</span>
                        ) : null}
                      </div>
                    </>
                  }
                  actions={
                    canEdit ? (
                      <div className="cohorts-row-actions">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditor(selectedFlag)}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateMutation.mutate({
                              id: selectedFlag.id,
                              patch: { enabled: !selectedFlag.enabled },
                            })
                          }
                        >
                          {selectedFlag.enabled ? t('disable') : t('enable')}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive-ghost"
                          size="sm"
                          onClick={() => confirm({ title: deleteTitle(selectedFlag.name), onConfirm: () => deleteMutation.mutate(selectedFlag.id) })}
                        >
                          {t('delete')}
                        </Button>
                      </div>
                    ) : null
                  }
                >
                  {deleteMutation.error ? (
                    <p className="text-danger">{(deleteMutation.error as Error).message}</p>
                  ) : null}
                  {updateMutation.error && !editor ? (
                    <p className="text-danger">{(updateMutation.error as Error).message}</p>
                  ) : null}
                  <SegmentTabs
                    className="flag-detail-tabs"
                    aria-label={t('featureFlag')}
                    value={detailTab}
                    onChange={(id) => setDetailTab(id as DetailTab)}
                    tabs={[
                      { id: 'overview', label: t('featureFlagTabOverview') },
                      { id: 'conditions', label: t('featureFlagReleaseConditions') },
                      { id: 'history', label: t('featureFlagTabHistory') },
                    ]}
                  />
                  {detailTab === 'conditions' ? (
                    <FeatureFlagConditionSummary websiteId={websiteId!} flag={selectedFlag} />
                  ) : null}
                  {detailTab === 'history' ? (
                    <FeatureFlagHistory websiteId={websiteId!} flagId={selectedFlag.id} />
                  ) : null}
                  {detailTab === 'overview' ? (
                  <>
                  <div className="detail-stats">
                    <div>
                      <span className="stat-label">{t('featureFlagRollout')}</span>
                      {canEdit && selectedFlag.conditionGroups.length === 1 ? (
                        <FeatureFlagRolloutInput
                          flag={selectedFlag}
                          onCommit={(rollout) =>
                            updateMutation.mutate({
                              id: selectedFlag.id,
                              patch: {
                                conditionGroups: [{ ...selectedFlag.conditionGroups[0], rollout, variant: selectedFlag.conditionGroups[0].variant ?? null }],
                              },
                            })
                          }
                        />
                      ) : (
                        <strong className="stat-value">
                          {selectedFlag.conditionGroups.length === 1
                            ? `${selectedFlag.rollout}%`
                            : t('featureFlagRolloutPerGroup')}
                        </strong>
                      )}
                    </div>
                    <div>
                      <span className="stat-label">{t('featureFlagExposures')}</span>
                      <strong className="stat-value">
                        {formatNumber((selectedFlag.summary?.exposures ?? 0))}
                      </strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('sessions')}</span>
                      <strong className="stat-value">
                        {formatNumber((selectedFlag.summary?.sessions ?? 0))}
                      </strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('lastSeen')}</span>
                      <strong className="stat-value">
                        {formatTime(selectedFlag.summary?.lastCalledAt)}
                      </strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('created')}</span>
                      <strong className="stat-value">{formatDate(selectedFlag.createdAt)}</strong>
                    </div>
                  </div>

                  {selectedFlag.summary?.health ? (
                    <div className="detail-section">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">{t('featureFlagHealth')}</h3>
                        </div>
                      </div>
                      <div className="feature-flag-health">
                        <span className={featureFlagHealthClass(selectedFlag.summary.health.status)}>
                          {t(`featureFlagHealth_${selectedFlag.summary.health.status}`)}
                        </span>
                        {selectedFlag.summary.health.issues.length ? (
                          <div className="feature-flag-health-issues">
                            {selectedFlag.summary.health.issues.map((issue) => (
                              <span key={issue} className="text-muted">
                                {featureFlagIssueLabel(issue)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {selectedFlag.summary.health.dominantVariant ? (
                          <div className="text-muted">
                            {t('featureFlagDominantVariant')}: {selectedFlag.summary.health.dominantVariant} ·{' '}
                            {formatNumber(selectedFlag.summary.health.dominantShare ?? 0)}%
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {selectedFlag.summary?.variants.length ? (
                    <div className="detail-section">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">{t('featureFlagExposures')}</h3>
                        </div>
                      </div>
                      <div className="feature-flag-exposure-bars">
                        {selectedFlag.summary.variants.map((variant) => (
                          <div key={variant.variant} className="feature-flag-exposure-row">
                            <span className="text-muted">
                              {variant.variant} · {formatNumber(variant.exposures)}
                            </span>
                            <span className="feature-flag-exposure-track" aria-hidden>
                              <span style={{ width: `${Math.min(100, variant.percentage)}%` }} />
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedFlag.summary?.trend.length ? (
                    <div className="detail-section">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">{t('trend')}</h3>
                        </div>
                      </div>
                      <p className="text-muted">
                        {formatTrendDate(selectedFlag.summary.trend.slice(-1)[0]?.date)} ·{' '}
                        {formatNumber(selectedFlag.summary.trend.slice(-1)[0]?.exposures)}{' '}
                        {t('featureFlagExposures')}
                      </p>
                    </div>
                  ) : null}

                  {selectedFlag.summary?.releases.length ? (
                    <div className="detail-section">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">{t('featureFlagEvaluateRelease')}</h3>
                        </div>
                      </div>
                      <div className="feature-flag-variants">
                        {selectedFlag.summary.releases.map((release) => (
                          <span key={release.release} className="badge">
                            {release.release} · {formatNumber(release.exposures)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedFlag.summary?.environments.length ? (
                    <div className="detail-section">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">
                            {t('featureFlagEvaluateEnvironment')}
                          </h3>
                        </div>
                      </div>
                      <div className="feature-flag-variants">
                        {selectedFlag.summary.environments.map((environment) => (
                          <span key={environment.environment} className="badge">
                            {environment.environment} · {formatNumber(environment.exposures)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedFlag.summary?.recent.length ? (
                    <div className="detail-section">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">{t('featureFlagExposures')}</h3>
                        </div>
                      </div>
                      <div className="feature-flag-recent">
                        {selectedFlag.summary.recent.map((exposure) => (
                          <div key={exposure.id} className="feature-flag-recent-row">
                            <span className="badge">{exposure.variant ?? t('featureFlagVariantControl')}</span>
                            <span className="text-muted">{exposure.urlPath || '/'}</span>
                            {exposure.release ? (
                              <span className="text-muted">{exposure.release}</span>
                            ) : null}
                            {exposure.environment ? (
                              <span className="text-muted">{exposure.environment}</span>
                            ) : null}
                            <Link
                              to={`/websites/${websiteId}/sessions/${exposure.sessionId}`}
                              className="inline-link"
                            >
                              {exposure.sessionId.slice(0, 8)}
                              <ExternalLink size={12} strokeWidth={2} aria-hidden />
                            </Link>
                            <span className="text-muted">{formatTime(exposure.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  </>
                  ) : null}
                </MasterDetailPane>
              ) : null
            }
          />
        ) : (
          <EmptyState title={t('featureFlagsEmptyTitle')} description={t('featureFlagsEmptyBody')} />
        )}
      </section>

      {editor ? (
        <FeatureFlagEditorDialog
          websiteId={websiteId!}
          flag={editor === 'new' ? null : editor}
          saving={editor === 'new' ? createMutation.isPending : updateMutation.isPending}
          error={(editor === 'new' ? createMutation.error : updateMutation.error) as Error | null}
          onClose={() => {
            createMutation.reset();
            updateMutation.reset();
            setEditor(null);
          }}
          onSave={(body) =>
            editor === 'new' ? createMutation.mutate(body) : updateMutation.mutate({ id: editor.id, patch: body })
          }
        />
      ) : null}
      </PageBody>
    </Page>
  );
}
