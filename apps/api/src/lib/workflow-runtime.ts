import {
  WORKFLOW_MAX_ATTEMPTS,
  WorkflowTemplateError,
  buildWorkflowTemplateContext,
  matchWorkflowConditions,
  renderWorkflowAction,
  workflowConditionContext,
  workflowConditionsNeedPerson,
  workflowRetryDelayMs,
  type WorkflowActionStep,
  type WorkflowConditionStep,
  type WorkflowEventSnapshot,
  type WorkflowStep,
} from '@flareboard/shared';
import type { Env } from '../env';
import { getStoredPerson } from './people';
import { checkIpRateLimit } from './rate-limit';
import { deliverWorkflowAction } from './workflow-delivery';

/**
 * Per-website caps. Ingest separately limits triggers per client IP (30/min overall and
 * 10/hour per website), so one visitor cannot fan out executions.
 */
/** First delivery attempts of webhook / email / Slack steps. Retries do not count. */
export const WORKFLOW_DELIVERIES_PER_HOUR = 60;
/** Executions started (recorded-only ones included). Excess triggers are dropped. */
export const WORKFLOW_EXECUTIONS_PER_HOUR = 1_000;
/** Dashboard "send test" deliveries. */
export const WORKFLOW_TEST_SENDS_PER_HOUR = 30;
/** Executions and their attempt logs are purged after this many days. */
export const WORKFLOW_LOG_RETENTION_DAYS = 90;

export type WorkflowExecutionStatus =
  | 'recorded'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'retrying'
  | 'success'
  | 'failed'
  | 'stopped'
  | 'throttled'
  | 'cancelled';

export const WORKFLOW_EXECUTION_STATUSES: WorkflowExecutionStatus[] = [
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
];

/** Status of one attempt row. */
export type WorkflowAttemptStatus =
  | 'success'
  | 'failed'
  | 'retrying'
  | 'throttled'
  | 'passed'
  | 'stopped'
  | 'waiting';

/** Params of one WorkflowRunner instance: a snapshot of the flow taken when it was triggered. */
export type WorkflowRunParams = {
  executionId: string;
  websiteId: string;
  workflowId: string;
  workflowName: string;
  website: { id: string; name: string; domain: string | null };
  steps: WorkflowStep[];
  event: WorkflowEventSnapshot;
};

type ExecutionPatch = {
  status?: WorkflowExecutionStatus;
  error?: string | null;
  currentStep?: number | null;
  responseCode?: number | null;
  nextRetryAt?: number | null;
  completedAt?: number | null;
  /** Adds one to `attempts`. */
  countAttempt?: boolean;
};

const PATCH_COLUMNS: Array<[keyof ExecutionPatch, string]> = [
  ['status', 'status'],
  ['error', 'error'],
  ['currentStep', 'current_step'],
  ['responseCode', 'response_code'],
  ['nextRetryAt', 'next_retry_at'],
  ['completedAt', 'completed_at'],
];

export async function updateExecution(env: Env, executionId: string, patch: ExecutionPatch, now = Date.now()) {
  const sets = ['updated_at = ?2'];
  const bindings: unknown[] = [executionId, now];
  for (const [key, column] of PATCH_COLUMNS) {
    if (patch[key] === undefined) continue;
    bindings.push(patch[key]);
    sets.push(`${column} = ?${bindings.length}`);
  }
  if (patch.countAttempt) sets.push('attempts = attempts + 1');
  await env.DB.prepare(`UPDATE workflow_execution SET ${sets.join(', ')} WHERE execution_id = ?1`)
    .bind(...bindings)
    .run();
}

export type AttemptRow = {
  executionId: string;
  workflowId: string;
  websiteId: string;
  stepIndex: number;
  stepType: string;
  attempt: number;
  status: WorkflowAttemptStatus;
  responseCode?: number | null;
  error?: string | null;
  responseBody?: string | null;
  durationMs?: number | null;
  nextRetryAt?: number | null;
};

/** Idempotent per (execution, step, attempt): a replayed workflow step rewrites the same row. */
export async function recordAttempt(env: Env, row: AttemptRow, now = Date.now()) {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO workflow_execution_attempt
       (attempt_id, execution_id, workflow_id, website_id, step_index, step_type, attempt, status,
        response_code, error, response_body, duration_ms, next_retry_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  )
    .bind(
      `${row.executionId}:${row.stepIndex}:${row.attempt}`,
      row.executionId,
      row.workflowId,
      row.websiteId,
      row.stepIndex,
      row.stepType,
      row.attempt,
      row.status,
      row.responseCode ?? null,
      row.error ?? null,
      row.responseBody ?? null,
      row.durationMs ?? null,
      row.nextRetryAt ?? null,
      now,
    )
    .run();
}

/** Whether the workflow still exists and is enabled, plus its current signing secret. */
export async function loadWorkflowLiveState(env: Env, websiteId: string, workflowId: string) {
  const row = await env.DB.prepare(
    `SELECT enabled, signing_secret as signingSecret
     FROM workflow
     WHERE workflow_id = ?1 AND website_id = ?2
     LIMIT 1`,
  )
    .bind(workflowId, websiteId)
    .first<{ enabled: number; signingSecret: string | null }>();
  return { active: Boolean(row?.enabled), signingSecret: row?.signingSecret ?? null };
}

export async function loadPersonProperties(
  env: Env,
  websiteId: string,
  distinctId: string | null | undefined,
): Promise<Record<string, unknown>> {
  if (!distinctId) return {};
  const person = await getStoredPerson(env, websiteId, distinctId);
  return (person?.properties as Record<string, unknown> | undefined) ?? {};
}

export async function markExecutionFinished(
  env: Env,
  executionId: string,
  status: Extract<WorkflowExecutionStatus, 'success' | 'failed' | 'stopped' | 'throttled' | 'cancelled'>,
  error: string | null = null,
) {
  const now = Date.now();
  await updateExecution(env, executionId, { status, error, nextRetryAt: null, completedAt: now }, now);
}

/** Record the start of a delay step; returns when the flow resumes. */
export async function markWaiting(env: Env, params: WorkflowRunParams, stepIndex: number, delayMs: number) {
  const now = Date.now();
  const resumeAt = now + delayMs;
  await recordAttempt(
    env,
    {
      executionId: params.executionId,
      workflowId: params.workflowId,
      websiteId: params.websiteId,
      stepIndex,
      stepType: 'delay',
      attempt: 1,
      status: 'waiting',
      nextRetryAt: resumeAt,
    },
    now,
  );
  await updateExecution(env, params.executionId, { status: 'waiting', currentStep: stepIndex, nextRetryAt: resumeAt }, now);
  return resumeAt;
}

/**
 * Evaluate a condition step against the triggering event and the person's properties as they
 * are now (a delay may have passed since the trigger). Records the outcome.
 */
export async function runConditionStep(
  env: Env,
  params: WorkflowRunParams,
  stepIndex: number,
  step: WorkflowConditionStep,
): Promise<boolean> {
  const person = workflowConditionsNeedPerson(step.conditions)
    ? await loadPersonProperties(env, params.websiteId, params.event.distinctId)
    : {};
  const passed = matchWorkflowConditions(step.conditions, workflowConditionContext(params.event, person));
  await recordAttempt(env, {
    executionId: params.executionId,
    workflowId: params.workflowId,
    websiteId: params.websiteId,
    stepIndex,
    stepType: 'condition',
    attempt: 1,
    status: passed ? 'passed' : 'stopped',
    error: passed ? null : 'Condition not met',
  });
  if (passed) {
    await updateExecution(env, params.executionId, { status: 'running', currentStep: stepIndex, nextRetryAt: null });
  }
  return passed;
}

export type ActionAttemptResult =
  | { outcome: 'success' }
  | { outcome: 'retry'; delayMs: number }
  | { outcome: 'failed'; error: string }
  | { outcome: 'throttled'; error: string };

/**
 * One delivery attempt of an action step: cap check (first attempt only), render with fresh
 * person properties, deliver, and record the attempt plus the execution's latest state.
 * The caller sleeps `delayMs` on `retry` and ends the execution on `failed` / `throttled`
 * (this function has already recorded that final state).
 */
export async function runActionAttempt(
  env: Env,
  params: WorkflowRunParams,
  stepIndex: number,
  step: WorkflowActionStep,
  attempt: number,
): Promise<ActionAttemptResult> {
  const base = {
    executionId: params.executionId,
    workflowId: params.workflowId,
    websiteId: params.websiteId,
    stepIndex,
    stepType: step.type,
    attempt,
  };

  if (attempt === 1) {
    // Public events can trigger customer-configured destinations, so outbound deliveries are
    // capped per website. Retries of an admitted delivery are not counted again.
    const cap = await checkIpRateLimit(env, 'workflow-delivery', params.websiteId, WORKFLOW_DELIVERIES_PER_HOUR, 3600);
    if (!cap.allowed) {
      const error = `Delivery throttled: website exceeded ${WORKFLOW_DELIVERIES_PER_HOUR} workflow deliveries per hour`;
      await recordAttempt(env, { ...base, status: 'throttled', error });
      await markExecutionFinished(env, params.executionId, 'throttled', error);
      return { outcome: 'throttled', error };
    }
  }

  const person = await loadPersonProperties(env, params.websiteId, params.event.distinctId);
  const context = buildWorkflowTemplateContext({
    event: params.event,
    personProperties: person,
    website: params.website,
    workflow: { id: params.workflowId, name: params.workflowName },
    executionId: params.executionId,
  });

  let rendered;
  try {
    rendered = renderWorkflowAction(step, context);
  } catch (error) {
    const message = error instanceof WorkflowTemplateError ? error.message : 'Template rendering failed';
    await recordAttempt(env, { ...base, status: 'failed', error: message });
    await updateExecution(env, params.executionId, { currentStep: stepIndex, countAttempt: true });
    await markExecutionFinished(env, params.executionId, 'failed', message);
    return { outcome: 'failed', error: message };
  }

  // Read the secret at delivery time so a rotation applies to pending retries too.
  const signingSecret =
    step.type === 'webhook' ? (await loadWorkflowLiveState(env, params.websiteId, params.workflowId)).signingSecret : null;
  const { outcome } = await deliverWorkflowAction(env, rendered, {
    deliveryId: `${params.executionId}:${stepIndex}`,
    executionId: params.executionId,
    attempt,
    eventName: params.event.name,
    signingSecret,
  });

  const now = Date.now();
  if (outcome.ok) {
    await recordAttempt(env, { ...base, status: 'success', responseCode: outcome.statusCode, responseBody: outcome.responseBody, durationMs: outcome.durationMs }, now);
    await updateExecution(
      env,
      params.executionId,
      { status: 'running', currentStep: stepIndex, responseCode: outcome.statusCode, error: null, nextRetryAt: null, countAttempt: true },
      now,
    );
    return { outcome: 'success' };
  }

  const canRetry = outcome.retryable && attempt < WORKFLOW_MAX_ATTEMPTS;
  const delayMs = canRetry ? workflowRetryDelayMs(attempt) : 0;
  const error = outcome.error ?? 'Delivery failed';
  const executionError = !canRetry && outcome.retryable ? `${error} (gave up after ${attempt} attempts)` : error;
  await recordAttempt(
    env,
    {
      ...base,
      status: canRetry ? 'retrying' : 'failed',
      responseCode: outcome.statusCode,
      error,
      responseBody: outcome.responseBody,
      durationMs: outcome.durationMs,
      nextRetryAt: canRetry ? now + delayMs : null,
    },
    now,
  );
  await updateExecution(
    env,
    params.executionId,
    {
      status: canRetry ? 'retrying' : 'failed',
      currentStep: stepIndex,
      responseCode: outcome.statusCode,
      error: executionError,
      nextRetryAt: canRetry ? now + delayMs : null,
      completedAt: canRetry ? null : now,
      countAttempt: true,
    },
    now,
  );
  return canRetry ? { outcome: 'retry', delayMs } : { outcome: 'failed', error: executionError };
}
