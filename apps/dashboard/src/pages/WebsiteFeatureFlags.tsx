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
import { ResourceEditDialog } from '../components/ResourceEditDialog';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, type FeatureFlag, type FeatureFlagEvaluateResult } from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

const DEFAULT_FLAG = {
  key: '',
  name: '',
  description: '',
  rollout: 100,
  variantsText: '',
  targetingRulesText: '',
};

const TARGETING_FIELDS = [
  'path',
  'url',
  'hostname',
  'referrer',
  'language',
  'userAgent',
  'distinctId',
  'userId',
  'environment',
  'release',
  'group',
  'property',
] as const;
const TARGETING_OPERATORS = [
  'equals',
  'contains',
  'starts_with',
  'ends_with',
  'not_equals',
  'not_contains',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
  'exists',
  'not_exists',
] as const;

type TargetingField = (typeof TARGETING_FIELDS)[number];
type TargetingOperator = (typeof TARGETING_OPERATORS)[number];

function formatDate(value: string | number | undefined) {
  if (value == null) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(value: number | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTrendDate(value: string | undefined) {
  if (!value) return '-';
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
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

function parseVariants(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key = '', name = '', weight = '0'] = line.split(',').map((part) => part.trim());
      return {
        key,
        name: name || key,
        weight: Number(weight),
      };
    })
    .filter((variant) => variant.key && Number.isFinite(variant.weight));
}

function parseTargetingRules(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawField = '', operator = '', ...rest] = line.split(/\s+/);
      const [field, key] = rawField.includes('.')
        ? (rawField.split('.', 2) as [TargetingField, string])
        : [rawField as TargetingField, undefined];
      return {
        field: field as TargetingField,
        key,
        operator: operator as TargetingOperator,
        value: rest.join(' ').trim(),
      };
    })
    .filter(
      (rule) =>
        TARGETING_FIELDS.includes(rule.field) &&
        TARGETING_OPERATORS.includes(rule.operator) &&
        (rule.operator === 'exists' || rule.operator === 'not_exists' || rule.value) &&
        (rule.field === 'group' || rule.field === 'property' ? Boolean(rule.key) : true),
    );
}

function countRuleLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function stringifyVariants(flag: FeatureFlag) {
  return flag.variants.map((variant) => `${variant.key}, ${variant.name}, ${variant.weight}`).join('\n');
}

function stringifyTargetingRules(flag: FeatureFlag) {
  return flag.targetingRules
    .map((rule) => `${rule.key ? `${rule.field}.${rule.key}` : rule.field} ${rule.operator} ${rule.value}`.trim())
    .join('\n');
}

function FeatureFlagEditDialog({
  flag,
  saving,
  error,
  onClose,
  onSave,
}: {
  flag: FeatureFlag;
  saving: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: (flag: FeatureFlag, patch: Partial<FeatureFlag>) => void;
}) {
  const [draft, setDraft] = useState({
    key: flag.key,
    name: flag.name,
    description: flag.description,
    rollout: flag.rollout,
    variantsText: stringifyVariants(flag),
    targetingRulesText: stringifyTargetingRules(flag),
  });

  useEffect(() => {
    setDraft({
      key: flag.key,
      name: flag.name,
      description: flag.description,
      rollout: flag.rollout,
      variantsText: stringifyVariants(flag),
      targetingRulesText: stringifyTargetingRules(flag),
    });
  }, [flag]);

  const variants = parseVariants(draft.variantsText);
  const variantWeight = variants.reduce((sum, variant) => sum + variant.weight, 0);
  const targetingRules = parseTargetingRules(draft.targetingRulesText);
  const ruleLineCount = countRuleLines(draft.targetingRulesText);
  const canSave =
    Boolean(draft.key.trim() && draft.name.trim()) &&
    variantWeight <= 100 &&
    ruleLineCount === targetingRules.length &&
    !saving;

  return (
    <ResourceEditDialog
      title={t('featureFlagEdit')}
      ariaLabel={t('featureFlagEdit')}
      panelClassName="feature-flag-dialog"
      bodyClassName="feature-flag-dialog-body"
      saving={saving}
      error={error}
      canSave={canSave}
      onClose={onClose}
      onSave={() =>
        onSave(flag, {
          key: draft.key.trim(),
          name: draft.name.trim(),
          description: draft.description.trim(),
          rollout: Number(draft.rollout),
          variants,
          targetingRules,
        })
      }
    >
      <div className="field">
        <Label htmlFor="flag-dialog-key">{t('featureFlagKey')}</Label>
        <Input
          id="flag-dialog-key"
          value={draft.key}
          onChange={(event) => setDraft((prev) => ({ ...prev, key: event.target.value }))}
        />
      </div>
      <div className="field">
        <Label htmlFor="flag-dialog-name">{t('name')}</Label>
        <Input
          id="flag-dialog-name"
          value={draft.name}
          onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
        />
      </div>
      <div className="field">
        <Label htmlFor="flag-dialog-rollout">{t('featureFlagRollout')}</Label>
        <Input
          id="flag-dialog-rollout"
          type="number"
          min={0}
          max={100}
          value={draft.rollout}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, rollout: Number(event.target.value) }))
          }
        />
      </div>
      <div className="field">
        <Label htmlFor="flag-dialog-description">{t('description')}</Label>
        <Input
          id="flag-dialog-description"
          value={draft.description}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, description: event.target.value }))
          }
        />
      </div>
      <div className="field">
        <Label htmlFor="flag-dialog-variants">{t('featureFlagVariants')}</Label>
        <textarea
          id="flag-dialog-variants"
          className="textarea"
          value={draft.variantsText}
          placeholder={t('featureFlagVariantsPlaceholder')}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, variantsText: event.target.value }))
          }
        />
        <p className={variantWeight > 100 ? 'text-danger' : 'text-muted'}>
          {t('featureFlagVariantsHint').replace('{weight}', String(variantWeight))}
        </p>
      </div>
      <div className="field">
        <Label htmlFor="flag-dialog-targeting">{t('featureFlagTargetingRules')}</Label>
        <textarea
          id="flag-dialog-targeting"
          className="textarea"
          value={draft.targetingRulesText}
          placeholder={t('featureFlagTargetingPlaceholder')}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, targetingRulesText: event.target.value }))
          }
        />
        <p className={ruleLineCount === targetingRules.length ? 'text-muted' : 'text-danger'}>
          {t('featureFlagTargetingHint').replace('{count}', String(targetingRules.length))}
        </p>
      </div>
    </ResourceEditDialog>
  );
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
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit } = useWebsitePermissions(websiteId, 'featureFlags');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(DEFAULT_FLAG);
  const [search, setSearch] = useState('');
  const [editingFlag, setEditingFlag] = useState<FeatureFlag | null>(null);
  const [evaluateDraft, setEvaluateDraft] = useState({
    key: '',
    distinctId: '',
    path: '',
    environment: '',
    release: '',
  });
  const [evaluateResult, setEvaluateResult] = useState<FeatureFlagEvaluateResult | null>(null);
  const requestedFlagKey = searchParams.get('flag') ?? '';

  useEffect(() => {
    if (requestedFlagKey) setSearch(requestedFlagKey);
  }, [requestedFlagKey]);

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
    mutationFn: () =>
      api<FeatureFlag>(`/api/websites/${websiteId}/feature-flags`, {
        method: 'POST',
        body: JSON.stringify({
          key: draft.key.trim(),
          name: draft.name.trim(),
          description: draft.description.trim(),
          rollout: Number(draft.rollout),
          variants: parseVariants(draft.variantsText),
          targetingRules: parseTargetingRules(draft.targetingRulesText),
          enabled: true,
        }),
      }),
    onSuccess: (flag) => {
      setDraft(DEFAULT_FLAG);
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
    mutationFn: ({ id, patch }: { id: string; patch: Partial<FeatureFlag> }) =>
      api<FeatureFlag>(`/api/websites/${websiteId}/feature-flags/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      setEditingFlag(null);
      queryClient.invalidateQueries({ queryKey: ['feature-flags', websiteId] });
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

  const draftVariants = parseVariants(draft.variantsText);
  const draftTargetingRules = parseTargetingRules(draft.targetingRulesText);
  const draftRuleLineCount = countRuleLines(draft.targetingRulesText);
  const variantWeight = draftVariants.reduce((sum, variant) => sum + variant.weight, 0);
  const canCreate =
    Boolean(draft.key.trim() && draft.name.trim()) &&
    variantWeight <= 100 &&
    draftRuleLineCount === draftTargetingRules.length &&
    !createMutation.isPending;

  return (
    <div className="page page-feature-flags">
      <WebsitePageShell websiteId={websiteId} />

      {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

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
              {t('featureFlagEvaluateReason')}: {evaluateResult.reason}
            </div>
          </div>
        ) : null}
      </section>

      {canEdit ? (
      <section className="panel section-gap">
        <header className="panel-header">
          <div>
            <h2 className="section-title">{t('featureFlags')}</h2>
            <p className="text-muted">{t('featureFlagsLead')}</p>
          </div>
        </header>

        <div className="panel-form">
          <div className="field">
            <Label htmlFor="flag-key">{t('featureFlagKey')}</Label>
            <Input
              id="flag-key"
              value={draft.key}
              placeholder="checkout.new_flow"
              onChange={(event) => setDraft((prev) => ({ ...prev, key: event.target.value }))}
            />
          </div>
          <div className="field">
            <Label htmlFor="flag-name">{t('name')}</Label>
            <Input
              id="flag-name"
              value={draft.name}
              placeholder={t('featureFlagNamePlaceholder')}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div className="field">
            <Label htmlFor="flag-rollout">{t('featureFlagRollout')}</Label>
            <Input
              id="flag-rollout"
              type="number"
              min={0}
              max={100}
              value={draft.rollout}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, rollout: Number(event.target.value) }))
              }
            />
          </div>
          <div className="field feature-flag-description-field">
            <Label htmlFor="flag-description">{t('description')}</Label>
            <Input
              id="flag-description"
              value={draft.description}
              placeholder={t('featureFlagDescriptionPlaceholder')}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </div>
          <div className="field feature-flag-description-field">
            <Label htmlFor="flag-variants">{t('featureFlagVariants')}</Label>
            <textarea
              id="flag-variants"
              className="textarea"
              value={draft.variantsText}
              placeholder={t('featureFlagVariantsPlaceholder')}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, variantsText: event.target.value }))
              }
            />
            <p className={variantWeight > 100 ? 'text-danger' : 'text-muted'}>
              {t('featureFlagVariantsHint').replace('{weight}', String(variantWeight))}
            </p>
          </div>
          <div className="field feature-flag-description-field">
            <Label htmlFor="flag-targeting">{t('featureFlagTargetingRules')}</Label>
            <textarea
              id="flag-targeting"
              className="textarea"
              value={draft.targetingRulesText}
              placeholder={t('featureFlagTargetingPlaceholder')}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, targetingRulesText: event.target.value }))
              }
            />
            <p className={draftRuleLineCount === draftTargetingRules.length ? 'text-muted' : 'text-danger'}>
              {t('featureFlagTargetingHint').replace('{count}', String(draftTargetingRules.length))}
            </p>
          </div>
          <div className="form-actions">
            <Button
              type="button"
              variant="primary"
              disabled={!canCreate}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? t('saving') : t('createFeatureFlag')}
            </Button>
          </div>
        </div>

        {createMutation.error ? (
          <p className="text-danger">{(createMutation.error as Error).message}</p>
        ) : null}
      </section>
      ) : null}

      <section className="panel section-gap">
        <header className="cohorts-panel-head">
          <ResourceSearchField
            value={search}
            onChange={(value) => {
              setSearch(value);
              if (requestedFlagKey) {
                setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.delete('flag');
                  return next;
                }, { replace: true });
              }
            }}
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
                      {selectedFlag.targetingRules.length ? (
                        <div className="feature-flag-variants">
                          {selectedFlag.targetingRules.map((rule, index) => (
                            <span key={`${rule.field}-${rule.operator}-${index}`} className="badge">
                              {rule.field} {rule.operator} {rule.value}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </>
                  }
                  actions={
                    canEdit ? (
                      <div className="cohorts-row-actions">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingFlag(selectedFlag)}
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
                          variant="ghost"
                          size="sm"
                          className="btn-danger-text"
                          onClick={() => deleteMutation.mutate(selectedFlag.id)}
                        >
                          {t('delete')}
                        </Button>
                      </div>
                    ) : null
                  }
                >
                  <div className="detail-stats">
                    <div>
                      <span className="stat-label">{t('featureFlagRollout')}</span>
                      {canEdit ? (
                        <FeatureFlagRolloutInput
                          flag={selectedFlag}
                          onCommit={(rollout) =>
                            updateMutation.mutate({ id: selectedFlag.id, patch: { rollout } })
                          }
                        />
                      ) : (
                        <strong className="stat-value">{selectedFlag.rollout}%</strong>
                      )}
                    </div>
                    <div>
                      <span className="stat-label">{t('featureFlagExposures')}</span>
                      <strong className="stat-value">
                        {(selectedFlag.summary?.exposures ?? 0).toLocaleString()}
                      </strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('sessions')}</span>
                      <strong className="stat-value">
                        {(selectedFlag.summary?.sessions ?? 0).toLocaleString()}
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
                            {selectedFlag.summary.health.dominantShare?.toLocaleString()}%
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
                              {variant.variant} · {variant.exposures.toLocaleString()}
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
                        {selectedFlag.summary.trend.slice(-1)[0]?.exposures.toLocaleString()}{' '}
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
                            {release.release} · {release.exposures.toLocaleString()}
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
                            {environment.environment} · {environment.exposures.toLocaleString()}
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
                </MasterDetailPane>
              ) : null
            }
          />
        ) : (
          <EmptyState title={t('featureFlagsEmptyTitle')} description={t('featureFlagsEmptyBody')} />
        )}
      </section>

      {editingFlag ? (
        <FeatureFlagEditDialog
          flag={editingFlag}
          saving={updateMutation.isPending}
          error={updateMutation.error as Error | null}
          onClose={() => setEditingFlag(null)}
          onSave={(flag, patch) => updateMutation.mutate({ id: flag.id, patch })}
        />
      ) : null}
    </div>
  );
}
