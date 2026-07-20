import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ExternalLink, Workflow as WorkflowIcon } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  useMasterDetailSelection,
} from '../components/master-detail';
import { ResourceEditDialog } from '../components/ResourceEditDialog';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, type Workflow, type WorkflowExecutionsResponse } from '../lib/api';
import { formatDate } from '../lib/formatDate';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { formatDateOnly, formatDateTime, formatNumber, formatPercent } from '../lib/format';

const DEFAULT_WORKFLOW = {
  name: '',
  triggerEvent: '',
  actionType: 'record' as Workflow['actionType'],
  actionNote: '',
  actionUrl: '',
  actionEmail: '',
};

const DEFAULT_FILTERS = {
  status: '',
  event: '',
  q: '',
};

const EXECUTION_STATUSES = ['recorded', 'queued', 'success', 'failed'] as const;

function workflowActionTypeLabel(actionType: Workflow['actionType']) {
  if (actionType === 'webhook') return t('workflowActionType_webhook');
  if (actionType === 'email') return t('workflowActionType_email');
  return t('workflowActionType_record');
}

function workflowExecutionStatusLabel(status: string) {
  if ((EXECUTION_STATUSES as readonly string[]).includes(status)) {
    return t(`workflowExecutionStatus_${status}`);
  }
  return status;
}

function WorkflowEditDialog({
  workflow,
  saving,
  error,
  onClose,
  onSave,
}: {
  workflow: Workflow;
  saving: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: (workflow: Workflow, patch: Partial<Workflow>) => void;
}) {
  const [draft, setDraft] = useState({
    name: workflow.name,
    triggerEvent: workflow.triggerEvent,
    enabled: workflow.enabled,
    actionType: workflow.actionType,
    actionNote: workflow.actionConfig?.note ?? '',
    actionUrl: workflow.actionConfig?.url ?? '',
    actionEmail: workflow.actionConfig?.email ?? '',
  });

  useEffect(() => {
    setDraft({
      name: workflow.name,
      triggerEvent: workflow.triggerEvent,
      enabled: workflow.enabled,
      actionType: workflow.actionType,
      actionNote: workflow.actionConfig?.note ?? '',
      actionUrl: workflow.actionConfig?.url ?? '',
      actionEmail: workflow.actionConfig?.email ?? '',
    });
  }, [workflow]);

  const canSave =
    Boolean(draft.name.trim() && draft.triggerEvent.trim()) &&
    (draft.actionType !== 'webhook' || Boolean(draft.actionUrl.trim())) &&
    (draft.actionType !== 'email' || Boolean(draft.actionEmail.trim())) &&
    !saving;

  return (
    <ResourceEditDialog
      title={t('workflowEdit')}
      ariaLabel={t('workflowEdit')}
      panelClassName="workflow-dialog"
      bodyClassName="workflow-dialog-body"
      saving={saving}
      error={error}
      canSave={canSave}
      onClose={onClose}
      onSave={() =>
        onSave(workflow, {
          name: draft.name.trim(),
          triggerEvent: draft.triggerEvent.trim(),
          enabled: draft.enabled,
          actionType: draft.actionType,
          actionConfig: {
            note: draft.actionNote.trim(),
            url: draft.actionUrl.trim(),
            email: draft.actionEmail.trim(),
          },
        })
      }
    >
          <div className="field">
            <Label htmlFor="workflow-dialog-name">{t('name')}</Label>
            <Input
              id="workflow-dialog-name"
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div className="field">
            <Label htmlFor="workflow-dialog-trigger">{t('workflowTriggerEvent')}</Label>
            <Input
              id="workflow-dialog-trigger"
              value={draft.triggerEvent}
              placeholder="checkout_completed"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, triggerEvent: event.target.value }))
              }
            />
          </div>
          <label className="checkbox-row workflow-dialog-wide">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft((prev) => ({ ...prev, enabled: event.target.checked }))}
            />
            <span>{t('enabled')}</span>
          </label>
          <div className="field">
            <Label htmlFor="workflow-dialog-action-type">{t('workflowActionType')}</Label>
            <select
              id="workflow-dialog-action-type"
              className="select"
              value={draft.actionType}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  actionType: event.target.value as Workflow['actionType'],
                }))
              }
            >
              <option value="record">{t('workflowActionType_record')}</option>
              <option value="webhook">{t('workflowActionType_webhook')}</option>
              <option value="email">{t('workflowActionType_email')}</option>
            </select>
          </div>
          {draft.actionType === 'webhook' ? (
            <div className="field">
              <Label htmlFor="workflow-dialog-action-url">{t('workflowWebhookUrl')}</Label>
              <Input
                id="workflow-dialog-action-url"
                value={draft.actionUrl}
                placeholder="https://example.com/webhook"
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, actionUrl: event.target.value }))
                }
              />
            </div>
          ) : null}
          {draft.actionType === 'email' ? (
            <div className="field">
              <Label htmlFor="workflow-dialog-action-email">{t('workflowEmailRecipient')}</Label>
              <Input
                id="workflow-dialog-action-email"
                type="email"
                value={draft.actionEmail}
                placeholder="team@example.com"
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, actionEmail: event.target.value }))
                }
              />
            </div>
          ) : null}
          <div className="field workflow-dialog-wide">
            <Label htmlFor="workflow-dialog-note">{t('workflowActionNote')}</Label>
            <textarea
              id="workflow-dialog-note"
              className="textarea"
              rows={4}
              value={draft.actionNote}
              placeholder={t('workflowActionNotePlaceholder')}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, actionNote: event.target.value }))
              }
            />
          </div>
    </ResourceEditDialog>
  );
}

export default function WebsiteWorkflowsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit } = useWebsitePermissions(websiteId);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(DEFAULT_WORKFLOW);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);

  const workflowsQuery = useQuery({
    queryKey: ['workflows', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Workflow[]>(`/api/websites/${websiteId}/workflows`),
  });

  const workflows = useMemo(() => workflowsQuery.data ?? [], [workflowsQuery.data]);
  const { selectedId: selectedWorkflowId, setSelectedId: setSelectedWorkflowId, selectedItem: selectedWorkflowFromList } =
    useMasterDetailSelection(workflows, (workflow) => workflow.id);

  useEffect(() => {
    if (!workflows.length) {
      setSelectedWorkflowId(null);
      return;
    }
    const requestedWorkflowId = searchParams.get('workflow');
    if (requestedWorkflowId && workflows.some((workflow) => workflow.id === requestedWorkflowId)) {
      setSelectedWorkflowId(requestedWorkflowId);
      return;
    }
    if (!selectedWorkflowId || !workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      const nextWorkflowId = workflows[0].id;
      setSelectedWorkflowId(nextWorkflowId);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('workflow', nextWorkflowId);
        return next;
      }, { replace: true });
    }
  }, [searchParams, selectedWorkflowId, setSearchParams, workflows]);

  useEffect(() => {
    setFilters(DEFAULT_FILTERS);
  }, [selectedWorkflowId]);

  const debouncedQ = useDebouncedValue(filters.q, 300);
  const debouncedEvent = useDebouncedValue(filters.event, 300);

  const executionsQuery = useQuery({
    queryKey: ['workflow-executions', websiteId, selectedWorkflowId, filters.status, debouncedEvent, debouncedQ],
    enabled: Boolean(websiteId && selectedWorkflowId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (debouncedEvent.trim()) params.set('event', debouncedEvent.trim());
      if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
      const query = params.toString();
      return api<WorkflowExecutionsResponse>(
        `/api/websites/${websiteId}/workflows/${selectedWorkflowId}/executions${query ? `?${query}` : ''}`,
      );
    },
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api<Workflow>(`/api/websites/${websiteId}/workflows`, {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          triggerEvent: draft.triggerEvent.trim(),
          enabled: true,
          actionType: draft.actionType,
          actionConfig: {
            note: draft.actionNote.trim(),
            url: draft.actionUrl.trim(),
            email: draft.actionEmail.trim(),
          },
        }),
      }),
    onSuccess: (workflow) => {
      setDraft(DEFAULT_WORKFLOW);
      setSelectedWorkflowId(workflow.id);
      queryClient.invalidateQueries({ queryKey: ['workflows', websiteId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Workflow> }) =>
      api<Workflow>(`/api/websites/${websiteId}/workflows/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      setEditingWorkflow(null);
      queryClient.invalidateQueries({ queryKey: ['workflows', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['workflow-executions', websiteId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/websites/${websiteId}/workflows/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['workflow-executions', websiteId] });
    },
  });

  const selectedWorkflow =
    selectedWorkflowFromList ?? executionsQuery.data?.workflow ?? null;
  const summary = executionsQuery.data?.summary ?? selectedWorkflow?.summary;
  const executions = executionsQuery.data?.executions ?? [];
  const canCreate =
    Boolean(draft.name.trim() && draft.triggerEvent.trim()) &&
    (draft.actionType !== 'webhook' || Boolean(draft.actionUrl.trim())) &&
    (draft.actionType !== 'email' || Boolean(draft.actionEmail.trim())) &&
    !createMutation.isPending;
  const filtersActive = Boolean(filters.status || filters.event.trim() || filters.q.trim());

  return (
    <div className="page page-workflows">
      <WebsitePageShell websiteId={websiteId} />

      {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

      {canEdit ? (
      <section className="panel section-gap">
        <header className="panel-header">
          <div>
            <h2 className="section-title">{t('workflows')}</h2>
            <p className="text-muted">{t('workflowsLead')}</p>
          </div>
        </header>

        <div className="workflow-create-form">
          <div className="field">
            <Label htmlFor="workflow-name">{t('name')}</Label>
            <Input
              id="workflow-name"
              value={draft.name}
              placeholder={t('workflowNamePlaceholder')}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div className="field feature-flag-description-field">
            <Label htmlFor="workflow-trigger">{t('workflowTriggerEvent')}</Label>
            <Input
              id="workflow-trigger"
              value={draft.triggerEvent}
              placeholder="checkout_completed"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, triggerEvent: event.target.value }))
              }
            />
          </div>
          <div className="field workflow-create-note-field">
            <Label htmlFor="workflow-action-type">{t('workflowActionType')}</Label>
            <select
              id="workflow-action-type"
              className="select"
              value={draft.actionType}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  actionType: event.target.value as Workflow['actionType'],
                }))
              }
            >
              <option value="record">{t('workflowActionType_record')}</option>
              <option value="webhook">{t('workflowActionType_webhook')}</option>
              <option value="email">{t('workflowActionType_email')}</option>
            </select>
          </div>
          {draft.actionType === 'webhook' ? (
            <div className="field workflow-create-note-field">
              <Label htmlFor="workflow-action-url">{t('workflowWebhookUrl')}</Label>
              <Input
                id="workflow-action-url"
                value={draft.actionUrl}
                placeholder="https://example.com/webhook"
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, actionUrl: event.target.value }))
                }
              />
            </div>
          ) : null}
          {draft.actionType === 'email' ? (
            <div className="field workflow-create-note-field">
              <Label htmlFor="workflow-action-email">{t('workflowEmailRecipient')}</Label>
              <Input
                id="workflow-action-email"
                type="email"
                value={draft.actionEmail}
                placeholder="team@example.com"
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, actionEmail: event.target.value }))
                }
              />
            </div>
          ) : null}
          <div className="field workflow-create-note-field">
            <Label htmlFor="workflow-note">{t('workflowActionNote')}</Label>
            <textarea
              id="workflow-note"
              className="textarea"
              rows={3}
              value={draft.actionNote}
              placeholder={t('workflowActionNotePlaceholder')}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, actionNote: event.target.value }))
              }
            />
          </div>
          <div className="form-actions">
            <Button
              type="button"
              variant="primary"
              disabled={!canCreate}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? t('saving') : t('createWorkflow')}
            </Button>
          </div>
        </div>
        {createMutation.error ? (
          <p className="text-danger">{(createMutation.error as Error).message}</p>
        ) : null}
      </section>
      ) : null}

      <section className="panel section-gap">
        {workflowsQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : workflows.length ? (
          <MasterDetailLayout
            list={workflows.map((workflow) => (
              <MasterDetailListItem
                key={workflow.id}
                selected={workflow.id === selectedWorkflowId}
                onSelect={() => {
                  setSelectedWorkflowId(workflow.id);
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set('workflow', workflow.id);
                    return next;
                  });
                }}
                icon={<WorkflowIcon size={16} strokeWidth={2} aria-hidden />}
                title={workflow.name}
                subtitle={workflow.triggerEvent}
                meta={
                  <>
                    <span className="badge">{workflow.enabled ? t('enabled') : t('disabled')}</span>
                    <span className="text-muted">
                      {formatNumber(workflow.summary?.executions ?? 0)} {t('workflowExecutions')}
                    </span>
                  </>
                }
              />
            ))}
            detail={
              selectedWorkflow ? (
                <MasterDetailPane
                  title={selectedWorkflow.name}
                  description={
                    <>
                      <p className="text-muted">
                        {t('workflowTriggerEvent')}: {selectedWorkflow.triggerEvent}
                      </p>
                      <p className="text-muted">
                        {t('workflowActionType')}: {workflowActionTypeLabel(selectedWorkflow.actionType)}
                        {selectedWorkflow.actionType === 'webhook' && selectedWorkflow.actionConfig?.url
                          ? ` · ${selectedWorkflow.actionConfig.url}`
                          : ''}
                        {selectedWorkflow.actionType === 'email' && selectedWorkflow.actionConfig?.email
                          ? ` · ${selectedWorkflow.actionConfig.email}`
                          : ''}
                      </p>
                      {selectedWorkflow.actionConfig?.note ? (
                        <p className="workflow-action-note">{selectedWorkflow.actionConfig.note}</p>
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
                          onClick={() => setEditingWorkflow(selectedWorkflow)}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateMutation.mutate({
                              id: selectedWorkflow.id,
                              patch: { enabled: !selectedWorkflow.enabled },
                            })
                          }
                        >
                          {selectedWorkflow.enabled ? t('disable') : t('enable')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="btn-danger-text"
                          onClick={() => deleteMutation.mutate(selectedWorkflow.id)}
                        >
                          {t('delete')}
                        </Button>
                      </div>
                    ) : null
                  }
                >
                  <div className="detail-stats">
                    <div>
                      <span className="stat-label">{t('workflowExecutions')}</span>
                      <strong className="stat-value">
                        {formatNumber((summary?.executions ?? 0))}
                      </strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('workflowFailures')}</span>
                      <strong className="stat-value">
                        {formatNumber((summary?.failures ?? 0))}
                      </strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('workflowSuccessRate')}</span>
                      <strong className="stat-value">
                        {formatNumber((summary?.successRate ?? 0))}%
                      </strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('workflowLastExecution')}</span>
                      <strong className="stat-value">{formatDateTime(summary?.lastExecutionAt)}</strong>
                    </div>
                  </div>

                  {summary?.trend?.length ? (
                    <div className="detail-section">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">{t('workflowTrend')}</h3>
                          <p className="text-muted">{t('workflowTrendLead')}</p>
                        </div>
                      </div>
                      <div className="table-scroll">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>{t('date')}</th>
                              <th>{t('workflowExecutions')}</th>
                              <th>{t('workflowFailures')}</th>
                              <th>{t('workflowSuccessRate')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.trend.map((item) => (
                              <tr key={item.date}>
                                <td className="text-muted">{item.date}</td>
                                <td className="num">{formatNumber(item.executions)}</td>
                                <td className="num">{formatNumber(item.failures)}</td>
                                <td className="num">{formatNumber(item.successRate)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  {summary?.statuses?.length || summary?.events?.length ? (
                    <div className="workflow-insights-grid">
                      <div className="detail-section">
                        <div className="panel-header compact-panel-header">
                          <div>
                            <h3 className="section-title experiment-title">
                              {t('workflowStatusBreakdown')}
                            </h3>
                            <p className="text-muted">{t('workflowStatusBreakdownLead')}</p>
                          </div>
                        </div>
                        <div className="breakdown-list">
                          {(summary.statuses ?? []).map((item) => (
                            <div key={item.status} className="breakdown-row">
                              <div className="breakdown-meta">
                                <strong>{workflowExecutionStatusLabel(item.status)}</strong>
                                <span className="text-muted">
                                  {formatNumber(item.executions)} · {formatNumber(item.percentage)}%
                                </span>
                              </div>
                              <div className="breakdown-track" aria-hidden>
                                <span style={{ width: `${Math.min(100, item.percentage)}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="detail-section">
                        <div className="panel-header compact-panel-header">
                          <div>
                            <h3 className="section-title experiment-title">
                              {t('workflowEventBreakdown')}
                            </h3>
                            <p className="text-muted">{t('workflowEventBreakdownLead')}</p>
                          </div>
                        </div>
                        <div className="workflow-event-list">
                          {(summary.events ?? []).map((item) => (
                            <div key={item.eventName} className="workflow-event-row">
                              <div>
                                <strong>{item.eventName}</strong>
                                <p className="text-muted">{formatDateTime(item.lastExecutionAt)}</p>
                              </div>
                              <span className="badge">{formatNumber(item.executions)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="workflow-execution-filters">
                    <div className="field">
                      <Label htmlFor="workflow-filter-search">{t('workflowFilterSearch')}</Label>
                      <Input
                        id="workflow-filter-search"
                        value={filters.q}
                        placeholder={t('workflowFilterSearchPlaceholder')}
                        onChange={(event) =>
                          setFilters((prev) => ({ ...prev, q: event.target.value }))
                        }
                      />
                    </div>
                    <div className="field">
                      <Label htmlFor="workflow-filter-status">{t('workflowFilterStatus')}</Label>
                      <select
                        id="workflow-filter-status"
                        className="select"
                        value={filters.status}
                        onChange={(event) =>
                          setFilters((prev) => ({ ...prev, status: event.target.value }))
                        }
                      >
                        <option value="">{t('all')}</option>
                        {EXECUTION_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {workflowExecutionStatusLabel(status)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <Label htmlFor="workflow-filter-event">{t('workflowFilterEvent')}</Label>
                      <Input
                        id="workflow-filter-event"
                        value={filters.event}
                        placeholder="checkout_completed"
                        onChange={(event) =>
                          setFilters((prev) => ({ ...prev, event: event.target.value }))
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!filtersActive}
                      onClick={() => setFilters(DEFAULT_FILTERS)}
                    >
                      {t('reset')}
                    </Button>
                  </div>

                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('workflowEvent')}</th>
                          <th>{t('status')}</th>
                          <th>{t('session')}</th>
                          <th>{t('error')}</th>
                          <th>{t('created')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {executions.length ? (
                          executions.map((execution) => (
                            <tr key={execution.id}>
                              <td>{execution.eventName ?? '-'}</td>
                              <td>
                                <span className="badge badge-accent">
                                  {workflowExecutionStatusLabel(execution.status)}
                                </span>
                              </td>
                              <td>
                                {execution.sessionId ? (
                                  <Link
                                    to={`/websites/${websiteId}/sessions/${execution.sessionId}`}
                                    className="inline-link"
                                  >
                                    {execution.sessionId.slice(0, 8)}
                                    <ExternalLink size={12} strokeWidth={2} aria-hidden />
                                  </Link>
                                ) : (
                                  <span className="text-muted">-</span>
                                )}
                              </td>
                              <td className="text-muted">{execution.error ?? '-'}</td>
                              <td className="text-muted">{formatDateTime(execution.createdAt)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="text-muted">
                              {executionsQuery.isLoading ? t('loading') : t('workflowNoExecutions')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </MasterDetailPane>
              ) : null
            }
          />
        ) : (
          <EmptyState title={t('workflowsEmptyTitle')} description={t('workflowsEmptyBody')} />
        )}
      </section>
      {canEdit && editingWorkflow ? (
        <WorkflowEditDialog
          workflow={editingWorkflow}
          saving={updateMutation.isPending}
          error={(updateMutation.error as Error | null) ?? null}
          onClose={() => setEditingWorkflow(null)}
          onSave={(workflow, patch) => updateMutation.mutate({ id: workflow.id, patch })}
        />
      ) : null}
    </div>
  );
}
