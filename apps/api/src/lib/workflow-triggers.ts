import {
  capWorkflowEventProperties,
  matchWorkflowConditions,
  parseStoredWorkflowFilters,
  parseStoredWorkflowSteps,
  uuid,
  workflowConditionContext,
  workflowConditionsNeedPerson,
  type WorkflowTriggerMessage,
} from '@flareboard/shared';
import type { Env } from '../env';
import { getWebsiteById } from './queries';
import { checkIpRateLimit } from './rate-limit';
import {
  WORKFLOW_EXECUTIONS_PER_HOUR,
  loadPersonProperties,
  type WorkflowExecutionStatus,
  type WorkflowRunParams,
} from './workflow-runtime';

const MAX_WORKFLOWS_PER_EVENT = 20;

function isTriggerMessage(body: unknown): body is WorkflowTriggerMessage {
  if (!body || typeof body !== 'object') return false;
  const message = body as Partial<WorkflowTriggerMessage>;
  return (
    message.type === 'workflow_trigger' &&
    typeof message.websiteId === 'string' &&
    Array.isArray(message.workflowIds) &&
    Boolean(message.event && typeof message.event.id === 'string' && typeof message.event.name === 'string')
  );
}

async function instanceExists(binding: Workflow<WorkflowRunParams>, id: string) {
  try {
    await binding.get(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start executions for one triggering event: re-check each workflow (still enabled, same
 * trigger, filters including person properties), record the execution, and hand flows with
 * steps to the durable WorkflowRunner. Idempotent per (event, workflow): a redelivered queue
 * message finds the same execution id and does not start a second run.
 */
export async function startWorkflowExecutions(env: Env, message: WorkflowTriggerMessage): Promise<number> {
  const workflowIds = [...new Set(message.workflowIds.filter((id) => typeof id === 'string'))].slice(
    0,
    MAX_WORKFLOWS_PER_EVENT,
  );
  if (!workflowIds.length) return 0;

  const website = await getWebsiteById(env, message.websiteId);
  if (!website) return 0;

  const placeholders = workflowIds.map((_, index) => `?${index + 3}`).join(', ');
  const rows = await env.DB.prepare(
    `SELECT workflow_id as workflowId, name, trigger_filters as triggerFilters, steps
     FROM workflow
     WHERE website_id = ?1 AND trigger_event = ?2 AND enabled = 1 AND workflow_id IN (${placeholders})`,
  )
    .bind(message.websiteId, message.event.name, ...workflowIds)
    .all<{ workflowId: string; name: string; triggerFilters: string | null; steps: string | null }>();

  const event = { ...message.event, properties: capWorkflowEventProperties(message.event.properties) };
  let person: Record<string, unknown> | null = null;
  let started = 0;

  for (const row of rows.results ?? []) {
    const filters = parseStoredWorkflowFilters(row.triggerFilters);
    if (!filters) {
      console.error(JSON.stringify({ event: 'workflow_filters_unreadable', workflowId: row.workflowId }));
      continue;
    }
    if (workflowConditionsNeedPerson(filters) && person === null) {
      person = await loadPersonProperties(env, message.websiteId, event.distinctId);
    }
    if (!matchWorkflowConditions(filters, workflowConditionContext(event, person))) continue;

    const cap = await checkIpRateLimit(env, 'workflow-execution', message.websiteId, WORKFLOW_EXECUTIONS_PER_HOUR, 3600);
    if (!cap.allowed) {
      console.warn(JSON.stringify({ event: 'workflow_execution_throttled', websiteId: message.websiteId }));
      return started;
    }

    const steps = parseStoredWorkflowSteps(row.steps);
    const executionId = uuid('workflow-execution', event.id, row.workflowId);
    const now = Date.now();
    const status: WorkflowExecutionStatus = !steps ? 'failed' : steps.length ? 'queued' : 'recorded';
    const error = steps ? null : 'Stored workflow steps are unreadable; edit and save the workflow';
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO workflow_execution
         (execution_id, workflow_id, website_id, session_id, visit_id, event_id, event_name, distinct_id,
          status, error, attempts, current_step, created_at, updated_at, completed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, NULL, ?11, ?12, ?13)`,
    )
      .bind(
        executionId,
        row.workflowId,
        message.websiteId,
        event.sessionId,
        event.visitId,
        event.id,
        event.name,
        event.distinctId,
        status,
        error,
        event.createdAt,
        now,
        status === 'queued' ? null : now,
      )
      .run();
    const fresh = Boolean(inserted.meta?.changes);
    started += fresh ? 1 : 0;
    if (!steps?.length) continue;
    // Redelivered message: only start the run if the first delivery did not get that far.
    if (!fresh && env.WORKFLOW_RUNNER && (await instanceExists(env.WORKFLOW_RUNNER, executionId))) continue;

    if (!env.WORKFLOW_RUNNER) {
      await env.DB.prepare(
        `UPDATE workflow_execution SET status = 'failed', error = ?2, completed_at = ?3, updated_at = ?3
         WHERE execution_id = ?1 AND status = 'queued'`,
      )
        .bind(executionId, 'Workflow runner binding (WORKFLOW_RUNNER) is not configured', now)
        .run();
      continue;
    }

    const params: WorkflowRunParams = {
      executionId,
      websiteId: message.websiteId,
      workflowId: row.workflowId,
      workflowName: row.name,
      website: { id: website.websiteId, name: website.name, domain: website.domain ?? null },
      steps,
      event,
    };
    try {
      await env.WORKFLOW_RUNNER.create({ id: executionId, params });
    } catch (createError) {
      // Created concurrently by another delivery of the same message.
      if (await instanceExists(env.WORKFLOW_RUNNER, executionId)) continue;
      throw createError;
    }
  }
  return started;
}

/** Queue consumer for `flareboard-workflow-triggers` (producer: ingest). */
export async function handleWorkflowTriggerBatch(batch: MessageBatch<unknown>, env: Env) {
  for (const message of batch.messages) {
    if (!isTriggerMessage(message.body)) {
      console.error(JSON.stringify({ event: 'workflow_trigger_invalid', id: message.id }));
      message.ack();
      continue;
    }
    try {
      await startWorkflowExecutions(env, message.body);
      message.ack();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'workflow_trigger_failed',
          websiteId: message.body.websiteId,
          attempts: message.attempts,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      message.retry({ delaySeconds: Math.min(300, 15 * 2 ** Math.max(0, message.attempts - 1)) });
    }
  }
}
