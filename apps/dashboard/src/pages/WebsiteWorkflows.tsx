import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, ExternalLink, Plus, Workflow as WorkflowIcon } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  useMasterDetailSelection,
} from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SegmentTabs } from '../components/SegmentTabs';
import { WorkflowEditorDialog, stepTypeLabel, type WorkflowBody } from '../components/WorkflowEditor';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  api,
  type Workflow,
  type WorkflowCondition,
  type WorkflowExecutionDetail,
  type WorkflowExecutionsResponse,
  type WorkflowSampleEvent,
  type WorkflowStep,
  type WorkflowTestResult,
} from '../lib/api';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { formatDateTime, formatNumber } from '../lib/format';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';

const DEFAULT_FILTERS = { status: '', from: '', to: '', q: '' };

const EXECUTION_STATUSES = [
  'recorded',
  'queued',
  'running',
  'waiting',
  'retrying',
  'success',
  'failed',
  'stopped',
  'throttled',
  'cancelled',
] as const;

type DetailTab = 'overview' | 'executions' | 'test';

const ATTEMPT_STATUSES = ['passed'];

function statusLabel(status: string) {
  if ((EXECUTION_STATUSES as readonly string[]).includes(status)) return t(`workflowExecutionStatus_${status}`);
  if (ATTEMPT_STATUSES.includes(status)) return t(`workflowAttemptStatus_${status}`);
  return status;
}

function statusBadgeClass(status: string) {
  if (status === 'failed' || status === 'throttled') return 'badge workflow-status-danger';
  if (status === 'success' || status === 'recorded' || status === 'passed' || status === 'sent') return 'badge workflow-status-success';
  return 'badge';
}

function conditionText(condition: WorkflowCondition) {
  const field = t(`featureFlagField_${condition.field}`);
  const subject = condition.key ? `${field} ${condition.key}` : field;
  const operator = t(`featureFlagOperator_${condition.operator}`);
  return condition.operator === 'exists' || condition.operator === 'not_exists'
    ? `${subject} ${operator}`
    : `${subject} ${operator} “${condition.value}”`;
}

function stepSummary(step: WorkflowStep) {
  switch (step.type) {
    case 'delay':
      return t('workflowStepSummary_delay').replace('{minutes}', formatNumber(step.minutes));
    case 'condition':
      return step.conditions.map(conditionText).join(` ${t('featureFlagAnd')} `);
    case 'webhook':
      return `${step.method} ${step.url}`;
    case 'email':
      return step.to;
    case 'slack':
      return t('workflowStepSummary_slack');
  }
}

/** Date input (yyyy-mm-dd, local) → epoch ms at local midnight; `endOfDay` gives the next midnight. */
function dateInputToMs(value: string, endOfDay = false) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day + (endOfDay ? 1 : 0)).getTime();
}

function WorkflowFlowSummary({ workflow }: { workflow: Workflow }) {
  return (
    <div className="detail-section">
      <div className="panel-header compact-panel-header">
        <div>
          <h3 className="section-title experiment-title">{t('workflowFlow')}</h3>
          {workflow.description ? <p className="text-muted">{workflow.description}</p> : null}
        </div>
      </div>
      {!workflow.stepsValid ? <p className="text-danger">{t('workflowStepsInvalid')}</p> : null}
      <ol className="workflow-flow">
        <li className="workflow-flow-step">
          <span className="workflow-flow-kind">{t('workflowTrigger')}</span>
          <span>
            <code>{workflow.triggerEvent}</code>
            {workflow.filters.length ? ` · ${workflow.filters.map(conditionText).join(` ${t('featureFlagAnd')} `)}` : ''}
          </span>
        </li>
        {workflow.steps.map((step, index) => (
          <li key={step.id} className="workflow-flow-step">
            <span className="workflow-flow-kind">
              {index + 1}. {stepTypeLabel(step.type)}
            </span>
            <span className="workflow-flow-detail">{stepSummary(step)}</span>
          </li>
        ))}
        {!workflow.steps.length ? (
          <li className="workflow-flow-step">
            <span className="workflow-flow-kind">{t('workflowRecordOnly')}</span>
            <span className="text-muted">{t('workflowRecordOnlyLead')}</span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

function WorkflowSigningSecret({
  websiteId,
  workflow,
  canEdit,
  revealed,
  onRevealed,
}: {
  websiteId: string;
  workflow: Workflow;
  canEdit: boolean;
  revealed: string | null;
  onRevealed: (secret: string) => void;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const rotate = useMutation({
    mutationFn: () =>
      api<{ signingSecret: string }>(`/api/websites/${websiteId}/workflows/${workflow.id}/rotate-secret`, { method: 'POST' }),
    onSuccess: (result) => {
      onRevealed(result.signingSecret);
      queryClient.invalidateQueries({ queryKey: ['workflows', websiteId] });
    },
  });
  if (!workflow.steps.some((step) => step.type === 'webhook')) return null;
  return (
    <div className="detail-section">
      <div className="panel-header compact-panel-header">
        <div>
          <h3 className="section-title experiment-title">{t('workflowSigningSecret')}</h3>
          <p className="text-muted">{t('workflowSigningSecretLead')}</p>
        </div>
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rotate.isPending}
            onClick={() =>
              confirm({
                title: t('workflowRotateSecretTitle'),
                description: t('workflowRotateSecretBody'),
                confirmLabel: t('workflowRotateSecret'),
                onConfirm: () => rotate.mutate(),
              })
            }
          >
            {t('workflowRotateSecret')}
          </Button>
        ) : null}
      </div>
      {revealed ? (
        <div className="workflow-secret-reveal">
          <p>{t('workflowSigningSecretOnce')}</p>
          <code className="workflow-secret-value">{revealed}</code>
        </div>
      ) : (
        <p>
          <code>{workflow.signingSecretPreview ?? '—'}</code>
        </p>
      )}
      {rotate.error ? <p className="text-danger">{(rotate.error as Error).message}</p> : null}
    </div>
  );
}

function ExecutionAttempts({ websiteId, workflow, executionId }: { websiteId: string; workflow: Workflow; executionId: string }) {
  const detail = useQuery({
    queryKey: ['workflow-execution', websiteId, workflow.id, executionId],
    queryFn: () =>
      api<WorkflowExecutionDetail>(`/api/websites/${websiteId}/workflows/${workflow.id}/executions/${executionId}`),
  });
  if (detail.isLoading) return <p className="text-muted">{t('loading')}</p>;
  if (detail.error) return <p className="text-danger">{(detail.error as Error).message}</p>;
  const attempts = detail.data?.attempts ?? [];
  if (!attempts.length) return <p className="text-muted">{t('workflowNoAttempts')}</p>;
  return (
    <table className="data-table workflow-attempts">
      <thead>
        <tr>
          <th>{t('workflowStep')}</th>
          <th>{t('workflowAttempt')}</th>
          <th>{t('status')}</th>
          <th>{t('workflowResponseCode')}</th>
          <th>{t('workflowNextRetry')}</th>
          <th>{t('error')}</th>
          <th>{t('created')}</th>
        </tr>
      </thead>
      <tbody>
        {attempts.map((attempt) => (
          <tr key={attempt.id}>
            <td>
              {attempt.stepIndex + 1}. {stepTypeLabel(attempt.stepType as WorkflowStep['type'])}
            </td>
            <td className="num">{attempt.attempt}</td>
            <td>
              <span className={statusBadgeClass(attempt.status)}>{statusLabel(attempt.status)}</span>
            </td>
            <td className="num">
              {attempt.responseCode ?? '—'}
              {attempt.durationMs != null ? <span className="text-muted"> · {formatNumber(attempt.durationMs)} ms</span> : null}
            </td>
            <td className="text-muted">{attempt.nextRetryAt ? formatDateTime(attempt.nextRetryAt) : '—'}</td>
            <td>
              {attempt.error ?? '—'}
              {attempt.responseBody ? (
                <details className="workflow-response">
                  <summary>{t('workflowResponseBody')}</summary>
                  <pre className="flag-json">{attempt.responseBody}</pre>
                </details>
              ) : null}
            </td>
            <td className="text-muted">{formatDateTime(attempt.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WorkflowExecutionsPanel({ websiteId, workflow }: { websiteId: string; workflow: Workflow }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [expanded, setExpanded] = useState<string | null>(null);
  const debouncedQ = useDebouncedValue(filters.q, 300);
  const from = dateInputToMs(filters.from);
  const to = dateInputToMs(filters.to, true);

  const executionsQuery = useQuery({
    queryKey: ['workflow-executions', websiteId, workflow.id, filters.status, from, to, debouncedQ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (from != null) params.set('from', String(from));
      if (to != null) params.set('to', String(to));
      if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
      const query = params.toString();
      return api<WorkflowExecutionsResponse>(
        `/api/websites/${websiteId}/workflows/${workflow.id}/executions${query ? `?${query}` : ''}`,
      );
    },
    refetchInterval: (query) =>
      query.state.data?.executions.some((row) => ['queued', 'running', 'waiting', 'retrying'].includes(row.status))
        ? 15_000
        : false,
  });
  const executions = executionsQuery.data?.executions ?? [];
  const filtersActive = Boolean(filters.status || filters.from || filters.to || filters.q.trim());

  return (
    <>
      <div className="workflow-execution-filters">
        <div className="field">
          <Label htmlFor="workflow-filter-search">{t('workflowFilterSearch')}</Label>
          <Input
            id="workflow-filter-search"
            value={filters.q}
            placeholder={t('workflowFilterSearchPlaceholder')}
            onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
          />
        </div>
        <div className="field">
          <Label htmlFor="workflow-filter-status">{t('workflowFilterStatus')}</Label>
          <select
            id="workflow-filter-status"
            className="select"
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
          >
            <option value="">{t('all')}</option>
            {EXECUTION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <Label htmlFor="workflow-filter-from">{t('workflowFilterFrom')}</Label>
          <Input
            id="workflow-filter-from"
            type="date"
            value={filters.from}
            onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
          />
        </div>
        <div className="field">
          <Label htmlFor="workflow-filter-to">{t('workflowFilterTo')}</Label>
          <Input
            id="workflow-filter-to"
            type="date"
            value={filters.to}
            onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
          />
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={!filtersActive} onClick={() => setFilters(DEFAULT_FILTERS)}>
          {t('reset')}
        </Button>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th aria-label={t('workflowAttempts')} />
              <th>{t('status')}</th>
              <th>{t('workflowEvent')}</th>
              <th>{t('session')}</th>
              <th>{t('workflowAttempts')}</th>
              <th>{t('error')}</th>
              <th>{t('created')}</th>
            </tr>
          </thead>
          <tbody>
            {executions.length ? (
              executions.map((execution) => {
                const open = expanded === execution.id;
                return (
                  <Fragment key={execution.id}>
                    <tr>
                      <td>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-expanded={open}
                          aria-label={t('workflowShowAttempts')}
                          onClick={() => setExpanded(open ? null : execution.id)}
                        >
                          {open ? (
                            <ChevronDown size={14} strokeWidth={2} aria-hidden />
                          ) : (
                            <ChevronRight size={14} strokeWidth={2} aria-hidden />
                          )}
                        </Button>
                      </td>
                      <td>
                        <span className={statusBadgeClass(execution.status)}>{statusLabel(execution.status)}</span>
                        {execution.nextRetryAt && ['waiting', 'retrying'].includes(execution.status) ? (
                          <p className="text-muted">
                            {t('workflowResumesAt').replace('{time}', formatDateTime(execution.nextRetryAt))}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        {execution.eventName ?? '—'}
                        {execution.distinctId ? <p className="text-muted mono">{execution.distinctId}</p> : null}
                      </td>
                      <td>
                        {execution.sessionId ? (
                          <Link to={`/websites/${websiteId}/sessions/${execution.sessionId}`} className="inline-link">
                            {execution.sessionId.slice(0, 8)}
                            <ExternalLink size={12} strokeWidth={2} aria-hidden />
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="num">
                        {formatNumber(execution.attempts)}
                        {execution.responseCode ? <span className="text-muted"> · {execution.responseCode}</span> : null}
                      </td>
                      <td className="text-muted">{execution.error ?? '—'}</td>
                      <td className="text-muted">{formatDateTime(execution.createdAt)}</td>
                    </tr>
                    {open ? (
                      <tr className="workflow-attempts-row">
                        <td colSpan={7}>
                          <ExecutionAttempts websiteId={websiteId} workflow={workflow} executionId={execution.id} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="text-muted">
                  {executionsQuery.isLoading ? t('loading') : t('workflowNoExecutions')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

type JsonCheck = { ok: true; value: Record<string, unknown> } | { ok: false };

function parseObject(text: string): JsonCheck {
  if (!text.trim()) return { ok: true, value: {} };
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ok: true, value: value as Record<string, unknown> }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

function WorkflowTestPanel({ websiteId, workflow }: { websiteId: string; workflow: Workflow }) {
  const [eventName, setEventName] = useState(workflow.triggerEvent);
  const [url, setUrl] = useState('/');
  const [distinctId, setDistinctId] = useState('');
  const [propertiesText, setPropertiesText] = useState('{}');
  const [personText, setPersonText] = useState('{}');
  const properties = parseObject(propertiesText);
  const person = parseObject(personText);

  useEffect(() => {
    setEventName(workflow.triggerEvent);
  }, [workflow.triggerEvent]);

  const sample = useMutation({
    mutationFn: () => api<WorkflowSampleEvent>(`/api/websites/${websiteId}/workflows/${workflow.id}/sample-event`),
    onSuccess: ({ event }) => {
      if (!event) return;
      setEventName(event.name);
      setUrl(`${event.urlPath ?? '/'}${event.urlQuery ? `?${event.urlQuery}` : ''}`);
      setDistinctId(event.distinctId ?? '');
      setPropertiesText(JSON.stringify(event.properties, null, 2));
    },
  });

  const run = useMutation({
    mutationFn: (send: boolean) =>
      api<WorkflowTestResult>(`/api/websites/${websiteId}/workflows/${workflow.id}/test`, {
        method: 'POST',
        body: JSON.stringify({
          send,
          event: {
            name: eventName.trim() || undefined,
            url: url.trim() || undefined,
            distinctId: distinctId.trim() || undefined,
            properties: properties.ok ? properties.value : {},
          },
          personProperties: person.ok ? person.value : {},
        }),
      }),
  });

  const canRun = properties.ok && person.ok && !run.isPending;
  const hasActions = workflow.steps.some((step) => ['webhook', 'email', 'slack'].includes(step.type));
  const result = run.data;

  return (
    <div className="detail-section">
      <p className="text-muted">{t('workflowTestLead')}</p>
      <div className="flag-editor-grid">
        <div className="field">
          <Label htmlFor="workflow-test-event">{t('workflowEvent')}</Label>
          <Input id="workflow-test-event" className="mono" value={eventName} onChange={(event) => setEventName(event.target.value)} />
        </div>
        <div className="field">
          <Label htmlFor="workflow-test-url">{t('workflowTestUrl')}</Label>
          <Input id="workflow-test-url" className="mono" value={url} onChange={(event) => setUrl(event.target.value)} />
        </div>
        <div className="field flag-editor-wide">
          <Label htmlFor="workflow-test-distinct">{t('workflowTestDistinctId')}</Label>
          <Input
            id="workflow-test-distinct"
            className="mono"
            value={distinctId}
            placeholder={t('workflowTestDistinctIdPlaceholder')}
            onChange={(event) => setDistinctId(event.target.value)}
          />
        </div>
        <div className="field">
          <Label htmlFor="workflow-test-properties">{t('workflowTestProperties')}</Label>
          <Textarea
            id="workflow-test-properties"
            className="mono flag-payload-input"
            spellCheck={false}
            value={propertiesText}
            aria-invalid={!properties.ok}
            onChange={(event) => setPropertiesText(event.target.value)}
          />
          {!properties.ok ? <p className="text-danger">{t('workflowTestJsonInvalid')}</p> : null}
        </div>
        <div className="field">
          <Label htmlFor="workflow-test-person">{t('workflowTestPersonProperties')}</Label>
          <Textarea
            id="workflow-test-person"
            className="mono flag-payload-input"
            spellCheck={false}
            value={personText}
            aria-invalid={!person.ok}
            onChange={(event) => setPersonText(event.target.value)}
          />
          {!person.ok ? <p className="text-danger">{t('workflowTestJsonInvalid')}</p> : null}
        </div>
      </div>
      <div className="form-actions workflow-test-actions">
        <Button type="button" variant="ghost" size="sm" disabled={sample.isPending} onClick={() => sample.mutate()}>
          {t('workflowTestLoadLatest')}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!canRun} onClick={() => run.mutate(false)}>
          {t('workflowTestPreview')}
        </Button>
        <Button type="button" variant="primary" size="sm" disabled={!canRun || !hasActions} onClick={() => run.mutate(true)}>
          {run.isPending ? t('saving') : t('workflowTestSend')}
        </Button>
      </div>
      {sample.data && !sample.data.event ? <p className="text-muted">{t('workflowTestNoSample')}</p> : null}
      {run.error ? <p className="text-danger">{(run.error as Error).message}</p> : null}
      {result ? (
        <div className="workflow-test-results">
          <p className={result.matched ? 'text-muted' : 'text-danger'}>
            {result.matched ? t('workflowTestMatched') : t('workflowTestNotMatched')}
          </p>
          {result.steps.map((step) => (
            <div key={step.index} className="flag-group">
              <div className="flag-group-head">
                <strong>
                  {t('workflowStepN').replace('{n}', String(step.index + 1))} · {stepTypeLabel(step.type)}
                </strong>
                <span className={statusBadgeClass(step.status)}>{t(`workflowTestStatus_${step.status}`)}</span>
              </div>
              {step.detail ? <p className="text-muted">{step.detail}</p> : null}
              {step.error ? <p className="text-danger">{step.error}</p> : null}
              {step.request ? (
                step.request.type === 'email' ? (
                  <pre className="flag-json">
                    {`To: ${step.request.to.join(', ')}\nSubject: ${step.request.subject}\n\n${step.request.text}`}
                  </pre>
                ) : (
                  <pre className="flag-json">
                    {`${step.request.method} ${step.request.url}\n${step.request.headers
                      .map((header) => `${header.key}: ${header.value}`)
                      .join('\n')}${step.request.body ? `\n\n${prettyJson(step.request.body)}` : ''}`}
                  </pre>
                )
              ) : null}
              {step.response ? (
                <>
                  <p className="text-muted">
                    {t('workflowResponseCode')}: {step.response.statusCode ?? '—'} · {formatNumber(step.response.durationMs)} ms
                  </p>
                  {step.response.body ? <pre className="flag-json">{step.response.body}</pre> : null}
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function prettyJson(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export default function WebsiteWorkflowsPage() {
  const confirm = useConfirm();
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit } = useWebsitePermissions(websiteId);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<{ workflow: Workflow | null } | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  /** Signing secret shown once, right after creation or rotation. */
  const [revealed, setRevealed] = useState<{ workflowId: string; secret: string } | null>(null);

  const workflowsQuery = useQuery({
    queryKey: ['workflows', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Workflow[]>(`/api/websites/${websiteId}/workflows`),
  });

  const workflows = useMemo(() => workflowsQuery.data ?? [], [workflowsQuery.data]);
  const { selectedId: selectedWorkflowId, setSelectedId: setSelectedWorkflowId, selectedItem: selectedWorkflow } =
    useMasterDetailSelection(workflows, (workflow) => workflow.id);

  function selectWorkflow(id: string, replace = false) {
    setSelectedWorkflowId(id);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('workflow', id);
        return next;
      },
      { replace },
    );
  }

  useEffect(() => {
    if (!workflows.length) {
      setSelectedWorkflowId(null);
      return;
    }
    const requested = searchParams.get('workflow');
    if (requested && workflows.some((workflow) => workflow.id === requested)) {
      setSelectedWorkflowId(requested);
      return;
    }
    if (!selectedWorkflowId || !workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      selectWorkflow(workflows[0]!.id, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, selectedWorkflowId, workflows]);

  useEffect(() => {
    setDetailTab('overview');
  }, [selectedWorkflowId]);

  const saveMutation = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: WorkflowBody }) =>
      id
        ? api<Workflow>(`/api/websites/${websiteId}/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api<Workflow>(`/api/websites/${websiteId}/workflows`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (workflow) => {
      setEditor(null);
      if (workflow.signingSecret) setRevealed({ workflowId: workflow.id, secret: workflow.signingSecret });
      selectWorkflow(workflow.id);
      queryClient.invalidateQueries({ queryKey: ['workflows', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['workflow-executions', websiteId] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (workflow: Workflow) =>
      api<Workflow>(`/api/websites/${websiteId}/workflows/${workflow.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !workflow.enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows', websiteId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/workflows/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['workflow-executions', websiteId] });
    },
  });

  const summary = selectedWorkflow?.summary;

  return (
    <Page className="page-workflows">
      <PageHeader
        title={t('workflows')}
        lead={t('workflowsLead')}
        actions={
          canEdit ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                saveMutation.reset();
                setEditor({ workflow: null });
              }}
            >
              <Plus size={14} strokeWidth={2} aria-hidden />
              {t('createWorkflow')}
            </Button>
          ) : null
        }
      />

      <PageBody>
        {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}
        <p className="text-muted section-gap">{t('workflowLimitsNote')}</p>

        <section className="section-gap">
          {workflowsQuery.isLoading ? (
            <div className="skeleton skeleton-block" aria-busy />
          ) : workflows.length ? (
            <MasterDetailLayout
              list={workflows.map((workflow) => (
                <MasterDetailListItem
                  key={workflow.id}
                  selected={workflow.id === selectedWorkflowId}
                  onSelect={() => selectWorkflow(workflow.id)}
                  icon={<WorkflowIcon size={16} strokeWidth={2} aria-hidden />}
                  title={workflow.name}
                  subtitle={workflow.triggerEvent}
                  meta={
                    <>
                      <span className="badge">{workflow.enabled ? t('enabled') : t('disabled')}</span>
                      <span className="text-muted">
                        {t('workflowStepCount').replace('{count}', formatNumber(workflow.steps.length))} ·{' '}
                        {formatNumber(workflow.summary?.executions ?? 0)} {t('workflowExecutions')}
                      </span>
                    </>
                  }
                />
              ))}
              detail={
                selectedWorkflow && websiteId ? (
                  <MasterDetailPane
                    title={selectedWorkflow.name}
                    description={
                      <p className="text-muted">
                        {t('workflowTriggerEvent')}: <code>{selectedWorkflow.triggerEvent}</code>
                      </p>
                    }
                    actions={
                      canEdit ? (
                        <div className="cohorts-row-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              saveMutation.reset();
                              setEditor({ workflow: selectedWorkflow });
                            }}
                          >
                            {t('edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={toggleMutation.isPending}
                            onClick={() => toggleMutation.mutate(selectedWorkflow)}
                          >
                            {selectedWorkflow.enabled ? t('disable') : t('enable')}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive-ghost"
                            size="sm"
                            onClick={() =>
                              confirm({
                                title: deleteTitle(selectedWorkflow.name),
                                description: t('workflowDeleteBody'),
                                onConfirm: () => deleteMutation.mutate(selectedWorkflow.id),
                              })
                            }
                          >
                            {t('delete')}
                          </Button>
                        </div>
                      ) : null
                    }
                  >
                    {toggleMutation.error ? <p className="text-danger">{(toggleMutation.error as Error).message}</p> : null}
                    {deleteMutation.error ? <p className="text-danger">{(deleteMutation.error as Error).message}</p> : null}
                    <SegmentTabs
                      className="flag-detail-tabs"
                      aria-label={t('workflows')}
                      value={detailTab}
                      onChange={(id) => setDetailTab(id as DetailTab)}
                      tabs={[
                        { id: 'overview', label: t('workflowTabOverview') },
                        { id: 'executions', label: t('workflowTabExecutions') },
                        ...(canEdit ? [{ id: 'test', label: t('workflowTabTest') }] : []),
                      ]}
                    />

                    {detailTab === 'overview' ? (
                      <>
                        <div className="detail-stats">
                          <div>
                            <span className="stat-label">{t('workflowExecutions')}</span>
                            <strong className="stat-value">{formatNumber(summary?.executions ?? 0)}</strong>
                          </div>
                          <div>
                            <span className="stat-label">{t('workflowInProgress')}</span>
                            <strong className="stat-value">{formatNumber(summary?.inProgress ?? 0)}</strong>
                          </div>
                          <div>
                            <span className="stat-label">{t('workflowFailures')}</span>
                            <strong className="stat-value">{formatNumber(summary?.failures ?? 0)}</strong>
                          </div>
                          <div>
                            <span className="stat-label">{t('workflowSuccessRate')}</span>
                            <strong className="stat-value">{formatNumber(summary?.successRate ?? 0)}%</strong>
                          </div>
                          <div>
                            <span className="stat-label">{t('workflowLastExecution')}</span>
                            <strong className="stat-value">{formatDateTime(summary?.lastExecutionAt)}</strong>
                          </div>
                        </div>
                        <WorkflowFlowSummary workflow={selectedWorkflow} />
                        <WorkflowSigningSecret
                          websiteId={websiteId}
                          workflow={selectedWorkflow}
                          canEdit={canEdit}
                          revealed={revealed?.workflowId === selectedWorkflow.id ? revealed.secret : null}
                          onRevealed={(secret) => setRevealed({ workflowId: selectedWorkflow.id, secret })}
                        />
                        {summary?.statuses?.length ? (
                          <div className="detail-section">
                            <div className="panel-header compact-panel-header">
                              <div>
                                <h3 className="section-title experiment-title">{t('workflowStatusBreakdown')}</h3>
                                <p className="text-muted">{t('workflowStatusBreakdownLead')}</p>
                              </div>
                            </div>
                            <div className="breakdown-list">
                              {summary.statuses.map((item) => (
                                <div key={item.status} className="breakdown-row">
                                  <div className="breakdown-meta">
                                    <strong>{statusLabel(item.status)}</strong>
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
                        ) : null}
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
                      </>
                    ) : null}

                    {detailTab === 'executions' ? (
                      <WorkflowExecutionsPanel websiteId={websiteId} workflow={selectedWorkflow} />
                    ) : null}
                    {detailTab === 'test' && canEdit ? (
                      <WorkflowTestPanel key={selectedWorkflow.id} websiteId={websiteId} workflow={selectedWorkflow} />
                    ) : null}
                  </MasterDetailPane>
                ) : null
              }
            />
          ) : (
            <EmptyState title={t('workflowsEmptyTitle')} description={t('workflowsEmptyBody')} />
          )}
        </section>
        {canEdit && editor ? (
          <WorkflowEditorDialog
            workflow={editor.workflow}
            saving={saveMutation.isPending}
            error={(saveMutation.error as Error | null) ?? null}
            onClose={() => setEditor(null)}
            onSave={(body) => saveMutation.mutate({ id: editor.workflow?.id ?? null, body })}
          />
        ) : null}
      </PageBody>
    </Page>
  );
}
