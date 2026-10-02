import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { api, type ActionDefinition, type ActionRule } from '../../lib/api';
import { t } from '../../lib/i18n';
import { ModalDialog } from '../ModalDialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';

const MAX_RULES = 12;

const EMPTY_RULE: ActionRule = { field: 'event_name', operator: 'equals', value: '' };

const FIELDS: ActionRule['field'][] = ['event_name', 'url_path', 'property'];
const OPERATORS: ActionRule['operator'][] = [
  'equals',
  'contains',
  'starts_with',
  'ends_with',
  'not_equals',
  'not_contains',
];

export function actionFieldLabel(field: ActionRule['field']) {
  if (field === 'event_name') return t('actionFieldEvent');
  if (field === 'url_path') return t('actionFieldPath');
  return t('actionFieldProperty');
}

function valuePlaceholder(field: ActionRule['field']) {
  if (field === 'event_name') return 'checkout_started';
  if (field === 'url_path') return '/pricing';
  return 'pro';
}

type Draft = { name: string; description: string; rules: ActionRule[] };

/**
 * Create or edit an action (console v2: configuration lives in a dialog, the page shows data).
 * Rules are ANDed by the API: an event counts when it matches all of them.
 */
export function ActionFormDialog({
  websiteId,
  action,
  onClose,
  onSaved,
}: {
  websiteId: string;
  /** The action to edit; omit to create one. */
  action?: ActionDefinition | null;
  onClose: () => void;
  onSaved: (action: ActionDefinition) => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(action);
  const [draft, setDraft] = useState<Draft>(() => ({
    name: action?.name ?? '',
    description: action?.description ?? '',
    rules: action?.rules.length ? action.rules.map((rule) => ({ ...rule })) : [{ ...EMPTY_RULE }],
  }));

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        name: draft.name.trim(),
        description: draft.description.trim(),
        rules: draft.rules.map((rule) => ({
          ...rule,
          key: rule.field === 'property' ? rule.key?.trim() : undefined,
          value: rule.value.trim(),
        })),
      });
      return action
        ? api<ActionDefinition>(`/api/websites/${websiteId}/actions/${action.id}`, { method: 'PATCH', body })
        : api<ActionDefinition>(`/api/websites/${websiteId}/actions`, { method: 'POST', body });
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['actions', websiteId] });
      onSaved(saved);
    },
  });

  const canSave =
    Boolean(draft.name.trim()) &&
    draft.rules.length > 0 &&
    draft.rules.every((rule) => rule.value.trim() && (rule.field !== 'property' || rule.key?.trim())) &&
    !saveMutation.isPending;

  function updateRule(index: number, patch: Partial<ActionRule>) {
    setDraft((prev) => ({
      ...prev,
      rules: prev.rules.map((rule, ruleIndex) => {
        if (ruleIndex !== index) return rule;
        const field = patch.field ?? rule.field;
        return { ...rule, ...patch, key: field === 'property' ? (patch.key ?? rule.key) : undefined };
      }),
    }));
  }

  function removeRule(index: number) {
    setDraft((prev) => ({ ...prev, rules: prev.rules.filter((_, ruleIndex) => ruleIndex !== index) }));
  }

  const title = isEdit ? t('editActionDefinition') : t('createActionDefinition');

  return (
    <ModalDialog className="traffic-action-dialog" aria-label={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) saveMutation.mutate();
        }}
      >
        <header className="dialog-header">
          <h2 className="dialog-title">{title}</h2>
          <p>{t('actionDefinitionFormLead')}</p>
        </header>

        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="action-name">{t('name')}</Label>
            <Input
              id="action-name"
              className="h-9"
              value={draft.name}
              maxLength={120}
              autoFocus
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              placeholder={t('trafficActionNamePlaceholder')}
            />
          </div>
          <div className="field">
            <Label htmlFor="action-description">{t('description')}</Label>
            <Textarea
              id="action-description"
              rows={2}
              maxLength={500}
              value={draft.description}
              onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
              placeholder={t('trafficActionDescriptionPlaceholder')}
            />
          </div>

          <fieldset className="traffic-rules">
            <legend className="traffic-rules-legend">
              <span>{t('trafficActionRules')}</span>
              <span className="traffic-rules-hint">{t('trafficActionRulesHint')}</span>
            </legend>
            {draft.rules.map((rule, index) => (
              <div key={index} className={`traffic-rule${rule.field === 'property' ? ' has-key' : ''}`}>
                <Select
                  value={rule.field}
                  onValueChange={(next) => updateRule(index, { field: next as ActionRule['field'] })}
                  items={FIELDS.map((field) => ({ value: field, label: actionFieldLabel(field) }))}
                >
                  <SelectTrigger className="traffic-rule-control" aria-label={t('field')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELDS.map((field) => (
                      <SelectItem key={field} value={field}>
                        {actionFieldLabel(field)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {rule.field === 'property' ? (
                  <Input
                    className="traffic-rule-control mono"
                    value={rule.key ?? ''}
                    onChange={(event) => updateRule(index, { key: event.target.value })}
                    placeholder="plan"
                    aria-label={t('key')}
                  />
                ) : null}
                <Select
                  value={rule.operator}
                  onValueChange={(next) => updateRule(index, { operator: next as ActionRule['operator'] })}
                  items={OPERATORS.map((operator) => ({ value: operator, label: t(`actionOperator_${operator}`) }))}
                >
                  <SelectTrigger className="traffic-rule-control" aria-label={t('actionOperator')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map((operator) => (
                      <SelectItem key={operator} value={operator}>
                        {t(`actionOperator_${operator}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="traffic-rule-control traffic-rule-value mono"
                  value={rule.value}
                  onChange={(event) => updateRule(index, { value: event.target.value })}
                  placeholder={valuePlaceholder(rule.field)}
                  aria-label={t('value')}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeRule(index)}
                  disabled={draft.rules.length <= 1}
                  aria-label={t('trafficRemoveRule')}
                  title={t('trafficRemoveRule')}
                >
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={draft.rules.length >= MAX_RULES}
                onClick={() => setDraft((prev) => ({ ...prev, rules: [...prev.rules, { ...EMPTY_RULE }] }))}
              >
                <Plus aria-hidden />
                {t('addRule')}
              </Button>
            </div>
          </fieldset>

          {saveMutation.error ? (
            <p className="text-danger traffic-form-error" role="alert">
              {saveMutation.error.message}
            </p>
          ) : null}
        </div>

        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saveMutation.isPending}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!canSave}>
            {saveMutation.isPending ? t('saving') : isEdit ? t('saveChanges') : t('createActionDefinition')}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  );
}
