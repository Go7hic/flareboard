import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { History, Plus, X } from 'lucide-react';
import { ResourceEditDialog } from './ResourceEditDialog';
import { EmptyState } from './EmptyState';
import { KvList } from './KvList';
import { StatusBadge, type StatusTone } from './StatusBadge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Skeleton } from './ui/skeleton';
import { Textarea } from './ui/textarea';
import { ConditionChips, type ChipCondition } from './product/ConditionChips';
import { FormErrors, FormSectionHead } from './product/ProductForm';
import { ProductSection } from './product/ProductSection';
import { RelativeTime } from './product/ProductTime';
import { Meter, SplitBar, type SplitSegment } from './product/SplitBar';
import { flagGroups } from './product/status';
import {
  api,
  type FeatureFlag,
  type FeatureFlagCondition,
  type FeatureFlagConditionField,
  type FeatureFlagConditionOperator,
  type FeatureFlagHistoryEntry,
  type FeatureFlagHistoryPage,
  type FeatureFlagJson,
} from '../lib/api';
import { t } from '../lib/i18n';

/** Same cap as the API (FEATURE_FLAG_PAYLOAD_MAX_BYTES in packages/shared). */
export const PAYLOAD_MAX_BYTES = 16 * 1024;

const CONDITION_FIELDS: FeatureFlagConditionField[] = [
  'person',
  'property',
  'cohort',
  'group',
  'group_property',
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
];

const VALUE_OPERATORS: FeatureFlagConditionOperator[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
  'exists',
  'not_exists',
];

const COHORT_OPERATORS: FeatureFlagConditionOperator[] = ['in_cohort', 'not_in_cohort'];

const KEYED_FIELDS = new Set<FeatureFlagConditionField>(['person', 'property', 'group', 'group_property']);

/** Six categorical slots; a 7th+ variant gets the neutral "other" color instead of a cycled hue. */
export function variantColor(index: number) {
  return index >= 0 && index < 6 ? `var(--chart-${index + 1})` : 'var(--product-other)';
}

type ConditionDraft = {
  id: string;
  field: FeatureFlagConditionField;
  key: string;
  groupType: string;
  operator: FeatureFlagConditionOperator;
  value: string;
};

type GroupDraft = { id: string; conditions: ConditionDraft[]; rollout: string; variant: string; description: string };

type VariantDraft = { id: string; key: string; name: string; weight: string; payloadText: string };

type FlagDraft = {
  key: string;
  name: string;
  description: string;
  variants: VariantDraft[];
  groups: GroupDraft[];
  payloadText: string;
  earlyAccess: boolean;
  earlyAccessName: string;
  earlyAccessDescription: string;
};

export type FeatureFlagBody = {
  key: string;
  name: string;
  description: string;
  variants: Array<{ key: string; name: string; weight: number; payload: FeatureFlagJson }>;
  conditionGroups: Array<{
    conditions: FeatureFlagCondition[];
    rollout: number;
    variant: string | null;
    description?: string;
  }>;
  payload: FeatureFlagJson;
  earlyAccess: { name: string; description: string } | null;
};

let draftIds = 0;
function draftId() {
  draftIds += 1;
  return `draft-${draftIds}`;
}

function payloadToText(payload: FeatureFlagJson | undefined) {
  return payload === undefined || payload === null ? '' : JSON.stringify(payload, null, 2);
}

function emptyCondition(): ConditionDraft {
  return { id: draftId(), field: 'person', key: '', groupType: '', operator: 'equals', value: '' };
}

function emptyGroup(): GroupDraft {
  return { id: draftId(), conditions: [], rollout: '100', variant: '', description: '' };
}

function draftFromFlag(flag: FeatureFlag | null): FlagDraft {
  if (!flag) {
    return {
      key: '',
      name: '',
      description: '',
      variants: [],
      groups: [emptyGroup()],
      payloadText: '',
      earlyAccess: false,
      earlyAccessName: '',
      earlyAccessDescription: '',
    };
  }
  return {
    key: flag.key,
    name: flag.name,
    description: flag.description,
    variants: flag.variants.map((variant) => ({
      id: draftId(),
      key: variant.key,
      name: variant.name,
      weight: String(variant.weight),
      payloadText: payloadToText(variant.payload),
    })),
    groups: flagGroups(flag).map((group) => ({
      id: draftId(),
      rollout: String(group.rollout),
      variant: group.variant ?? '',
      // Kept on save: the editor used to drop group names set through the API.
      description: group.description ?? '',
      conditions: group.conditions.map((condition) => ({
        id: draftId(),
        field: condition.field,
        key: condition.key ?? '',
        groupType: condition.groupType ?? '',
        operator: condition.operator,
        value: condition.value,
      })),
    })),
    payloadText: payloadToText(flag.payload),
    earlyAccess: Boolean(flag.earlyAccess),
    earlyAccessName: flag.earlyAccess?.name ?? '',
    earlyAccessDescription: flag.earlyAccess?.description ?? '',
  };
}

type PayloadCheck = { ok: true; value: FeatureFlagJson } | { ok: false; error: string };

/** Empty text means "no payload". */
export function checkPayloadText(text: string): PayloadCheck {
  if (!text.trim()) return { ok: true, value: null };
  let value: FeatureFlagJson;
  try {
    value = JSON.parse(text) as FeatureFlagJson;
  } catch {
    return { ok: false, error: t('featureFlagPayloadInvalid') };
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > PAYLOAD_MAX_BYTES) {
    return { ok: false, error: t('featureFlagPayloadTooLarge') };
  }
  return { ok: true, value };
}

function percent(text: string) {
  const value = Number(text);
  return text.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
}

function conditionComplete(condition: ConditionDraft) {
  if (KEYED_FIELDS.has(condition.field) && !condition.key.trim()) return false;
  if (condition.field === 'group_property' && !condition.groupType.trim()) return false;
  if (condition.field === 'cohort') return Boolean(condition.value);
  if (condition.operator === 'exists' || condition.operator === 'not_exists') return true;
  return Boolean(condition.value.trim());
}

function buildBody(draft: FlagDraft): { body: FeatureFlagBody | null; errors: string[] } {
  const errors: string[] = [];
  if (!draft.key.trim() || !draft.name.trim()) errors.push(t('featureFlagErrorKeyName'));

  const variantKeys = new Set<string>();
  let weight = 0;
  const variants: FeatureFlagBody['variants'] = [];
  for (const variant of draft.variants) {
    const key = variant.key.trim();
    const variantWeight = percent(variant.weight);
    const payload = checkPayloadText(variant.payloadText);
    if (!key || variantWeight === null) {
      errors.push(t('featureFlagErrorVariant'));
      continue;
    }
    if (variantKeys.has(key)) errors.push(t('featureFlagErrorVariantDuplicate').replace('{key}', key));
    variantKeys.add(key);
    weight += variantWeight;
    if (!payload.ok) {
      errors.push(`${key}: ${payload.error}`);
      continue;
    }
    variants.push({ key, name: variant.name.trim() || key, weight: variantWeight, payload: payload.value });
  }
  if (weight > 100) errors.push(t('featureFlagErrorWeights'));

  const conditionGroups: FeatureFlagBody['conditionGroups'] = [];
  draft.groups.forEach((group, index) => {
    const rollout = percent(group.rollout);
    if (rollout === null) errors.push(t('featureFlagErrorRollout').replace('{group}', String(index + 1)));
    if (group.conditions.some((condition) => !conditionComplete(condition))) {
      errors.push(t('featureFlagErrorCondition').replace('{group}', String(index + 1)));
    }
    if (group.variant && !variantKeys.has(group.variant)) {
      errors.push(t('featureFlagErrorOverride').replace('{group}', String(index + 1)));
    }
    conditionGroups.push({
      rollout: rollout ?? 0,
      variant: group.variant || null,
      ...(group.description.trim() ? { description: group.description.trim() } : {}),
      conditions: group.conditions.map((condition) => {
        const out: FeatureFlagCondition = {
          field: condition.field,
          operator: condition.operator,
          value: condition.operator === 'exists' || condition.operator === 'not_exists' ? '' : condition.value.trim(),
        };
        if (KEYED_FIELDS.has(condition.field)) out.key = condition.key.trim();
        if (condition.field === 'group_property') out.groupType = condition.groupType.trim();
        return out;
      }),
    });
  });
  if (!conditionGroups.length) errors.push(t('featureFlagErrorNoGroups'));

  const payload = variants.length ? { ok: true as const, value: null } : checkPayloadText(draft.payloadText);
  if (!payload.ok) errors.push(payload.error);
  if (draft.earlyAccess && !draft.earlyAccessName.trim()) errors.push(t('featureFlagErrorEarlyAccessName'));

  if (errors.length) return { body: null, errors };
  return {
    errors,
    body: {
      key: draft.key.trim(),
      name: draft.name.trim(),
      description: draft.description.trim(),
      variants,
      conditionGroups,
      payload: payload.ok ? payload.value : null,
      earlyAccess: draft.earlyAccess
        ? { name: draft.earlyAccessName.trim(), description: draft.earlyAccessDescription.trim() }
        : null,
    },
  };
}

function fieldLabel(field: FeatureFlagConditionField) {
  return t(`featureFlagField_${field}`);
}

function operatorLabel(operator: FeatureFlagConditionOperator) {
  return t(`featureFlagOperator_${operator}`);
}

type Cohort = { id: string; name: string };

function useCohorts(websiteId: string) {
  return useQuery({
    queryKey: ['cohorts', websiteId],
    queryFn: () => api<Cohort[]>(`/api/websites/${websiteId}/cohorts`),
  });
}

function ConditionRow({
  condition,
  cohorts,
  idPrefix,
  onChange,
  onRemove,
}: {
  condition: ConditionDraft;
  cohorts: Cohort[];
  idPrefix: string;
  onChange: (next: ConditionDraft) => void;
  onRemove: () => void;
}) {
  const operators = condition.field === 'cohort' ? COHORT_OPERATORS : VALUE_OPERATORS;
  const hidesValue = condition.operator === 'exists' || condition.operator === 'not_exists';
  return (
    <div className="product-cond-row">
      <select
        className="select"
        aria-label={t('featureFlagConditionField')}
        value={condition.field}
        onChange={(event) => {
          const field = event.target.value as FeatureFlagConditionField;
          const operator =
            field === 'cohort'
              ? 'in_cohort'
              : COHORT_OPERATORS.includes(condition.operator)
                ? 'equals'
                : condition.operator;
          onChange({ ...condition, field, operator, value: field === 'cohort' ? '' : condition.value });
        }}
      >
        {CONDITION_FIELDS.map((field) => (
          <option key={field} value={field}>
            {fieldLabel(field)}
          </option>
        ))}
      </select>
      {condition.field === 'group_property' ? (
        <Input
          id={`${idPrefix}-group-type`}
          aria-label={t('featureFlagConditionGroupType')}
          placeholder={t('featureFlagConditionGroupType')}
          value={condition.groupType}
          onChange={(event) => onChange({ ...condition, groupType: event.target.value })}
        />
      ) : null}
      {KEYED_FIELDS.has(condition.field) ? (
        <Input
          className="mono"
          aria-label={t('featureFlagConditionKey')}
          placeholder={condition.field === 'group' ? t('featureFlagConditionGroupType') : t('featureFlagConditionKey')}
          value={condition.key}
          onChange={(event) => onChange({ ...condition, key: event.target.value })}
        />
      ) : null}
      <select
        className="select"
        aria-label={t('featureFlagConditionOperator')}
        value={condition.operator}
        onChange={(event) => onChange({ ...condition, operator: event.target.value as FeatureFlagConditionOperator })}
      >
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {operatorLabel(operator)}
          </option>
        ))}
      </select>
      {condition.field === 'cohort' ? (
        <select
          className="select"
          aria-label={t('featureFlagField_cohort')}
          value={condition.value}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
        >
          <option value="">{t('featureFlagChooseCohort')}</option>
          {condition.value && !cohorts.some((cohort) => cohort.id === condition.value) ? (
            <option value={condition.value}>{t('featureFlagUnknownCohort')}</option>
          ) : null}
          {cohorts.map((cohort) => (
            <option key={cohort.id} value={cohort.id}>
              {cohort.name}
            </option>
          ))}
        </select>
      ) : hidesValue ? null : (
        <Input
          aria-label={t('featureFlagConditionValue')}
          placeholder={t('featureFlagConditionValue')}
          value={condition.value}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
        />
      )}
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t('featureFlagRemoveCondition')} onClick={onRemove}>
        <X size={14} strokeWidth={2} aria-hidden />
      </Button>
    </div>
  );
}

function PayloadField({
  id,
  label,
  value,
  onChange,
  hideLabel = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** When a disclosure summary already names the field. */
  hideLabel?: boolean;
}) {
  const check = checkPayloadText(value);
  return (
    <div className="field product-field">
      <Label htmlFor={id} className={hideLabel ? 'visually-hidden' : undefined}>
        {label}
      </Label>
      <Textarea
        id={id}
        className="mono product-code-input"
        spellCheck={false}
        value={value}
        placeholder='{"headline": "Try the new checkout"}'
        aria-invalid={!check.ok}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className={check.ok ? 'field-hint' : 'field-hint text-danger'}>
        {check.ok ? t('featureFlagPayloadHint') : check.error}
      </p>
    </div>
  );
}

export function FeatureFlagEditorDialog({
  websiteId,
  flag,
  saving,
  error,
  onClose,
  onSave,
}: {
  websiteId: string;
  /** Null creates a new flag. */
  flag: FeatureFlag | null;
  saving: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: (body: FeatureFlagBody) => void;
}) {
  const [draft, setDraft] = useState<FlagDraft>(() => draftFromFlag(flag));
  useEffect(() => setDraft(draftFromFlag(flag)), [flag]);
  const cohorts = useCohorts(websiteId).data ?? [];
  const { body, errors } = useMemo(() => buildBody(draft), [draft]);
  const [showErrors, setShowErrors] = useState(false);
  const variantWeight = draft.variants.reduce((sum, variant) => sum + (Number(variant.weight) || 0), 0);

  function updateGroup(groupId: string, update: (group: GroupDraft) => GroupDraft) {
    setDraft((prev) => ({ ...prev, groups: prev.groups.map((group) => (group.id === groupId ? update(group) : group)) }));
  }

  function updateVariant(variantId: string, patch: Partial<VariantDraft>) {
    setDraft((prev) => ({
      ...prev,
      variants: prev.variants.map((variant) => (variant.id === variantId ? { ...variant, ...patch } : variant)),
    }));
  }

  const weightSegments: SplitSegment[] = draft.variants
    .map((variant, index) => ({
      key: variant.id,
      label: variant.key.trim() || t('featureFlagVariantKey'),
      value: Math.max(0, Number(variant.weight) || 0),
      color: variantColor(index),
      mono: true,
    }))
    .concat(
      variantWeight < 100
        ? [{ key: 'rest', label: t('productFlagRemainder'), value: 100 - variantWeight, color: 'var(--product-other)', mono: false }]
        : [],
    );

  const title = flag ? t('featureFlagEdit') : t('createFeatureFlag');
  return (
    <ResourceEditDialog
      title={title}
      description={flag ? undefined : t('productFlagCreateLead')}
      ariaLabel={title}
      panelClassName="product-dialog product-dialog--wide"
      bodyClassName="product-form"
      saving={saving}
      error={error}
      canSave={!saving}
      saveLabel={flag ? undefined : t('createFeatureFlag')}
      onClose={onClose}
      onSave={() => {
        if (body) onSave(body);
        else setShowErrors(true);
      }}
    >
      <div className="product-form-grid">
        <div className="field product-field">
          <Label htmlFor="flag-editor-name">{t('name')}</Label>
          <Input
            id="flag-editor-name"
            value={draft.name}
            placeholder={t('featureFlagNamePlaceholder')}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
        </div>
        <div className="field product-field">
          <Label htmlFor="flag-editor-key">{t('featureFlagKey')}</Label>
          <Input
            id="flag-editor-key"
            className="mono"
            value={draft.key}
            placeholder="checkout.new_flow"
            onChange={(event) => setDraft((prev) => ({ ...prev, key: event.target.value }))}
          />
        </div>
        <div className="field product-field product-form-wide">
          <Label htmlFor="flag-editor-description">{t('description')}</Label>
          <Input
            id="flag-editor-description"
            value={draft.description}
            placeholder={t('featureFlagDescriptionPlaceholder')}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
      </div>

      <section className="product-form-section">
        <FormSectionHead
          title={t('featureFlagReleaseConditions')}
          lead={t('featureFlagReleaseConditionsLead')}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={draft.groups.length >= 20}
              onClick={() => setDraft((prev) => ({ ...prev, groups: [...prev.groups, emptyGroup()] }))}
            >
              <Plus size={14} strokeWidth={2} aria-hidden />
              {t('featureFlagAddGroup')}
            </Button>
          }
        />
        <div className="product-groups-edit">
          {draft.groups.map((group, index) => (
            <div key={group.id} className="product-group-edit">
              {index > 0 ? (
                <div className="product-or" aria-hidden>
                  <span>{t('featureFlagOr')}</span>
                </div>
              ) : null}
              <div className="product-group-rail">
                <div className="product-group-edit-head">
                  <span className="product-group-edit-title">{t('featureFlagGroupTitle').replace('{n}', String(index + 1))}</span>
                  <Input
                    className="product-group-name"
                    aria-label={t('productFlagGroupName')}
                    placeholder={t('productFlagGroupNamePlaceholder')}
                    value={group.description}
                    maxLength={120}
                    onChange={(event) => updateGroup(group.id, (current) => ({ ...current, description: event.target.value }))}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={draft.groups.length <= 1}
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, groups: prev.groups.filter((item) => item.id !== group.id) }))
                    }
                  >
                    {t('featureFlagRemoveGroup')}
                  </Button>
                </div>
                {group.conditions.length ? (
                  <div className="product-cond-list">
                    {group.conditions.map((condition, conditionIndex) => (
                      <div key={condition.id} className="product-cond">
                        <span className="product-cond-joiner">
                          {conditionIndex === 0 ? t('featureFlagWhere') : t('featureFlagAnd')}
                        </span>
                        <ConditionRow
                          condition={condition}
                          cohorts={cohorts}
                          idPrefix={condition.id}
                          onChange={(next) =>
                            updateGroup(group.id, (current) => ({
                              ...current,
                              conditions: current.conditions.map((item) => (item.id === condition.id ? next : item)),
                            }))
                          }
                          onRemove={() =>
                            updateGroup(group.id, (current) => ({
                              ...current,
                              conditions: current.conditions.filter((item) => item.id !== condition.id),
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="product-muted-line">{t('featureFlagGroupEveryone')}</p>
                )}
                <div className="product-group-edit-foot">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={group.conditions.length >= 12}
                    onClick={() =>
                      updateGroup(group.id, (current) => ({ ...current, conditions: [...current.conditions, emptyCondition()] }))
                    }
                  >
                    <Plus size={14} strokeWidth={2} aria-hidden />
                    {t('featureFlagAddCondition')}
                  </Button>
                  <label className="product-inline-field">
                    <span>{t('productFlagRolloutLabel')}</span>
                    <Input
                      className="product-number-input"
                      type="number"
                      min={0}
                      max={100}
                      value={group.rollout}
                      onChange={(event) => updateGroup(group.id, (current) => ({ ...current, rollout: event.target.value }))}
                    />
                    <span>{t('productFlagPercentOfMatching')}</span>
                  </label>
                  {draft.variants.length ? (
                    <label className="product-inline-field">
                      <span>{t('featureFlagVariantOverride')}</span>
                      <select
                        className="select"
                        value={group.variant}
                        onChange={(event) => updateGroup(group.id, (current) => ({ ...current, variant: event.target.value }))}
                      >
                        <option value="">{t('featureFlagVariantOverrideNone')}</option>
                        {draft.variants
                          .filter((variant) => variant.key.trim())
                          .map((variant) => (
                            <option key={variant.id} value={variant.key.trim()}>
                              {variant.key.trim()}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="product-form-section">
        <FormSectionHead
          title={t('featureFlagVariants')}
          lead={
            draft.variants.length
              ? t('featureFlagVariantsHint').replace('{weight}', String(variantWeight))
              : t('featureFlagBooleanHint')
          }
          leadTone={variantWeight > 100 ? 'danger' : undefined}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={draft.variants.length >= 8}
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  variants: [...prev.variants, { id: draftId(), key: '', name: '', weight: '0', payloadText: '' }],
                }))
              }
            >
              <Plus size={14} strokeWidth={2} aria-hidden />
              {t('featureFlagAddVariant')}
            </Button>
          }
        />
        {draft.variants.length ? (
          <>
            <SplitBar segments={weightSegments} ariaLabel={t('productFlagConfiguredSplit')} legend={false} />
            <div className="product-variant-edit-list">
              <div className="product-variant-edit-head" aria-hidden>
                <span>{t('featureFlagVariantKey')}</span>
                <span>{t('name')}</span>
                <span>{t('productFlagWeight')}</span>
                <span />
              </div>
              {draft.variants.map((variant, index) => (
                <div key={variant.id} className="product-variant-edit">
                  <div className="product-variant-edit-row">
                    <div className="product-variant-key">
                      <span
                        className="chart-legend-key is-box"
                        style={{ '--legend-color': variantColor(index) } as React.CSSProperties}
                        aria-hidden
                      />
                      <Input
                        className="mono"
                        aria-label={t('featureFlagVariantKey')}
                        placeholder="variant_a"
                        value={variant.key}
                        onChange={(event) => updateVariant(variant.id, { key: event.target.value })}
                      />
                    </div>
                    <Input
                      aria-label={t('name')}
                      placeholder={t('name')}
                      value={variant.name}
                      onChange={(event) => updateVariant(variant.id, { name: event.target.value })}
                    />
                    <label className="product-inline-field">
                      <Input
                        className="product-number-input"
                        type="number"
                        min={0}
                        max={100}
                        aria-label={t('featureFlagVariantWeight')}
                        value={variant.weight}
                        onChange={(event) => updateVariant(variant.id, { weight: event.target.value })}
                      />
                      <span>%</span>
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('featureFlagRemoveVariant')}
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, variants: prev.variants.filter((item) => item.id !== variant.id) }))
                      }
                    >
                      <X size={14} strokeWidth={2} aria-hidden />
                    </Button>
                  </div>
                  <details className="product-disclosure" open={Boolean(variant.payloadText) || undefined}>
                    <summary>{t('featureFlagVariantPayload')}</summary>
                    <PayloadField
                      id={`${variant.id}-payload`}
                      label={t('featureFlagVariantPayload')}
                      hideLabel
                      value={variant.payloadText}
                      onChange={(payloadText) => updateVariant(variant.id, { payloadText })}
                    />
                  </details>
                </div>
              ))}
            </div>
          </>
        ) : (
          <PayloadField
            id="flag-editor-payload"
            label={t('featureFlagPayload')}
            value={draft.payloadText}
            onChange={(payloadText) => setDraft((prev) => ({ ...prev, payloadText }))}
          />
        )}
      </section>

      <section className="product-form-section">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.earlyAccess}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                earlyAccess: event.target.checked,
                earlyAccessName: prev.earlyAccessName || prev.name,
              }))
            }
          />
          <span>{t('featureFlagEarlyAccess')}</span>
        </label>
        <p className="product-form-section-lead">{t('featureFlagEarlyAccessLead')}</p>
        {draft.earlyAccess ? (
          <div className="product-form-grid">
            <div className="field product-field">
              <Label htmlFor="flag-editor-ea-name">{t('featureFlagEarlyAccessName')}</Label>
              <Input
                id="flag-editor-ea-name"
                value={draft.earlyAccessName}
                onChange={(event) => setDraft((prev) => ({ ...prev, earlyAccessName: event.target.value }))}
              />
            </div>
            <div className="field product-field product-form-wide">
              <Label htmlFor="flag-editor-ea-description">{t('featureFlagEarlyAccessDescription')}</Label>
              <Textarea
                id="flag-editor-ea-description"
                value={draft.earlyAccessDescription}
                onChange={(event) => setDraft((prev) => ({ ...prev, earlyAccessDescription: event.target.value }))}
              />
            </div>
          </div>
        ) : null}
      </section>

      {showErrors ? <FormErrors errors={errors} /> : null}
    </ResourceEditDialog>
  );
}

/** One line per condition, for read-only summaries. */
export function describeCondition(condition: FeatureFlagCondition, cohorts: Cohort[] = []) {
  if (condition.field === 'cohort') {
    const cohort = cohorts.find((item) => item.id === condition.value);
    return `${operatorLabel(condition.operator)} ${cohort ? cohort.name : t('featureFlagUnknownCohort')}`;
  }
  const subject =
    condition.field === 'group_property'
      ? `${fieldLabel(condition.field)} ${condition.groupType}.${condition.key}`
      : condition.key
        ? `${fieldLabel(condition.field)} ${condition.key}`
        : fieldLabel(condition.field);
  const value = condition.operator === 'exists' || condition.operator === 'not_exists' ? '' : ` ${condition.value}`;
  return `${subject} ${operatorLabel(condition.operator)}${value}`;
}

/** A flag condition as a chip (field + key, operator, value; cohorts by name). */
export function conditionChip(condition: FeatureFlagCondition, cohorts: Cohort[] = []): ChipCondition {
  if (condition.field === 'cohort') {
    const cohort = cohorts.find((item) => item.id === condition.value);
    return {
      field: fieldLabel('cohort'),
      operator: operatorLabel(condition.operator),
      value: cohort ? cohort.name : t('featureFlagUnknownCohort'),
      plainValue: true,
    };
  }
  const valueless = condition.operator === 'exists' || condition.operator === 'not_exists';
  return {
    field: fieldLabel(condition.field),
    subject:
      condition.field === 'group_property'
        ? `${condition.groupType ?? ''}.${condition.key ?? ''}`
        : condition.key || undefined,
    operator: operatorLabel(condition.operator),
    value: valueless ? undefined : condition.value,
  };
}

/**
 * Inline rollout editor with a local draft so typing does not PATCH per keystroke; the change
 * is committed on blur or Enter, and only when the value is valid (0-100) and different.
 */
function RolloutInput({ rollout, onCommit }: { rollout: number; onCommit: (rollout: number) => void }) {
  const [draft, setDraft] = useState(String(rollout));
  useEffect(() => setDraft(String(rollout)), [rollout]);

  function commit() {
    const next = Number(draft);
    if (draft.trim() === '' || !Number.isInteger(next) || next < 0 || next > 100) {
      setDraft(String(rollout));
      return;
    }
    if (next !== rollout) onCommit(next);
  }

  return (
    <label className="product-inline-field product-rollout-input">
      <Input
        className="product-number-input"
        type="number"
        min={0}
        max={100}
        value={draft}
        aria-label={t('featureFlagRollout')}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <span>%</span>
    </label>
  );
}

/**
 * Release conditions tab of a flag: condition groups as chips with their rollout, the
 * configured variant split, payloads and early access. `onRolloutCommit` makes the rollout of
 * a single-group flag editable in place.
 */
export function FeatureFlagConditionSummary({
  websiteId,
  flag,
  onRolloutCommit,
}: {
  websiteId: string;
  flag: FeatureFlag;
  onRolloutCommit?: (rollout: number) => void;
}) {
  const cohorts = useCohorts(websiteId).data ?? [];
  const groups = flagGroups(flag);
  const weight = flag.variants.reduce((sum, variant) => sum + variant.weight, 0);
  const segments: SplitSegment[] = flag.variants.map((variant, index) => ({
    key: variant.key,
    label: variant.key,
    value: variant.weight,
    color: variantColor(index),
    mono: true,
    detail: variant.name && variant.name !== variant.key ? variant.name : undefined,
  }));
  if (flag.variants.length && weight < 100) {
    segments.push({ key: '__rest', label: t('productFlagRemainder'), value: 100 - weight, color: 'var(--product-other)' });
  }
  const variantPayloads = flag.variants.filter((variant) => variant.payload !== undefined && variant.payload !== null);

  return (
    <>
      <ProductSection title={t('featureFlagReleaseConditions')} description={t('featureFlagReleaseConditionsLead')}>
        <ol className="product-groups">
          {groups.map((group, index) => (
            <li key={index} className="product-group">
              {index > 0 ? (
                <div className="product-or" aria-hidden>
                  <span>{t('featureFlagOr')}</span>
                </div>
              ) : null}
              <div className="product-group-head">
                <div className="product-group-title">
                  <span className="product-group-name-label">
                    {t('featureFlagGroupTitle').replace('{n}', String(index + 1))}
                  </span>
                  {group.description ? <span className="product-group-description">{group.description}</span> : null}
                </div>
                <div className="product-group-rollout">
                  {onRolloutCommit && groups.length === 1 ? (
                    <RolloutInput rollout={group.rollout} onCommit={onRolloutCommit} />
                  ) : (
                    <span className="product-group-percent">{group.rollout}%</span>
                  )}
                  <Meter value={group.rollout} label={t('featureFlagRollout')} />
                  <span className="product-group-rollout-label">{t('featureFlagOfMatching')}</span>
                </div>
              </div>
              <ConditionChips
                conditions={group.conditions.map((condition) => conditionChip(condition, cohorts))}
                emptyLabel={t('productFlagMatchesEveryone')}
              />
              {group.variant ? (
                <p className="product-group-served">
                  {t('productFlagServes')} <span className="mono">{group.variant}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </ProductSection>

      {flag.variants.length ? (
        <ProductSection title={t('featureFlagVariants')} description={t('productFlagConfiguredSplitLead')}>
          <SplitBar segments={segments} ariaLabel={t('productFlagConfiguredSplit')} />
          {variantPayloads.length ? (
            <KvList
              className="product-payload-list"
              items={variantPayloads.map((variant) => ({
                key: variant.key,
                label: <span className="mono">{variant.key}</span>,
                value: <pre className="product-json">{payloadToText(variant.payload)}</pre>,
              }))}
            />
          ) : null}
        </ProductSection>
      ) : null}

      {flag.payload !== null && flag.payload !== undefined && !flag.variants.length ? (
        <ProductSection title={t('featureFlagPayload')}>
          <pre className="product-json">{payloadToText(flag.payload)}</pre>
        </ProductSection>
      ) : null}

      {flag.earlyAccess ? (
        <ProductSection title={t('featureFlagEarlyAccess')} description={t('featureFlagEarlyAccessLead')}>
          <KvList
            items={[
              { key: 'name', label: t('featureFlagEarlyAccessName'), value: flag.earlyAccess.name },
              {
                key: 'description',
                label: t('featureFlagEarlyAccessDescription'),
                value: flag.earlyAccess.description || <span className="text-muted">–</span>,
              },
            ]}
          />
        </ProductSection>
      ) : null}
    </>
  );
}

function historyAction(entry: FeatureFlagHistoryEntry): { label: string; tone: StatusTone } {
  if (entry.action === 'create') return { label: t('featureFlagHistoryCreated'), tone: 'success' };
  if (entry.action === 'delete') return { label: t('featureFlagHistoryDeleted'), tone: 'danger' };
  return entry.metadata?.experimentId
    ? { label: t('featureFlagHistoryShipped'), tone: 'info' }
    : { label: t('featureFlagHistoryUpdated'), tone: 'neutral' };
}

function historyValue(value: unknown) {
  if (value === undefined || value === null) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

const HISTORY_PAGE_SIZE = 20;

export function FeatureFlagHistory({ websiteId, flagId }: { websiteId: string; flagId: string }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [flagId]);
  const historyQuery = useQuery({
    queryKey: ['feature-flag-history', websiteId, flagId, page],
    queryFn: () =>
      api<FeatureFlagHistoryPage>(
        `/api/websites/${websiteId}/feature-flags/${flagId}/history?page=${page}&pageSize=${HISTORY_PAGE_SIZE}`,
      ),
    placeholderData: keepPreviousData,
  });

  let body: React.ReactNode;
  if (historyQuery.isLoading) {
    body = (
      <div className="product-timeline-skeleton" aria-busy>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  } else if (historyQuery.error) {
    body = (
      <p className="text-danger">
        {(historyQuery.error as Error).message}{' '}
        <Button type="button" variant="link" size="sm" onClick={() => historyQuery.refetch()}>
          {t('retry')}
        </Button>
      </p>
    );
  } else if (!historyQuery.data?.items.length) {
    body = <EmptyState icon={<History strokeWidth={2} />} title={t('featureFlagHistoryEmpty')} />;
  } else {
    const history = historyQuery.data;
    const pages = Math.max(1, Math.ceil(history.total / HISTORY_PAGE_SIZE));
    body = (
      <>
        <ol className="product-timeline">
          {history.items.map((entry) => {
            const action = historyAction(entry);
            const changes = entry.action === 'update' ? (entry.metadata?.changes ?? []) : [];
            const before = (entry.metadata?.before ?? {}) as Record<string, unknown>;
            const after = (entry.metadata?.after ?? {}) as Record<string, unknown>;
            return (
              <li key={entry.id} className="product-timeline-item">
                <div className="product-timeline-head">
                  <StatusBadge tone={action.tone} dot={false}>
                    {action.label}
                  </StatusBadge>
                  <span className="product-timeline-who">{entry.username}</span>
                  <RelativeTime className="product-timeline-when" value={entry.createdAt} />
                </div>
                {changes.length ? (
                  <details className="product-disclosure">
                    <summary>
                      {t('productHistoryChanged').replace(
                        '{fields}',
                        changes.map((field) => t(`featureFlagHistoryField_${field}`)).join(', '),
                      )}
                    </summary>
                    {changes.map((field) => (
                      <div key={field} className="product-diff">
                        <span className="product-diff-field">{t(`featureFlagHistoryField_${field}`)}</span>
                        <div className="product-diff-cols">
                          <div>
                            <span className="product-diff-label">{t('featureFlagHistoryBefore')}</span>
                            <pre className="product-json">{historyValue(before[field])}</pre>
                          </div>
                          <div>
                            <span className="product-diff-label">{t('featureFlagHistoryAfter')}</span>
                            <pre className="product-json">{historyValue(after[field])}</pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
        {pages > 1 ? (
          <div className="product-pager">
            <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t('featureFlagHistoryNewer')}
            </Button>
            <span className="product-pager-label">
              {page} / {pages}
            </span>
            <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              {t('featureFlagHistoryOlder')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <ProductSection title={t('productHistoryTitle')} description={t('productHistoryLead')}>
      {body}
    </ProductSection>
  );
}
