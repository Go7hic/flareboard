import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, ListChecks, Plus, Trash2 } from 'lucide-react';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
} from '../components/master-detail';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { StatCard } from '../components/ui/stat-card';
import { api, type ActionDefinition, type ActionRule } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
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
        <DataViewState
          loading={actionsQuery.isLoading && !actionsQuery.data}
          error={actionsQuery.isError ? actionsQuery.error : null}
          onRetry={() => actionsQuery.refetch()}
          isEmpty={!actionsQuery.isLoading && !actions.length && Boolean(selectedActionId)}
          emptyTitle={t('actionsEmptyTitle')}
          emptyDescription={t('actionsEmptyBody')}
        >
          {actions.length || !selectedActionId ? (
          <MasterDetailLayout
            list={
              <>
                {actions.map((action) => (
                  <MasterDetailListItem
                    key={action.id}
                    selected={action.id === selectedAction?.id}
                    onSelect={() => selectAction(action)}
                    icon={<ListChecks size={16} strokeWidth={2} aria-hidden />}
                    title={action.name}
                    subtitle={action.rules.map(ruleLabel).join(' · ')}
                    meta={
                      <>
                        <span className="badge">{formatNumber(action.summary?.events ?? 0)}</span>
                        <span className="text-muted">{formatDateTime(action.summary?.lastSeenAt)}</span>
                      </>
                    }
                  />
                ))}
                {!actions.length ? (
                  <EmptyState title={t('actionsEmptyTitle')} description={t('actionsEmptyBody')} />
                ) : null}
              </>
            }
            detail={
              <MasterDetailPane
                title={selectedActionId ? t('editActionDefinition') : t('createActionDefinition')}
                description={t('actionDefinitionFormLead')}
                actions={
                  canEdit && selectedActionId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(selectedActionId)}
                      disabled={deleteMutation.isPending}
                      aria-label={t('delete')}
                    >
                      <Trash2 size={16} strokeWidth={2} aria-hidden />
                    </Button>
                  ) : null
                }
              >
                {canEdit ? (
                  <div className="detail-section">
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
                    <div className="experiment-summary-grid">
                      <StatCard label={t('events')} value={formatNumber(summary?.events ?? 0)} />
                      <StatCard label={t('sessions')} value={formatNumber(summary?.sessions ?? 0)} />
                      <StatCard label={t('visits')} value={formatNumber(summary?.visits ?? 0)} />
                      <StatCard label={t('lastSeen')} value={formatDateTime(summary?.lastSeenAt)} />
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
              </MasterDetailPane>
            }
          />
          ) : (
          <EmptyState title={t('actionsEmptyTitle')} description={t('actionsEmptyBody')} />
          )}
        </DataViewState>
      </section>
    </div>
  );
}
