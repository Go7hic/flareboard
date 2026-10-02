import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { EventCatalogPicker } from './EventCatalogPicker';
import { FormErrors, FormSection } from './product/ProductForm';
import { StepIcon } from './product/WorkflowFlow';
import { ResourceEditDialog } from './ResourceEditDialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import type {
  Workflow,
  WorkflowCondition,
  WorkflowConditionField,
  WorkflowConditionOperator,
  WorkflowStep,
  WorkflowStepType,
  WorkflowWebhookMethod,
} from '../lib/api';
import { t } from '../lib/i18n';

/** Same limits as packages/shared/src/workflow-definition.ts (the API re-validates). */
const MAX_STEPS = 20;
const MAX_CONDITIONS = 20;
const MAX_HEADERS = 20;
const MAX_DELAY_MINUTES = 7 * 24 * 60;
const MAX_TOTAL_DELAY_MINUTES = 30 * 24 * 60;

export const WORKFLOW_CONDITION_FIELDS: WorkflowConditionField[] = ['property', 'person', 'path', 'url', 'hostname'];
export const WORKFLOW_CONDITION_OPERATORS: WorkflowConditionOperator[] = [
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
const KEYED_FIELDS = new Set<WorkflowConditionField>(['property', 'person']);
const VALUELESS = new Set<WorkflowConditionOperator>(['exists', 'not_exists']);
const STEP_TYPES: WorkflowStepType[] = ['delay', 'condition', 'webhook', 'email', 'slack'];
const METHODS: WorkflowWebhookMethod[] = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE'];

export const WORKFLOW_PLACEHOLDERS = [
  '{{event.name}}',
  '{{event.properties.KEY}}',
  '{{event.url}}',
  '{{event.path}}',
  '{{event.timestamp}}',
  '{{event.distinct_id}}',
  '{{person.properties.KEY}}',
  '{{person.distinct_id}}',
  '{{website.name}}',
  '{{website.domain}}',
  '{{workflow.name}}',
  '{{execution.id}}',
];

type DelayUnit = 'minutes' | 'hours' | 'days';
const UNIT_MINUTES: Record<DelayUnit, number> = { minutes: 1, hours: 60, days: 24 * 60 };

type ConditionDraft = WorkflowCondition & { uid: string };
type HeaderDraft = { uid: string; key: string; value: string };
type StepDraft =
  | { uid: string; id: string; type: 'delay'; amount: string; unit: DelayUnit }
  | { uid: string; id: string; type: 'condition'; conditions: ConditionDraft[] }
  | { uid: string; id: string; type: 'webhook'; url: string; method: WorkflowWebhookMethod; headers: HeaderDraft[]; body: string }
  | { uid: string; id: string; type: 'email'; to: string; subject: string; body: string }
  | { uid: string; id: string; type: 'slack'; webhookUrl: string; message: string };

type Draft = {
  name: string;
  description: string;
  triggerEvent: string;
  enabled: boolean;
  filters: ConditionDraft[];
  steps: StepDraft[];
};

export type WorkflowBody = {
  name: string;
  description: string;
  triggerEvent: string;
  enabled: boolean;
  filters: WorkflowCondition[];
  steps: WorkflowStep[];
};

let uidCounter = 0;
function uid() {
  uidCounter += 1;
  return `wf-draft-${uidCounter}`;
}

function newStepId(type: WorkflowStepType) {
  return `${type}-${Math.random().toString(36).slice(2, 8)}`;
}

function conditionDraft(condition?: WorkflowCondition): ConditionDraft {
  return { uid: uid(), field: 'property', key: '', operator: 'equals', value: '', ...condition };
}

function delayDraft(minutes: number): { amount: string; unit: DelayUnit } {
  if (minutes % UNIT_MINUTES.days === 0) return { amount: String(minutes / UNIT_MINUTES.days), unit: 'days' };
  if (minutes % UNIT_MINUTES.hours === 0) return { amount: String(minutes / UNIT_MINUTES.hours), unit: 'hours' };
  return { amount: String(minutes), unit: 'minutes' };
}

function stepDraft(step: WorkflowStep): StepDraft {
  switch (step.type) {
    case 'delay':
      return { uid: uid(), id: step.id, type: 'delay', ...delayDraft(step.minutes) };
    case 'condition':
      return { uid: uid(), id: step.id, type: 'condition', conditions: step.conditions.map(conditionDraft) };
    case 'webhook':
      return {
        uid: uid(),
        id: step.id,
        type: 'webhook',
        url: step.url,
        method: step.method,
        headers: step.headers.map((header) => ({ uid: uid(), ...header })),
        body: step.body,
      };
    case 'email':
      return { uid: uid(), ...step };
    case 'slack':
      return { uid: uid(), ...step };
  }
}

function emptyStep(type: WorkflowStepType): StepDraft {
  const id = newStepId(type);
  switch (type) {
    case 'delay':
      return { uid: uid(), id, type, amount: '1', unit: 'hours' };
    case 'condition':
      return { uid: uid(), id, type, conditions: [conditionDraft()] };
    case 'webhook':
      return { uid: uid(), id, type, url: '', method: 'POST', headers: [], body: '' };
    case 'email':
      return { uid: uid(), id, type, to: '', subject: '', body: '' };
    case 'slack':
      return { uid: uid(), id, type, webhookUrl: '', message: 'New {{event.name}} on {{website.name}}' };
  }
}

function draftFromWorkflow(workflow: Workflow | null): Draft {
  if (!workflow) {
    return { name: '', description: '', triggerEvent: '', enabled: true, filters: [], steps: [] };
  }
  return {
    name: workflow.name,
    description: workflow.description ?? '',
    triggerEvent: workflow.triggerEvent,
    enabled: workflow.enabled,
    filters: workflow.filters.map(conditionDraft),
    steps: workflow.steps.map(stepDraft),
  };
}

function conditionOut(condition: ConditionDraft): WorkflowCondition {
  return {
    field: condition.field,
    key: KEYED_FIELDS.has(condition.field) ? condition.key.trim() : '',
    operator: condition.operator,
    value: VALUELESS.has(condition.operator) ? '' : condition.value.trim(),
  };
}

function conditionComplete(condition: ConditionDraft) {
  if (KEYED_FIELDS.has(condition.field) && !condition.key.trim()) return false;
  if (VALUELESS.has(condition.operator)) return true;
  if (condition.operator.startsWith('greater') || condition.operator.startsWith('less')) {
    return condition.value.trim() !== '' && Number.isFinite(Number(condition.value));
  }
  return condition.value.trim() !== '' || condition.operator === 'equals' || condition.operator === 'not_equals';
}

export function stepTypeLabel(type: WorkflowStepType) {
  return t(`workflowStep_${type}`);
}

function buildBody(draft: Draft): { body: WorkflowBody | null; errors: string[] } {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push(t('workflowErrorName'));
  if (!draft.triggerEvent.trim()) errors.push(t('workflowErrorTrigger'));
  if (draft.filters.some((condition) => !conditionComplete(condition))) errors.push(t('workflowErrorFilters'));

  const steps: WorkflowStep[] = [];
  draft.steps.forEach((step, index) => {
    const label = `${t('workflowStepN').replace('{n}', String(index + 1))} (${stepTypeLabel(step.type)})`;
    const fail = (message: string) => errors.push(`${label}: ${message}`);
    switch (step.type) {
      case 'delay': {
        const amount = Number(step.amount);
        const minutes = Math.round(amount * UNIT_MINUTES[step.unit]);
        if (!Number.isFinite(amount) || minutes < 1 || minutes > MAX_DELAY_MINUTES) fail(t('workflowErrorDelay'));
        steps.push({ id: step.id, type: 'delay', minutes });
        break;
      }
      case 'condition':
        if (!step.conditions.length || step.conditions.some((condition) => !conditionComplete(condition))) {
          fail(t('workflowErrorFilters'));
        }
        steps.push({ id: step.id, type: 'condition', conditions: step.conditions.map(conditionOut) });
        break;
      case 'webhook':
        if (!/^https?:\/\//i.test(step.url.trim())) fail(t('workflowErrorUrl'));
        if (step.headers.some((header) => !header.key.trim())) fail(t('workflowErrorHeader'));
        steps.push({
          id: step.id,
          type: 'webhook',
          url: step.url.trim(),
          method: step.method,
          headers: step.headers.map((header) => ({ key: header.key.trim(), value: header.value })),
          body: step.method === 'GET' || step.method === 'DELETE' ? '' : step.body,
        });
        break;
      case 'email':
        if (!step.to.trim()) fail(t('workflowErrorRecipient'));
        steps.push({ id: step.id, type: 'email', to: step.to.trim(), subject: step.subject, body: step.body });
        break;
      case 'slack':
        if (!/^https:\/\/hooks\.slack(-gov)?\.com\//i.test(step.webhookUrl.trim())) fail(t('workflowErrorSlackUrl'));
        if (!step.message.trim()) fail(t('workflowErrorMessage'));
        steps.push({ id: step.id, type: 'slack', webhookUrl: step.webhookUrl.trim(), message: step.message });
        break;
    }
  });

  const totalDelay = steps.reduce((sum, step) => sum + (step.type === 'delay' ? step.minutes : 0), 0);
  if (totalDelay > MAX_TOTAL_DELAY_MINUTES) errors.push(t('workflowErrorTotalDelay'));

  if (errors.length) return { body: null, errors };
  return {
    errors,
    body: {
      name: draft.name.trim(),
      description: draft.description.trim(),
      triggerEvent: draft.triggerEvent.trim(),
      enabled: draft.enabled,
      filters: draft.filters.map(conditionOut),
      steps,
    },
  };
}

export function WorkflowConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: ConditionDraft;
  onChange: (next: ConditionDraft) => void;
  onRemove: () => void;
}) {
  return (
    <div className="product-cond-row">
      <select
        className="select"
        aria-label={t('featureFlagConditionField')}
        value={condition.field}
        onChange={(event) => onChange({ ...condition, field: event.target.value as WorkflowConditionField })}
      >
        {WORKFLOW_CONDITION_FIELDS.map((field) => (
          <option key={field} value={field}>
            {t(`featureFlagField_${field}`)}
          </option>
        ))}
      </select>
      {KEYED_FIELDS.has(condition.field) ? (
        <Input
          className="mono"
          aria-label={t('featureFlagConditionKey')}
          placeholder={t('featureFlagConditionKey')}
          value={condition.key}
          onChange={(event) => onChange({ ...condition, key: event.target.value })}
        />
      ) : null}
      <select
        className="select"
        aria-label={t('featureFlagConditionOperator')}
        value={condition.operator}
        onChange={(event) => onChange({ ...condition, operator: event.target.value as WorkflowConditionOperator })}
      >
        {WORKFLOW_CONDITION_OPERATORS.map((operator) => (
          <option key={operator} value={operator}>
            {t(`featureFlagOperator_${operator}`)}
          </option>
        ))}
      </select>
      {VALUELESS.has(condition.operator) ? null : (
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

function ConditionList({
  conditions,
  onChange,
  emptyLabel,
}: {
  conditions: ConditionDraft[];
  onChange: (next: ConditionDraft[]) => void;
  emptyLabel: string;
}) {
  return (
    <div className="product-cond-list">
      {conditions.length ? (
        conditions.map((condition, index) => (
          <div key={condition.uid} className="product-cond">
            <span className="product-cond-joiner">{index === 0 ? t('featureFlagWhere') : t('featureFlagAnd')}</span>
            <WorkflowConditionRow
              condition={condition}
              onChange={(next) => onChange(conditions.map((item) => (item.uid === condition.uid ? next : item)))}
              onRemove={() => onChange(conditions.filter((item) => item.uid !== condition.uid))}
            />
          </div>
        ))
      ) : (
        <p className="product-muted-line">{emptyLabel}</p>
      )}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={conditions.length >= MAX_CONDITIONS}
          onClick={() => onChange([...conditions, conditionDraft()])}
        >
          <Plus size={14} strokeWidth={2} aria-hidden />
          {t('featureFlagAddCondition')}
        </Button>
      </div>
    </div>
  );
}

type TemplateField = HTMLInputElement | HTMLTextAreaElement;
type FocusTarget = { element: TemplateField; apply: (value: string) => void };

/** Clicking a placeholder inserts it at the cursor of the template field that was focused last. */
function PlaceholderHelper({ target }: { target: React.MutableRefObject<FocusTarget | null> }) {
  return (
    <div className="product-placeholders">
      <p className="product-form-section-lead">{t('workflowPlaceholdersHint')}</p>
      <div className="product-placeholder-list">
        {WORKFLOW_PLACEHOLDERS.map((placeholder) => (
          <button
            key={placeholder}
            type="button"
            className="product-placeholder mono"
            // Keep focus in the template field so the cursor position survives.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const current = target.current;
              if (!current) return;
              const { element } = current;
              const start = element.selectionStart ?? element.value.length;
              const end = element.selectionEnd ?? start;
              const next = element.value.slice(0, start) + placeholder + element.value.slice(end);
              current.apply(next);
              requestAnimationFrame(() => {
                element.focus();
                const caret = start + placeholder.length;
                element.setSelectionRange(caret, caret);
              });
            }}
          >
            {placeholder}
          </button>
        ))}
      </div>
    </div>
  );
}

function StepEditor({
  step,
  onChange,
  focusRef,
}: {
  step: StepDraft;
  onChange: (next: StepDraft) => void;
  focusRef: React.MutableRefObject<FocusTarget | null>;
}) {
  const prefix = `workflow-step-${step.uid}`;
  const track = (apply: (value: string) => void) => ({
    onFocus: (event: React.FocusEvent<TemplateField>) => {
      focusRef.current = { element: event.currentTarget, apply };
    },
  });

  if (step.type === 'delay') {
    return (
      <div className="product-inline-row">
        <span className="product-inline-word">{t('workflowDelayWait')}</span>
        <Input
          aria-label={t('workflowDelayAmount')}
          type="number"
          min={1}
          className="product-number-input"
          value={step.amount}
          onChange={(event) => onChange({ ...step, amount: event.target.value })}
        />
        <select
          className="select product-inline-select"
          aria-label={t('workflowDelayUnit')}
          value={step.unit}
          onChange={(event) => onChange({ ...step, unit: event.target.value as DelayUnit })}
        >
          <option value="minutes">{t('workflowDelay_minutes')}</option>
          <option value="hours">{t('workflowDelay_hours')}</option>
          <option value="days">{t('workflowDelay_days')}</option>
        </select>
      </div>
    );
  }
  if (step.type === 'condition') {
    return (
      <>
        <p className="product-form-section-lead">{t('workflowConditionStepLead')}</p>
        <ConditionList
          conditions={step.conditions}
          emptyLabel={t('workflowConditionStepEmpty')}
          onChange={(conditions) => onChange({ ...step, conditions })}
        />
      </>
    );
  }
  if (step.type === 'webhook') {
    const hasBody = step.method !== 'GET' && step.method !== 'DELETE';
    return (
      <div className="product-form-grid product-webhook-grid">
        <div className="field product-field">
          <Label htmlFor={`${prefix}-method`}>{t('workflowWebhookMethod')}</Label>
          <select
            id={`${prefix}-method`}
            className="select"
            value={step.method}
            onChange={(event) => onChange({ ...step, method: event.target.value as WorkflowWebhookMethod })}
          >
            {METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </div>
        <div className="field product-field">
          <Label htmlFor={`${prefix}-url`}>{t('workflowWebhookUrl')}</Label>
          <Input
            id={`${prefix}-url`}
            className="mono"
            value={step.url}
            placeholder="https://example.com/webhooks/flareboard"
            onChange={(event) => onChange({ ...step, url: event.target.value })}
          />
        </div>
        <div className="field product-field product-form-wide">
          <span className="field-label">{t('workflowWebhookHeaders')}</span>
          {step.headers.map((header) => (
            <div key={header.uid} className="product-cond-row">
              <Input
                className="mono"
                aria-label={t('workflowHeaderName')}
                placeholder="Authorization"
                value={header.key}
                onChange={(event) =>
                  onChange({
                    ...step,
                    headers: step.headers.map((item) => (item.uid === header.uid ? { ...item, key: event.target.value } : item)),
                  })
                }
              />
              <Input
                className="mono"
                aria-label={t('workflowHeaderValue')}
                placeholder="Bearer …"
                value={header.value}
                {...track((value) =>
                  onChange({
                    ...step,
                    headers: step.headers.map((item) => (item.uid === header.uid ? { ...item, value } : item)),
                  }),
                )}
                onChange={(event) =>
                  onChange({
                    ...step,
                    headers: step.headers.map((item) => (item.uid === header.uid ? { ...item, value: event.target.value } : item)),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('workflowRemoveHeader')}
                onClick={() => onChange({ ...step, headers: step.headers.filter((item) => item.uid !== header.uid) })}
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={step.headers.length >= MAX_HEADERS}
              onClick={() => onChange({ ...step, headers: [...step.headers, { uid: uid(), key: '', value: '' }] })}
            >
              <Plus size={14} strokeWidth={2} aria-hidden />
              {t('workflowAddHeader')}
            </Button>
          </div>
        </div>
        {hasBody ? (
          <div className="field product-field product-form-wide">
            <Label htmlFor={`${prefix}-body`}>{t('workflowWebhookBody')}</Label>
            <Textarea
              id={`${prefix}-body`}
              className="mono product-code-input"
              spellCheck={false}
              value={step.body}
              placeholder={'{"event": "{{event.name}}", "email": "{{person.properties.email}}"}'}
              {...track((body) => onChange({ ...step, body }))}
              onChange={(event) => onChange({ ...step, body: event.target.value })}
            />
            <p className="field-hint">{t('workflowWebhookBodyHint')}</p>
          </div>
        ) : null}
      </div>
    );
  }
  if (step.type === 'email') {
    return (
      <div className="product-form-grid">
        <div className="field product-field product-form-wide">
          <Label htmlFor={`${prefix}-to`}>{t('workflowEmailRecipient')}</Label>
          <Input
            id={`${prefix}-to`}
            value={step.to}
            placeholder="sales@example.com, founders@example.com"
            onChange={(event) => onChange({ ...step, to: event.target.value })}
          />
        </div>
        <div className="field product-field product-form-wide">
          <Label htmlFor={`${prefix}-subject`}>{t('workflowEmailSubject')}</Label>
          <Input
            id={`${prefix}-subject`}
            value={step.subject}
            placeholder="Flareboard workflow: {{workflow.name}}"
            {...track((subject) => onChange({ ...step, subject }))}
            onChange={(event) => onChange({ ...step, subject: event.target.value })}
          />
        </div>
        <div className="field product-field product-form-wide">
          <Label htmlFor={`${prefix}-body`}>{t('workflowEmailBody')}</Label>
          <Textarea
            id={`${prefix}-body`}
            rows={4}
            value={step.body}
            placeholder={t('workflowEmailBodyPlaceholder')}
            {...track((body) => onChange({ ...step, body }))}
            onChange={(event) => onChange({ ...step, body: event.target.value })}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="product-form-grid">
      <div className="field product-field product-form-wide">
        <Label htmlFor={`${prefix}-url`}>{t('workflowSlackUrl')}</Label>
        <Input
          id={`${prefix}-url`}
          className="mono"
          value={step.webhookUrl}
          placeholder="https://hooks.slack.com/services/…"
          onChange={(event) => onChange({ ...step, webhookUrl: event.target.value })}
        />
      </div>
      <div className="field product-field product-form-wide">
        <Label htmlFor={`${prefix}-message`}>{t('workflowSlackMessage')}</Label>
        <Textarea
          id={`${prefix}-message`}
          rows={3}
          value={step.message}
          {...track((message) => onChange({ ...step, message }))}
          onChange={(event) => onChange({ ...step, message: event.target.value })}
        />
      </div>
    </div>
  );
}

export function WorkflowEditorDialog({
  websiteId,
  workflow,
  saving,
  error,
  onClose,
  onSave,
}: {
  /** Enables the event picker for the trigger. */
  websiteId?: string;
  /** Null creates a new workflow. */
  workflow: Workflow | null;
  saving: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: (body: WorkflowBody) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFromWorkflow(workflow));
  const focusRef = useRef<FocusTarget | null>(null);
  const { body, errors } = useMemo(() => buildBody(draft), [draft]);
  const [showErrors, setShowErrors] = useState(false);

  function updateStep(stepUid: string, next: StepDraft) {
    setDraft((prev) => ({ ...prev, steps: prev.steps.map((step) => (step.uid === stepUid ? next : step)) }));
  }

  function moveStep(index: number, offset: -1 | 1) {
    setDraft((prev) => {
      const steps = [...prev.steps];
      const [step] = steps.splice(index, 1);
      steps.splice(index + offset, 0, step!);
      return { ...prev, steps };
    });
  }

  const title = workflow ? t('workflowEdit') : t('createWorkflow');
  const hasTemplates = draft.steps.some((step) => step.type === 'webhook' || step.type === 'email' || step.type === 'slack');
  return (
    <ResourceEditDialog
      title={title}
      description={workflow ? undefined : t('productWorkflowCreateLead')}
      ariaLabel={title}
      panelClassName="product-dialog product-dialog--wide"
      bodyClassName="product-form"
      saving={saving}
      error={error}
      canSave={!saving}
      saveLabel={workflow ? undefined : t('createWorkflow')}
      onClose={onClose}
      onSave={() => {
        if (body) onSave(body);
        else setShowErrors(true);
      }}
    >
      <div className="product-form-grid">
        <div className="field product-field">
          <Label htmlFor="workflow-editor-name">{t('name')}</Label>
          <Input
            id="workflow-editor-name"
            value={draft.name}
            placeholder={t('workflowNamePlaceholder')}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
        </div>
        <div className="field product-field">
          <Label htmlFor="workflow-editor-trigger">{t('workflowTriggerEvent')}</Label>
          {websiteId ? (
            <EventCatalogPicker
              mode="single"
              websiteId={websiteId}
              id="workflow-editor-trigger"
              value={draft.triggerEvent}
              placeholder="checkout_completed"
              onChange={(triggerEvent) => setDraft((prev) => ({ ...prev, triggerEvent }))}
            />
          ) : (
            <Input
              id="workflow-editor-trigger"
              className="mono"
              value={draft.triggerEvent}
              placeholder="checkout_completed"
              onChange={(event) => setDraft((prev) => ({ ...prev, triggerEvent: event.target.value }))}
            />
          )}
        </div>
        <div className="field product-field product-form-wide">
          <Label htmlFor="workflow-editor-description">{t('description')}</Label>
          <Input
            id="workflow-editor-description"
            value={draft.description}
            placeholder={t('workflowActionNotePlaceholder')}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
        <label className="checkbox-row product-form-wide">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft((prev) => ({ ...prev, enabled: event.target.checked }))}
          />
          <span>{t('enabled')}</span>
        </label>
      </div>

      <FormSection title={t('workflowTriggerFilters')} lead={t('workflowTriggerFiltersLead')}>
        <ConditionList
          conditions={draft.filters}
          emptyLabel={t('workflowTriggerFiltersEmpty')}
          onChange={(filters) => setDraft((prev) => ({ ...prev, filters }))}
        />
      </FormSection>

      <FormSection title={t('workflowSteps')} lead={t('workflowStepsLead')}>
        {draft.steps.length ? null : <p className="product-muted-line">{t('workflowStepsEmpty')}</p>}
        <ol className="product-step-list">
          {draft.steps.map((step, index) => (
            <li key={step.uid} className="product-step-edit">
              <span className="product-flow-icon" aria-hidden>
                <StepIcon type={step.type} />
              </span>
              <div className="product-step-edit-body">
                <div className="product-step-edit-head">
                  <span className="product-step-edit-title">
                    {t('workflowStepN').replace('{n}', String(index + 1))} · {stepTypeLabel(step.type)}
                  </span>
                  <div className="product-step-edit-tools">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('workflowMoveUp')}
                      disabled={index === 0}
                      onClick={() => moveStep(index, -1)}
                    >
                      <ArrowUp size={14} strokeWidth={2} aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('workflowMoveDown')}
                      disabled={index === draft.steps.length - 1}
                      onClick={() => moveStep(index, 1)}
                    >
                      <ArrowDown size={14} strokeWidth={2} aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="destructive-ghost"
                      size="sm"
                      onClick={() => setDraft((prev) => ({ ...prev, steps: prev.steps.filter((item) => item.uid !== step.uid) }))}
                    >
                      {t('workflowRemoveStep')}
                    </Button>
                  </div>
                </div>
                <StepEditor step={step} focusRef={focusRef} onChange={(next) => updateStep(step.uid, next)} />
              </div>
            </li>
          ))}
        </ol>
        <div className="product-add-row">
          <span className="product-add-row-label">{t('workflowAddStep')}</span>
          {STEP_TYPES.map((type) => (
            <Button
              key={type}
              type="button"
              variant="outline"
              size="sm"
              disabled={draft.steps.length >= MAX_STEPS}
              onClick={() => setDraft((prev) => ({ ...prev, steps: [...prev.steps, emptyStep(type)] }))}
            >
              <StepIcon type={type} />
              {stepTypeLabel(type)}
            </Button>
          ))}
        </div>
        {hasTemplates ? <PlaceholderHelper target={focusRef} /> : null}
      </FormSection>

      {showErrors ? <FormErrors errors={errors} /> : null}
    </ResourceEditDialog>
  );
}
