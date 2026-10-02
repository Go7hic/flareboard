import { Fragment, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { Bar, BarChart } from 'recharts';
import { Activity, ChevronDown, ChevronRight, KeyRound, Pencil, Plus, Power, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { BreakdownList } from '../components/BreakdownList';
import { ChartLegend } from '../components/ChartLegend';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip } from '../components/KpiStrip';
import { MasterDetailLayout, MasterDetailListItem, MasterDetailPane, ResourceSearchField } from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { countMeta, formatShare, tf, utcDay } from '../components/product/format';
import { ProductListHeader, ProductMasterDetailSkeleton, ProductNoMatches } from '../components/product/ProductList';
import { ProductCallout, ProductNote, ProductSection } from '../components/product/ProductSection';
import { ProductTabs } from '../components/product/ProductTabs';
import { RelativeTime, ShortDate } from '../components/product/ProductTime';
import { SessionLink } from '../components/product/SessionLink';
import { runStatus, testStepStatus, workflowStatus } from '../components/product/status';
import { StepIcon, WorkflowFlow } from '../components/product/WorkflowFlow';
import { StatusBadge } from '../components/StatusBadge';
import { WorkflowEditorDialog, stepTypeLabel, type WorkflowBody } from '../components/WorkflowEditor';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Textarea } from '../components/ui/textarea';
import {
  api,
  type Workflow,
  type WorkflowExecutionDetail,
  type WorkflowExecutionsResponse,
  type WorkflowSampleEvent,
  type WorkflowStep,
  type WorkflowTestResult,
} from '../lib/api';
import { cssVarValue } from '../lib/chart-colors';
import { STACK_MARK } from '../lib/chartMarks';
import { formatNumber, formatShortDate, formatShortDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

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

const IN_PROGRESS = ['queued', 'running', 'waiting', 'retrying'];

type DetailTab = 'overview' | 'runs' | 'test';

/** Date input (yyyy-mm-dd, local) → epoch ms at local midnight; `endOfDay` gives the next midnight. */
function dateInputToMs(value: string, endOfDay = false) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day + (endOfDay ? 1 : 0)).getTime();
}

function RunBadge({ status }: { status: string }) {
  const info = runStatus(status);
  return <StatusBadge tone={info.tone}>{info.label}</StatusBadge>;
}

/* ── Overview ──────────────────────────────────────────────────────────────── */

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
    <ProductSection
      title={t('workflowSigningSecret')}
      description={t('workflowSigningSecretLead')}
      actions={
        canEdit ? (
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
            <KeyRound strokeWidth={2} aria-hidden />
            {t('workflowRotateSecret')}
          </Button>
        ) : null
      }
    >
      {revealed ? (
        <ProductCallout tone="warning" title={t('workflowSigningSecretOnce')} role="status">
          <code className="product-secret">{revealed}</code>
        </ProductCallout>
      ) : (
        <p className="product-muted-line">
          <code className="mono product-secret-preview">{workflow.signingSecretPreview ?? '—'}</code>
          {workflow.signingSecretRotatedAt ? (
            <>
              {' · '}
              {t('productWorkflowRotated')} <ShortDate value={workflow.signingSecretRotatedAt} />
            </>
          ) : null}
        </p>
      )}
      {rotate.error ? <p className="text-danger product-inline-error">{(rotate.error as Error).message}</p> : null}
    </ProductSection>
  );
}

function RunsChart({ workflow }: { workflow: Workflow }) {
  const chartColors = useChartColors();
  const trend = workflow.summary?.trend ?? [];
  // Status colors (they mean good / bad): read on every render so a theme switch repaints.
  const colors = {
    success: cssVarValue('--success') || chartColors.accent,
    other: cssVarValue('--product-other') || chartColors.muted,
    failed: cssVarValue('--danger') || chartColors.accent,
  };
  const data = trend.map((row) => ({
    x: formatShortDate(utcDay(row.date), { timeZone: 'UTC' }),
    success: row.successes,
    failed: row.failures,
    other: Math.max(0, row.executions - row.successes - row.failures),
  }));
  const series = (
    [
      { key: 'success', label: t('productRunsSucceeded'), color: colors.success, css: 'var(--success)' },
      { key: 'other', label: t('productRunsOther'), color: colors.other, css: 'var(--product-other)' },
      { key: 'failed', label: t('productRunsFailed'), color: colors.failed, css: 'var(--danger)' },
    ] as const
  ).filter((item) => data.some((row) => row[item.key] > 0));
  if (data.length < 2 || !series.length) return null;
  return (
    <ProductSection
      title={t('productRunsPerDay')}
      description={t('productRunsPerDayLead')}
      actions={<ChartLegend items={series.map((item) => ({ label: item.label, color: item.css, shape: 'box' }))} />}
    >
      <div className="product-chart">
        <AnalyticsChart
          Chart={BarChart}
          data={data}
          responsive={{ height: 200 }}
          xAxis={{ dataKey: 'x', interval: 'preserveStartEnd', minTickGap: 32 }}
        >
          {series.map((item, index) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.label}
              stackId="runs"
              fill={item.color}
              stroke={chartColors.panel}
              strokeWidth={1}
              {...STACK_MARK}
              {...(index === series.length - 1 ? { radius: [4, 4, 0, 0] as [number, number, number, number] } : {})}
            />
          ))}
        </AnalyticsChart>
      </div>
    </ProductSection>
  );
}

function WorkflowOverview({
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
  const statuses = workflow.summary?.statuses ?? [];
  const maxStatus = Math.max(1, ...statuses.map((item) => item.executions));
  return (
    <>
      <ProductSection title={t('workflowFlow')} description={t('productFlowLead')}>
        {!workflow.stepsValid ? (
          <ProductCallout tone="danger" title={t('workflowStepsInvalid')} role="alert" />
        ) : null}
        <WorkflowFlow workflow={workflow} />
      </ProductSection>
      <RunsChart workflow={workflow} />
      {statuses.length ? (
        <ProductSection title={t('workflowStatusBreakdown')} description={t('workflowStatusBreakdownLead')}>
          <BreakdownList
            labelHeader={t('status')}
            columns={[{ label: t('productRuns') }, { label: t('productShare') }]}
            items={statuses.map((item) => ({
              id: item.status,
              label: runStatus(item.status).label,
              share: item.executions / maxStatus,
              values: [formatNumber(item.executions), formatShare(item.percentage)],
            }))}
          />
        </ProductSection>
      ) : null}
      <WorkflowSigningSecret
        websiteId={websiteId}
        workflow={workflow}
        canEdit={canEdit}
        revealed={revealed}
        onRevealed={onRevealed}
      />
    </>
  );
}

/* ── Runs ──────────────────────────────────────────────────────────────────── */

function ExecutionAttempts({ websiteId, workflow, executionId }: { websiteId: string; workflow: Workflow; executionId: string }) {
  const detail = useQuery({
    queryKey: ['workflow-execution', websiteId, workflow.id, executionId],
    queryFn: () =>
      api<WorkflowExecutionDetail>(`/api/websites/${websiteId}/workflows/${workflow.id}/executions/${executionId}`),
  });
  if (detail.isLoading) return <Skeleton className="h-16 w-full" />;
  if (detail.error) return <p className="text-danger">{(detail.error as Error).message}</p>;
  const attempts = detail.data?.attempts ?? [];
  if (!attempts.length) return <p className="product-muted-line">{t('workflowNoAttempts')}</p>;
  return (
    <table className="data-table product-table product-attempts">
      <thead>
        <tr>
          <th>{t('workflowStep')}</th>
          <th className="num">{t('workflowAttempt')}</th>
          <th>{t('status')}</th>
          <th className="num">{t('workflowResponseCode')}</th>
          <th>{t('workflowNextRetry')}</th>
          <th>{t('error')}</th>
          <th>{t('productTime')}</th>
        </tr>
      </thead>
      <tbody>
        {attempts.map((attempt) => (
          <tr key={attempt.id}>
            <td>
              <span className="product-step-cell">
                <StepIcon type={attempt.stepType as WorkflowStep['type']} />
                {attempt.stepIndex + 1}. {stepTypeLabel(attempt.stepType as WorkflowStep['type'])}
              </span>
            </td>
            <td className="num">{attempt.attempt}</td>
            <td>
              <RunBadge status={attempt.status} />
            </td>
            <td className="num">
              {attempt.responseCode ?? '—'}
              {attempt.durationMs != null ? <span className="product-cell-sub">{formatNumber(attempt.durationMs)} ms</span> : null}
            </td>
            <td className="text-muted">{attempt.nextRetryAt ? <ShortDate value={attempt.nextRetryAt} withTime /> : '—'}</td>
            <td>
              {attempt.error ?? <span className="text-muted">—</span>}
              {attempt.responseBody ? (
                <details className="product-disclosure">
                  <summary>{t('workflowResponseBody')}</summary>
                  <pre className="product-json">{attempt.responseBody}</pre>
                </details>
              ) : null}
            </td>
            <td className="text-muted product-nowrap">
              <ShortDate value={attempt.createdAt} withTime />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WorkflowRuns({ websiteId, workflow }: { websiteId: string; workflow: Workflow }) {
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
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.executions.some((row) => IN_PROGRESS.includes(row.status)) ? 15_000 : false,
  });
  const executions = executionsQuery.data?.executions ?? [];
  const filtersActive = Boolean(filters.status || filters.from || filters.to || filters.q.trim());

  return (
    <ProductSection title={t('productRunsTitle')} description={t('productRunsLead')}>
      <div className="product-toolbar" role="group" aria-label={t('productRunsFilters')}>
        <ResourceSearchField
          className="product-toolbar-search"
          value={filters.q}
          onChange={(q) => setFilters((prev) => ({ ...prev, q }))}
          placeholder={t('workflowFilterSearchPlaceholder')}
          aria-label={t('workflowFilterSearch')}
        />
        <select
          className="select product-toolbar-select"
          aria-label={t('workflowFilterStatus')}
          value={filters.status}
          onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
        >
          <option value="">{t('productRunsAllStatuses')}</option>
          {EXECUTION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {runStatus(status).label}
            </option>
          ))}
        </select>
        <label className="product-toolbar-date">
          <span>{t('workflowFilterFrom')}</span>
          <Input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
          />
        </label>
        <label className="product-toolbar-date">
          <span>{t('workflowFilterTo')}</span>
          <Input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
          />
        </label>
        {filtersActive ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
            {t('reset')}
          </Button>
        ) : null}
      </div>

      {executionsQuery.isLoading && !executionsQuery.data ? (
        <div className="product-table-skeleton" aria-busy>
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : executionsQuery.isError && !executionsQuery.data ? (
        <DataViewState error={executionsQuery.error as Error} onRetry={() => executionsQuery.refetch()}>
          {null}
        </DataViewState>
      ) : executions.length ? (
        <div className={executionsQuery.isFetching ? 'table-scroll is-refreshing' : 'table-scroll'}>
          <table className="data-table product-table product-runs-table">
            <thead>
              <tr>
                <th aria-label={t('workflowShowAttempts')} />
                <th>{t('status')}</th>
                <th>{t('workflowEvent')}</th>
                <th>{t('session')}</th>
                <th className="num">{t('workflowAttempts')}</th>
                <th>{t('error')}</th>
                <th>{t('productTime')}</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((execution) => {
                const open = expanded === execution.id;
                return (
                  <Fragment key={execution.id}>
                    <tr className={open ? 'is-expanded' : undefined}>
                      <td className="product-expand-cell">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
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
                        <RunBadge status={execution.status} />
                        {execution.nextRetryAt && ['waiting', 'retrying'].includes(execution.status) ? (
                          <span className="product-cell-sub">
                            {t('workflowResumesAt').replace('{time}', formatShortDateTime(execution.nextRetryAt))}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span className="mono">{execution.eventName ?? '—'}</span>
                        {execution.distinctId ? (
                          <span className="product-cell-sub mono" title={execution.distinctId}>
                            {execution.distinctId}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <SessionLink websiteId={websiteId} sessionId={execution.sessionId} />
                      </td>
                      <td className="num">
                        {formatNumber(execution.attempts)}
                        {execution.responseCode ? <span className="product-cell-sub">{execution.responseCode}</span> : null}
                      </td>
                      <td className="product-error-cell" title={execution.error ?? undefined}>
                        {execution.error ?? <span className="text-muted">—</span>}
                      </td>
                      <td className="text-muted product-nowrap">
                        <ShortDate value={execution.createdAt} withTime />
                      </td>
                    </tr>
                    {open ? (
                      <tr className="product-subrow">
                        <td colSpan={7}>
                          <ExecutionAttempts websiteId={websiteId} workflow={workflow} executionId={execution.id} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={<Activity strokeWidth={2} />}
          title={filtersActive ? t('productRunsNoMatches') : t('workflowNoExecutions')}
          description={filtersActive ? t('productRunsNoMatchesHint') : tf('productRunsEmptyHint', { event: workflow.triggerEvent })}
        />
      )}
    </ProductSection>
  );
}

/* ── Test ──────────────────────────────────────────────────────────────────── */

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

function prettyJson(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
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
    <>
      <ProductSection
        title={t('productTestTitle')}
        description={t('workflowTestLead')}
        actions={
          <Button type="button" variant="outline" size="sm" disabled={sample.isPending} onClick={() => sample.mutate()}>
            {t('workflowTestLoadLatest')}
          </Button>
        }
      >
        {sample.data && !sample.data.event ? <p className="product-muted-line">{t('workflowTestNoSample')}</p> : null}
        <div className="product-form-grid">
          <div className="field product-field">
            <Label htmlFor="workflow-test-event">{t('workflowEvent')}</Label>
            <Input id="workflow-test-event" className="mono" value={eventName} onChange={(event) => setEventName(event.target.value)} />
          </div>
          <div className="field product-field">
            <Label htmlFor="workflow-test-url">{t('workflowTestUrl')}</Label>
            <Input id="workflow-test-url" className="mono" value={url} onChange={(event) => setUrl(event.target.value)} />
          </div>
          <div className="field product-field product-form-wide">
            <Label htmlFor="workflow-test-distinct">{t('workflowTestDistinctId')}</Label>
            <Input
              id="workflow-test-distinct"
              className="mono"
              value={distinctId}
              placeholder={t('workflowTestDistinctIdPlaceholder')}
              onChange={(event) => setDistinctId(event.target.value)}
            />
          </div>
          <div className="field product-field">
            <Label htmlFor="workflow-test-properties">{t('workflowTestProperties')}</Label>
            <Textarea
              id="workflow-test-properties"
              className="mono product-code-input"
              spellCheck={false}
              value={propertiesText}
              aria-invalid={!properties.ok}
              onChange={(event) => setPropertiesText(event.target.value)}
            />
            {!properties.ok ? <p className="field-hint text-danger">{t('workflowTestJsonInvalid')}</p> : null}
          </div>
          <div className="field product-field">
            <Label htmlFor="workflow-test-person">{t('workflowTestPersonProperties')}</Label>
            <Textarea
              id="workflow-test-person"
              className="mono product-code-input"
              spellCheck={false}
              value={personText}
              aria-invalid={!person.ok}
              onChange={(event) => setPersonText(event.target.value)}
            />
            {!person.ok ? <p className="field-hint text-danger">{t('workflowTestJsonInvalid')}</p> : null}
          </div>
        </div>
        <div className="product-form-actions">
          <Button type="button" variant="outline" disabled={!canRun} onClick={() => run.mutate(false)}>
            {t('workflowTestPreview')}
          </Button>
          <Button type="button" variant="primary" disabled={!canRun || !hasActions} onClick={() => run.mutate(true)}>
            {run.isPending ? t('saving') : t('workflowTestSend')}
          </Button>
          {run.error ? <span className="text-danger">{(run.error as Error).message}</span> : null}
        </div>
      </ProductSection>
      {result ? (
        <ProductSection title={t('productTestResult')}>
          <ProductCallout
            tone={result.matched ? 'success' : 'warning'}
            title={result.matched ? t('workflowTestMatched') : t('workflowTestNotMatched')}
            role="status"
          />
          <ol className="product-test-steps">
            {result.steps.map((step) => {
              const status = testStepStatus(step.status);
              return (
                <li key={step.index} className="product-test-step">
                  <div className="product-test-step-head">
                    <span className="product-step-cell">
                      <StepIcon type={step.type} />
                      {t('workflowStepN').replace('{n}', String(step.index + 1))} · {stepTypeLabel(step.type)}
                    </span>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </div>
                  {step.detail ? <p className="product-muted-line">{step.detail}</p> : null}
                  {step.error ? <p className="text-danger product-inline-error">{step.error}</p> : null}
                  {step.request ? (
                    step.request.type === 'email' ? (
                      <pre className="product-json">
                        {`To: ${step.request.to.join(', ')}\nSubject: ${step.request.subject}\n\n${step.request.text}`}
                      </pre>
                    ) : (
                      <pre className="product-json">
                        {`${step.request.method} ${step.request.url}\n${step.request.headers
                          .map((header) => `${header.key}: ${header.value}`)
                          .join('\n')}${step.request.body ? `\n\n${prettyJson(step.request.body)}` : ''}`}
                      </pre>
                    )
                  ) : null}
                  {step.response ? (
                    <>
                      <p className="product-muted-line">
                        {t('workflowResponseCode')}: {step.response.statusCode ?? '—'} · {formatNumber(step.response.durationMs)} ms
                      </p>
                      {step.response.body ? <pre className="product-json">{step.response.body}</pre> : null}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </ProductSection>
      ) : null}
    </>
  );
}

/* ── Detail and page ───────────────────────────────────────────────────────── */

function WorkflowKpis({ workflow }: { workflow: Workflow }) {
  const summary = workflow.summary;
  const runs = summary?.executions ?? 0;
  return (
    <KpiStrip inline columns={4}>
      <KpiCell
        label={t('productRuns')}
        value={formatNumber(runs)}
        hint={summary?.inProgress ? tf('productRunsInProgress', { count: formatNumber(summary.inProgress) }) : undefined}
      />
      <KpiCell
        label={t('workflowSuccessRate')}
        value={runs ? formatShare(summary?.successRate ?? 0) : '–'}
        hint={runs ? tf('productRunsSucceededCount', { count: formatNumber(summary?.successes ?? 0) }) : undefined}
      />
      <KpiCell
        label={t('workflowFailures')}
        value={formatNumber(summary?.failures ?? 0)}
        hint={runs ? tf('productRunsShare', { share: formatShare(((summary?.failures ?? 0) / runs) * 100) }) : undefined}
      />
      <KpiCell
        label={t('productLastRun')}
        value={summary?.lastExecutionAt ? <RelativeTime value={summary.lastExecutionAt} /> : '–'}
        hint={summary?.lastExecutionAt ? undefined : t('workflowNoExecutions')}
      />
    </KpiStrip>
  );
}

function WorkflowDetail({
  websiteId,
  workflow,
  canEdit,
  toggling,
  error,
  revealed,
  onRevealed,
  onEdit,
  onToggle,
  onDelete,
}: {
  websiteId: string;
  workflow: Workflow;
  canEdit: boolean;
  toggling: boolean;
  error: Error | null;
  revealed: string | null;
  onRevealed: (secret: string) => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const status = workflowStatus(workflow.enabled);
  return (
    <MasterDetailPane
      title={workflow.name}
      meta={
        <>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <span className="mono product-meta-key">{workflow.triggerEvent}</span>
          <span>{t('workflowStepCount').replace('{count}', formatNumber(workflow.steps.length))}</span>
          {workflow.updatedAt ? (
            <span>
              {t('productUpdated')} <ShortDate value={workflow.updatedAt} />
            </span>
          ) : null}
        </>
      }
      description={workflow.description || undefined}
      actions={
        canEdit ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              <Pencil strokeWidth={2} aria-hidden />
              {t('edit')}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={toggling} onClick={onToggle}>
              <Power strokeWidth={2} aria-hidden />
              {workflow.enabled ? t('disable') : t('enable')}
            </Button>
            <Button type="button" variant="destructive-ghost" size="sm" onClick={onDelete}>
              <Trash2 strokeWidth={2} aria-hidden />
              {t('delete')}
            </Button>
          </>
        ) : null
      }
    >
      {error ? (
        <p className="text-danger product-inline-error" role="alert">
          {error.message}
        </p>
      ) : null}
      <WorkflowKpis workflow={workflow} />
      <ProductTabs<DetailTab>
        label={t('workflows')}
        value={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'overview',
            label: t('workflowTabOverview'),
            content: (
              <WorkflowOverview
                websiteId={websiteId}
                workflow={workflow}
                canEdit={canEdit}
                revealed={revealed}
                onRevealed={onRevealed}
              />
            ),
          },
          {
            id: 'runs',
            label: (
              <>
                {t('productRunsTab')}
                {workflow.summary?.executions ? (
                  <span className="product-tab-count">
                    {formatNumber(workflow.summary.executions, { compact: workflow.summary.executions >= 10_000 })}
                  </span>
                ) : null}
              </>
            ),
            content: <WorkflowRuns websiteId={websiteId} workflow={workflow} />,
          },
          canEdit ? { id: 'test', label: t('workflowTabTest'), content: <WorkflowTestPanel websiteId={websiteId} workflow={workflow} /> } : null,
        ]}
      />
    </MasterDetailPane>
  );
}

export default function WebsiteWorkflowsPage() {
  const confirm = useConfirm();
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<{ workflow: Workflow | null } | null>(null);
  const [search, setSearch] = useState('');
  /** Signing secret shown once, right after creation or rotation. */
  const [revealed, setRevealed] = useState<{ workflowId: string; secret: string } | null>(null);

  const workflowsQuery = useQuery({
    queryKey: ['workflows', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Workflow[]>(`/api/websites/${websiteId}/workflows`),
  });

  // Enabled workflows first (stable otherwise), so the page opens on one that actually runs.
  const workflows = useMemo(
    () => [...(workflowsQuery.data ?? [])].sort((a, b) => Number(b.enabled) - Number(a.enabled)),
    [workflowsQuery.data],
  );
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return workflows;
    return workflows.filter(
      (workflow) =>
        workflow.name.toLowerCase().includes(needle) ||
        workflow.triggerEvent.toLowerCase().includes(needle) ||
        (workflow.description ?? '').toLowerCase().includes(needle),
    );
  }, [workflows, search]);
  const requestedId = searchParams.get('workflow');
  const selected = rows.find((workflow) => workflow.id === requestedId) ?? rows[0] ?? null;
  const enabledCount = workflows.filter((workflow) => workflow.enabled).length;

  function selectWorkflow(id: string, replace = false) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('workflow', id);
        return next;
      },
      { replace },
    );
  }

  const saveMutation = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: WorkflowBody }) =>
      id
        ? api<Workflow>(`/api/websites/${websiteId}/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api<Workflow>(`/api/websites/${websiteId}/workflows`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (workflow) => {
      setEditor(null);
      setSearch('');
      if (workflow.signingSecret) setRevealed({ workflowId: workflow.id, secret: workflow.signingSecret });
      selectWorkflow(workflow.id, true);
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

  const createButton = canEdit ? (
    <Button
      type="button"
      variant="primary"
      onClick={() => {
        saveMutation.reset();
        setEditor({ workflow: null });
      }}
    >
      <Plus strokeWidth={2} aria-hidden />
      {t('createWorkflow')}
    </Button>
  ) : null;

  return (
    <Page className="page-workflows product-page">
      <PageHeader title={t('workflows')} lead={t('workflowsLead')} actions={createButton} />

      <PageBody>
        {viewOnly ? <p className="product-view-only">{t('viewOnlyHint')}</p> : null}

        <DataViewState
          loading={workflowsQuery.isLoading}
          loadingFallback={<ProductMasterDetailSkeleton rows={3} />}
          error={workflowsQuery.isError ? workflowsQuery.error : null}
          onRetry={() => workflowsQuery.refetch()}
        >
          {workflows.length ? (
            <MasterDetailLayout
              listHeader={
                <ProductListHeader
                  search={search}
                  onSearch={setSearch}
                  placeholder={t('productWorkflowSearch')}
                  summary={tf('productWorkflowListSummary', {
                    count: formatNumber(workflows.length),
                    on: formatNumber(enabledCount),
                  })}
                />
              }
              list={
                rows.length ? (
                  rows.map((workflow) => {
                    const status = workflowStatus(workflow.enabled);
                    const runs = countMeta(t('productRunsCount'), workflow.summary?.executions ?? 0);
                    return (
                      <MasterDetailListItem
                        key={workflow.id}
                        selected={workflow.id === selected?.id}
                        onSelect={() => selectWorkflow(workflow.id)}
                        title={workflow.name}
                        subtitle={<span className="mono">{workflow.triggerEvent}</span>}
                        meta={
                          <>
                            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                            <span title={runs.title}>{runs.text}</span>
                          </>
                        }
                      />
                    );
                  })
                ) : (
                  <ProductNoMatches query={search} onClear={() => setSearch('')} />
                )
              }
              detail={
                selected && websiteId ? (
                  <WorkflowDetail
                    key={selected.id}
                    websiteId={websiteId}
                    workflow={selected}
                    canEdit={canEdit}
                    toggling={toggleMutation.isPending}
                    error={(toggleMutation.error ?? deleteMutation.error) as Error | null}
                    revealed={revealed?.workflowId === selected.id ? revealed.secret : null}
                    onRevealed={(secret) => setRevealed({ workflowId: selected.id, secret })}
                    onEdit={() => {
                      saveMutation.reset();
                      setEditor({ workflow: selected });
                    }}
                    onToggle={() => toggleMutation.mutate(selected)}
                    onDelete={() =>
                      confirm({
                        title: deleteTitle(selected.name),
                        description: t('workflowDeleteBody'),
                        onConfirm: () => deleteMutation.mutate(selected.id),
                      })
                    }
                  />
                ) : (
                  <div className="master-detail-pane">
                    <EmptyState icon={<WorkflowIcon strokeWidth={2} />} title={t('productSelectWorkflow')} />
                  </div>
                )
              }
            />
          ) : (
            <EmptyState
              variant="rich"
              icon={<WorkflowIcon strokeWidth={2} />}
              title={t('workflowsEmptyTitle')}
              description={t('workflowsEmptyBody')}
              action={createButton}
            />
          )}
        </DataViewState>

        <ProductNote className="product-footnote">{t('workflowLimitsNote')}</ProductNote>

        {canEdit && editor ? (
          <WorkflowEditorDialog
            websiteId={websiteId}
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
