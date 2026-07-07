import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, ListChecks, Plus, Trash2 } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, type ActionDefinition, type ActionRule } from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

const EMPTY_RULE: ActionRule = {
  field: 'event_name',
  operator: 'equals',
  value: '',
};

const EMPTY_DRAFT = {
  name: '',
  description: '',
  rules: [{ ...EMPTY_RULE }] as ActionRule[],
};

function formatDate(value: number | null | undefined) {
  if (value == null) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ruleLabel(rule: ActionRule) {
  const field =
    rule.field === 'event_name'
      ? t('actionFieldEvent')
      : rule.field === 'url_path'
        ? t('actionFieldPath')
        : rule.key || t('actionFieldProperty');
  return `${field} ${t(`actionOperator_${rule.operator}`)} ${rule.value}`;
}

export default function WebsiteActionsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit } = useWebsitePermissions(websiteId, 'analytics');
  const queryClient = useQueryClient();
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const actionsQuery = useQuery({
    queryKey: ['actions', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<ActionDefinition[]>(`/api/websites/${websiteId}/actions`),
  });

  const actions = actionsQuery.data ?? [];
  const selectedAction = useMemo(() => {
    if (!actions.length || !selectedActionId) return null;
    return actions.find((action) => action.id === selectedActionId) ?? null;
  }, [actions, selectedActionId]);

  const saveMutation = useMutation({
    mutationFn: (payload: typeof draft) => {
      const body = JSON.stringify({
        name: payload.name.trim(),
        description: payload.description.trim(),
        rules: payload.rules.map((rule) => ({
          ...rule,
          key: rule.field === 'property' ? rule.key?.trim() : undefined,
          value: rule.value.trim(),
        })),
      });
      if (selectedActionId) {
        return api<ActionDefinition>(`/api/websites/${websiteId}/actions/${selectedActionId}`, {
          method: 'PATCH',
          body,
        });
      }
      return api<ActionDefinition>(`/api/websites/${websiteId}/actions`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: (action) => {
      setSelectedActionId(action.id);
      setDraft({
        name: action.name,
        description: action.description,
        rules: action.rules.length ? action.rules : [{ ...EMPTY_RULE }],
      });
      queryClient.invalidateQueries({ queryKey: ['actions', websiteId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (actionId: string) => api(`/api/websites/${websiteId}/actions/${actionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSelectedActionId(null);
      setDraft(EMPTY_DRAFT);
      queryClient.invalidateQueries({ queryKey: ['actions', websiteId] });
    },
  });

  const canSave =
    Boolean(draft.name.trim()) &&
    draft.rules.length > 0 &&
    draft.rules.every((rule) => rule.value.trim() && (rule.field !== 'property' || rule.key?.trim())) &&
    !saveMutation.isPending;

  function selectAction(action: ActionDefinition) {
    setSelectedActionId(action.id);
    setDraft({
      name: action.name,
      description: action.description,
      rules: action.rules.length ? action.rules : [{ ...EMPTY_RULE }],
    });
  }

  function newAction() {
    setSelectedActionId(null);
    setDraft(EMPTY_DRAFT);
  }

  function updateRule(index: number, patch: Partial<ActionRule>) {
    setDraft((prev) => ({
      ...prev,
      rules: prev.rules.map((rule, ruleIndex) =>
        ruleIndex === index
          ? (() => {
              const nextField = patch.field ?? rule.field;
              return {
                ...rule,
                ...patch,
                key: nextField === 'property' ? (patch.key ?? rule.key) : undefined,
              };
            })()
          : rule,
      ),
    }));
  }

  const summary = selectedAction?.summary;

  return (
    <div className="page page-actions">
      <WebsitePageShell websiteId={websiteId} />

      {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

      <section className="panel section-gap">
        <header className="panel-header">
          <div>
            <h2 className="section-title">{t('actionDefinitions')}</h2>
            <p className="text-muted">{t('actionDefinitionsLead')}</p>
          </div>
          {canEdit ? (
            <Button type="button" variant="secondary" onClick={newAction}>
              <Plus size={16} strokeWidth={2} aria-hidden />
              {t('newActionDefinition')}
            </Button>
          ) : null}
        </header>
      </section>

      <section className="panel section-gap">
        {actionsQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : actions.length || !selectedActionId ? (
          <div className="surveys-layout">
            <div className="surveys-list">
              {actions.map((action) => (
                <button
                  type="button"
                  key={action.id}
                  className={`survey-list-item${action.id === selectedAction?.id ? ' active' : ''}`}
                  onClick={() => selectAction(action)}
                >
                  <span className="errors-name-cell">
                    <ListChecks size={16} strokeWidth={2} aria-hidden />
                    <span>
                      <span className="survey-list-title">{action.name}</span>
                      <span className="text-muted">{action.rules.map(ruleLabel).join(' · ')}</span>
                    </span>
                  </span>
                  <span className="survey-list-meta">
                    <span className="badge">{(action.summary?.events ?? 0).toLocaleString()}</span>
                    <span className="text-muted">{formatDate(action.summary?.lastSeenAt)}</span>
                  </span>
                </button>
              ))}
              {!actions.length ? (
                <EmptyState title={t('actionsEmptyTitle')} description={t('actionsEmptyBody')} />
              ) : null}
            </div>

            <div className="surveys-detail">
              <header className="surveys-detail-head">
                <div>
                  <h3 className="section-title experiment-title">
                    {selectedActionId ? t('editActionDefinition') : t('createActionDefinition')}
                  </h3>
                  <p className="text-muted">{t('actionDefinitionFormLead')}</p>
                </div>
                {canEdit && selectedActionId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(selectedActionId)}
                    disabled={deleteMutation.isPending}
                    aria-label={t('delete')}
                  >
                    <Trash2 size={16} strokeWidth={2} aria-hidden />
                  </Button>
                ) : null}
              </header>

              {canEdit ? (
                <div className="survey-breakdown">
                  <div className="field">
                    <Label htmlFor="action-name">{t('name')}</Label>
                    <Input
                      id="action-name"
                      value={draft.name}
                      onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Signup completed"
                    />
                  </div>
                  <div className="field">
                    <Label htmlFor="action-description">{t('description')}</Label>
                    <textarea
                      id="action-description"
                      className="textarea"
                      rows={4}
                      value={draft.description}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, description: event.target.value }))
                      }
                    />
                  </div>

                  <div className="action-rule-list">
                    {draft.rules.map((rule, index) => (
                      <div key={index} className="action-rule-row">
                        <div className="field">
                          <Label htmlFor={`action-rule-field-${index}`}>{t('field')}</Label>
                          <select
                            id={`action-rule-field-${index}`}
                            className="select"
                            value={rule.field}
                            onChange={(event) =>
                              updateRule(index, { field: event.target.value as ActionRule['field'] })
                            }
                          >
                            <option value="event_name">{t('actionFieldEvent')}</option>
                            <option value="url_path">{t('actionFieldPath')}</option>
                            <option value="property">{t('actionFieldProperty')}</option>
                          </select>
                        </div>
                        {rule.field === 'property' ? (
                          <div className="field">
                            <Label htmlFor={`action-rule-key-${index}`}>{t('key')}</Label>
                            <Input
                              id={`action-rule-key-${index}`}
                              value={rule.key ?? ''}
                              onChange={(event) => updateRule(index, { key: event.target.value })}
                              placeholder="plan"
                            />
                          </div>
                        ) : null}
                        <div className="field">
                          <Label htmlFor={`action-rule-operator-${index}`}>{t('actionOperator')}</Label>
                          <select
                            id={`action-rule-operator-${index}`}
                            className="select"
                            value={rule.operator}
                            onChange={(event) =>
                              updateRule(index, { operator: event.target.value as ActionRule['operator'] })
                            }
                          >
                            <option value="equals">{t('actionOperator_equals')}</option>
                            <option value="contains">{t('actionOperator_contains')}</option>
                            <option value="starts_with">{t('actionOperator_starts_with')}</option>
                            <option value="ends_with">{t('actionOperator_ends_with')}</option>
                            <option value="not_equals">{t('actionOperator_not_equals')}</option>
                            <option value="not_contains">{t('actionOperator_not_contains')}</option>
                          </select>
                        </div>
                        <div className="field">
                          <Label htmlFor={`action-rule-value-${index}`}>{t('value')}</Label>
                          <Input
                            id={`action-rule-value-${index}`}
                            value={rule.value}
                            onChange={(event) => updateRule(index, { value: event.target.value })}
                            placeholder={rule.field === 'event_name' ? 'checkout_started' : '/pricing'}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="form-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setDraft((prev) => ({ ...prev, rules: [...prev.rules, { ...EMPTY_RULE }] }))}
                    >
                      <Plus size={16} strokeWidth={2} aria-hidden />
                      {t('addRule')}
                    </Button>
                    <Button type="button" variant="primary" onClick={() => saveMutation.mutate(draft)} disabled={!canSave}>
                      {saveMutation.isPending
                        ? t('saving')
                        : selectedActionId
                          ? t('saveChanges')
                          : t('createActionDefinition')}
                    </Button>
                  </div>
                  {saveMutation.error ? <p className="text-danger">{saveMutation.error.message}</p> : null}
                </div>
              ) : null}

              {selectedActionId ? (
                <div className="action-summary-section">
                  <div className="surveys-stats">
                    <div>
                      <span className="stat-label">{t('events')}</span>
                      <strong className="stat-value">{(summary?.events ?? 0).toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('sessions')}</span>
                      <strong className="stat-value">{(summary?.sessions ?? 0).toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('visits')}</span>
                      <strong className="stat-value">{(summary?.visits ?? 0).toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('lastSeen')}</span>
                      <strong className="stat-value">{formatDate(summary?.lastSeenAt)}</strong>
                    </div>
                  </div>
                  <div className="workflow-event-list">
                    {(summary?.recent ?? []).slice(0, 8).map((event) => (
                      <div key={event.id} className="workflow-event-row">
                        <div>
                          <strong>{event.eventName ?? t('pageview')}</strong>
                          <p className="text-muted">{event.urlPath ?? '-'}</p>
                        </div>
                        <Link
                          to={`/websites/${websiteId}/sessions/${event.sessionId}`}
                          className="inline-link"
                        >
                          {event.sessionId.slice(0, 8)}
                          <ExternalLink size={12} strokeWidth={2} aria-hidden />
                        </Link>
                      </div>
                    ))}
                    {!(summary?.recent ?? []).length ? (
                      <p className="text-muted">{t('actionNoMatches')}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <EmptyState title={t('actionsEmptyTitle')} description={t('actionsEmptyBody')} />
        )}
      </section>
    </div>
  );
}
