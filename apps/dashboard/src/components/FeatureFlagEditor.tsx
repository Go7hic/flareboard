import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { ResourceEditDialog } from './ResourceEditDialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
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
import { formatDateTime } from '../lib/format';
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

type ConditionDraft = {
  id: string;
  field: FeatureFlagConditionField;
  key: string;
  groupType: string;
  operator: FeatureFlagConditionOperator;
  value: string;
};

type GroupDraft = { id: string; conditions: ConditionDraft[]; rollout: string; variant: string };

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
  conditionGroups: Array<{ conditions: FeatureFlagCondition[]; rollout: number; variant: string | null }>;
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
  return { id: draftId(), conditions: [], rollout: '100', variant: '' };
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
  const groups = flag.conditionGroups?.length
    ? flag.conditionGroups
    : [{ conditions: flag.targetingRules ?? [], rollout: flag.rollout, variant: null }];
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
    groups: groups.map((group) => ({
      id: draftId(),
      rollout: String(group.rollout),
      variant: group.variant ?? '',
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
    <div className="flag-condition-row">
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const check = checkPayloadText(value);
  return (
    <div className="field">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        className="mono flag-payload-input"
        spellCheck={false}
        value={value}
        placeholder='{"headline": "Try the new checkout"}'
        aria-invalid={!check.ok}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className={check.ok ? 'text-muted' : 'text-danger'}>
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

  const title = flag ? t('featureFlagEdit') : t('createFeatureFlag');
  return (
    <ResourceEditDialog
      title={title}
      ariaLabel={title}
      panelClassName="feature-flag-dialog"
      bodyClassName="flag-editor"
      saving={saving}
      error={error}
      canSave={Boolean(body) && !saving}
      onClose={onClose}
      onSave={() => body && onSave(body)}
    >
      <div className="flag-editor-grid">
        <div className="field">
          <Label htmlFor="flag-editor-key">{t('featureFlagKey')}</Label>
          <Input
            id="flag-editor-key"
            className="mono"
            value={draft.key}
            placeholder="checkout.new_flow"
            onChange={(event) => setDraft((prev) => ({ ...prev, key: event.target.value }))}
          />
        </div>
        <div className="field">
          <Label htmlFor="flag-editor-name">{t('name')}</Label>
          <Input
            id="flag-editor-name"
            value={draft.name}
            placeholder={t('featureFlagNamePlaceholder')}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
        </div>
        <div className="field flag-editor-wide">
          <Label htmlFor="flag-editor-description">{t('description')}</Label>
          <Input
            id="flag-editor-description"
            value={draft.description}
            placeholder={t('featureFlagDescriptionPlaceholder')}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
      </div>

      <section className="flag-editor-section">
        <header className="flag-editor-section-head">
          <div>
            <h3 className="flag-editor-section-title">{t('featureFlagReleaseConditions')}</h3>
            <p className="text-muted">{t('featureFlagReleaseConditionsLead')}</p>
          </div>
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
        </header>
        {draft.groups.map((group, index) => (
          <div key={group.id} className="flag-group">
            {index > 0 ? <span className="flag-group-or">{t('featureFlagOr')}</span> : null}
            <div className="flag-group-head">
              <strong>{t('featureFlagGroupTitle').replace('{n}', String(index + 1))}</strong>
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
              <div className="flag-condition-list">
                {group.conditions.map((condition, conditionIndex) => (
                  <div key={condition.id} className="flag-condition">
                    <span className="flag-condition-joiner text-muted">
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
              <p className="text-muted">{t('featureFlagGroupEveryone')}</p>
            )}
            <div className="flag-group-foot">
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
              <label className="flag-inline-field">
                <span className="text-muted">{t('featureFlagRollout')}</span>
                <input
                  className="input feature-flag-rollout-input"
                  type="number"
                  min={0}
                  max={100}
                  value={group.rollout}
                  onChange={(event) => updateGroup(group.id, (current) => ({ ...current, rollout: event.target.value }))}
                />
              </label>
              {draft.variants.length ? (
                <label className="flag-inline-field">
                  <span className="text-muted">{t('featureFlagVariantOverride')}</span>
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
        ))}
      </section>

      <section className="flag-editor-section">
        <header className="flag-editor-section-head">
          <div>
            <h3 className="flag-editor-section-title">{t('featureFlagVariants')}</h3>
            <p className={variantWeight > 100 ? 'text-danger' : 'text-muted'}>
              {draft.variants.length
                ? t('featureFlagVariantsHint').replace('{weight}', String(variantWeight))
                : t('featureFlagBooleanHint')}
            </p>
          </div>
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
        </header>
        {draft.variants.map((variant) => (
          <div key={variant.id} className="flag-variant">
            <div className="flag-variant-row">
              <Input
                className="mono"
                aria-label={t('featureFlagVariantKey')}
                placeholder={t('featureFlagVariantKey')}
                value={variant.key}
                onChange={(event) => updateVariant(variant.id, { key: event.target.value })}
              />
              <Input
                aria-label={t('name')}
                placeholder={t('name')}
                value={variant.name}
                onChange={(event) => updateVariant(variant.id, { name: event.target.value })}
              />
              <label className="flag-inline-field">
                <span className="text-muted">%</span>
                <input
                  className="input feature-flag-rollout-input"
                  type="number"
                  min={0}
                  max={100}
                  aria-label={t('featureFlagVariantWeight')}
                  value={variant.weight}
                  onChange={(event) => updateVariant(variant.id, { weight: event.target.value })}
                />
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
            <PayloadField
              id={`${variant.id}-payload`}
              label={t('featureFlagVariantPayload')}
              value={variant.payloadText}
              onChange={(payloadText) => updateVariant(variant.id, { payloadText })}
            />
          </div>
        ))}
        {draft.variants.length ? null : (
          <PayloadField
            id="flag-editor-payload"
            label={t('featureFlagPayload')}
            value={draft.payloadText}
            onChange={(payloadText) => setDraft((prev) => ({ ...prev, payloadText }))}
          />
        )}
      </section>

      <section className="flag-editor-section">
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
        <p className="text-muted">{t('featureFlagEarlyAccessLead')}</p>
        {draft.earlyAccess ? (
          <div className="flag-editor-grid">
            <div className="field">
              <Label htmlFor="flag-editor-ea-name">{t('featureFlagEarlyAccessName')}</Label>
              <Input
                id="flag-editor-ea-name"
                value={draft.earlyAccessName}
                onChange={(event) => setDraft((prev) => ({ ...prev, earlyAccessName: event.target.value }))}
              />
            </div>
            <div className="field flag-editor-wide">
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

      {errors.length ? (
        <ul className="flag-editor-errors text-danger">
          {[...new Set(errors)].map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
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

export function FeatureFlagConditionSummary({ websiteId, flag }: { websiteId: string; flag: FeatureFlag }) {
  const cohorts = useCohorts(websiteId).data ?? [];
  const groups = flag.conditionGroups?.length
    ? flag.conditionGroups
    : [{ conditions: flag.targetingRules, rollout: flag.rollout, variant: null }];
  return (
    <div className="flag-summary">
      {groups.map((group, index) => (
        <div key={index} className="flag-summary-group">
          {index > 0 ? <span className="flag-group-or">{t('featureFlagOr')}</span> : null}
          <div className="flag-summary-row">
            <strong>{t('featureFlagGroupTitle').replace('{n}', String(index + 1))}</strong>
            <span className="badge">
              {group.rollout}% {t('featureFlagOfMatching')}
            </span>
            {group.variant ? <span className="badge">→ {group.variant}</span> : null}
          </div>
          {group.conditions.length ? (
            <ul className="flag-summary-conditions">
              {group.conditions.map((condition, conditionIndex) => (
                <li key={conditionIndex} className="text-muted">
                  {describeCondition(condition, cohorts)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">{t('featureFlagGroupEveryone')}</p>
          )}
        </div>
      ))}
      {flag.payload !== null && flag.payload !== undefined && !flag.variants.length ? (
        <div className="flag-summary-group">
          <strong>{t('featureFlagPayload')}</strong>
          <pre className="flag-json">{payloadToText(flag.payload)}</pre>
        </div>
      ) : null}
      {flag.variants.some((variant) => variant.payload !== undefined && variant.payload !== null) ? (
        <div className="flag-summary-group">
          <strong>{t('featureFlagVariantPayload')}</strong>
          {flag.variants
            .filter((variant) => variant.payload !== undefined && variant.payload !== null)
            .map((variant) => (
              <div key={variant.key}>
                <span className="badge">{variant.key}</span>
                <pre className="flag-json">{payloadToText(variant.payload)}</pre>
              </div>
            ))}
        </div>
      ) : null}
      {flag.earlyAccess ? (
        <div className="flag-summary-group">
          <strong>{t('featureFlagEarlyAccess')}</strong>
          <p>{flag.earlyAccess.name}</p>
          {flag.earlyAccess.description ? <p className="text-muted">{flag.earlyAccess.description}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function historyActionLabel(entry: FeatureFlagHistoryEntry) {
  if (entry.action === 'create') return t('featureFlagHistoryCreated');
  if (entry.action === 'delete') return t('featureFlagHistoryDeleted');
  return entry.metadata?.experimentId ? t('featureFlagHistoryShipped') : t('featureFlagHistoryUpdated');
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
  });

  if (historyQuery.isLoading) return <div className="skeleton skeleton-block" aria-busy />;
  if (historyQuery.error) return <p className="text-danger">{(historyQuery.error as Error).message}</p>;
  const history = historyQuery.data;
  if (!history?.items.length) return <p className="text-muted">{t('featureFlagHistoryEmpty')}</p>;
  const pages = Math.max(1, Math.ceil(history.total / HISTORY_PAGE_SIZE));

  return (
    <div className="flag-history">
      <ol className="flag-history-list">
        {history.items.map((entry) => {
          const changes = entry.action === 'update' ? (entry.metadata?.changes ?? []) : [];
          const before = (entry.metadata?.before ?? {}) as Record<string, unknown>;
          const after = (entry.metadata?.after ?? {}) as Record<string, unknown>;
          return (
            <li key={entry.id} className="flag-history-item">
              <div className="flag-history-head">
                <span className="badge">{historyActionLabel(entry)}</span>
                <strong>{entry.username}</strong>
                <span className="text-muted">{formatDateTime(entry.createdAt)}</span>
              </div>
              {changes.length ? (
                <details className="flag-history-details">
                  <summary className="text-muted">
                    {changes.map((field) => t(`featureFlagHistoryField_${field}`)).join(', ')}
                  </summary>
                  {changes.map((field) => (
                    <div key={field} className="flag-history-diff">
                      <span className="stat-label">{t(`featureFlagHistoryField_${field}`)}</span>
                      <div className="flag-history-diff-cols">
                        <div>
                          <span className="text-muted">{t('featureFlagHistoryBefore')}</span>
                          <pre className="flag-json">{historyValue(before[field])}</pre>
                        </div>
                        <div>
                          <span className="text-muted">{t('featureFlagHistoryAfter')}</span>
                          <pre className="flag-json">{historyValue(after[field])}</pre>
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
        <div className="flag-history-pager">
          <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('featureFlagHistoryNewer')}
          </Button>
          <span className="text-muted">
            {page} / {pages}
          </span>
          <Button type="button" variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t('featureFlagHistoryOlder')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
