import type { Env } from '../env';
import { WORKFLOW_LOG_RETENTION_DAYS } from './workflow-runtime';

export type WorkflowExecutionFilters = {
  status?: string;
  event?: string;
  search?: string;
  /** Inclusive lower bound on created_at (epoch ms). */
  from?: number;
  /** Exclusive upper bound on created_at (epoch ms). */
  to?: number;
};

const SUCCESS_STATUSES = `('success', 'recorded')`;
const FAILURE_STATUSES = `('failed', 'throttled')`;
const IN_PROGRESS_STATUSES = `('queued', 'running', 'waiting', 'retrying')`;

function buildExecutionFilterClause(filters: WorkflowExecutionFilters = {}) {
  const clauses = ['website_id = ?1', 'workflow_id = ?2'];
  const bindings: unknown[] = [];
  const bind = (value: unknown) => {
    bindings.push(value);
    return `?${bindings.length + 2}`;
  };

  if (filters.status) clauses.push(`status = ${bind(filters.status)}`);
  if (filters.event) clauses.push(`event_name = ${bind(filters.event)}`);
  if (filters.search) {
    const index = bind(`%${filters.search}%`);
    clauses.push(
      `(COALESCE(event_name, '') LIKE ${index} OR COALESCE(session_id, '') LIKE ${index} OR COALESCE(distinct_id, '') LIKE ${index} OR COALESCE(error, '') LIKE ${index} OR execution_id LIKE ${index})`,
    );
  }
  if (filters.from != null && Number.isFinite(filters.from)) clauses.push(`created_at >= ${bind(filters.from)}`);
  if (filters.to != null && Number.isFinite(filters.to)) clauses.push(`created_at < ${bind(filters.to)}`);

  return {
    where: clauses.join(' AND '),
    bindings,
  };
}

function rate(successes: number, finished: number) {
  return finished > 0 ? Math.round((successes / finished) * 10000) / 100 : 0;
}

export async function getWorkflowSummary(
  env: Env,
  websiteId: string,
  workflowId: string,
  filters: WorkflowExecutionFilters = {},
) {
  const filter = buildExecutionFilterClause(filters);
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) as executions,
       MAX(created_at) as lastExecutionAt,
       SUM(CASE WHEN status IN ${FAILURE_STATUSES} THEN 1 ELSE 0 END) as failures,
       SUM(CASE WHEN status IN ${SUCCESS_STATUSES} THEN 1 ELSE 0 END) as successes,
       SUM(CASE WHEN status IN ${IN_PROGRESS_STATUSES} THEN 1 ELSE 0 END) as inProgress
     FROM workflow_execution
     WHERE ${filter.where}`,
  )
    .bind(websiteId, workflowId, ...filter.bindings)
    .first<{
      executions: number;
      lastExecutionAt: number | null;
      failures: number | null;
      successes: number | null;
      inProgress: number | null;
    }>();

  const statusRows = await env.DB.prepare(
    `SELECT status,
            COUNT(*) as executions
     FROM workflow_execution
     WHERE ${filter.where}
     GROUP BY status
     ORDER BY executions DESC, status ASC`,
  )
    .bind(websiteId, workflowId, ...filter.bindings)
    .all<{ status: string; executions: number }>();

  const eventRows = await env.DB.prepare(
    `SELECT COALESCE(event_name, 'unknown') as eventName,
            COUNT(*) as executions,
            MAX(created_at) as lastExecutionAt
     FROM workflow_execution
     WHERE ${filter.where}
     GROUP BY COALESCE(event_name, 'unknown')
     ORDER BY executions DESC, eventName ASC
     LIMIT 10`,
  )
    .bind(websiteId, workflowId, ...filter.bindings)
    .all<{ eventName: string; executions: number; lastExecutionAt: number | null }>();

  const trendRows = await env.DB.prepare(
    `SELECT date(created_at / 1000, 'unixepoch') as date,
            COUNT(*) as executions,
            SUM(CASE WHEN status IN ${FAILURE_STATUSES} THEN 1 ELSE 0 END) as failures,
            SUM(CASE WHEN status IN ${SUCCESS_STATUSES} THEN 1 ELSE 0 END) as successes,
            SUM(CASE WHEN status IN ${IN_PROGRESS_STATUSES} THEN 1 ELSE 0 END) as inProgress
     FROM workflow_execution
     WHERE ${filter.where}
     GROUP BY date(created_at / 1000, 'unixepoch')
     ORDER BY date ASC
     LIMIT 90`,
  )
    .bind(websiteId, workflowId, ...filter.bindings)
    .all<{ date: string; executions: number; failures: number; successes: number; inProgress: number }>();

  const executions = row?.executions ?? 0;
  const successes = row?.successes ?? 0;
  const inProgress = row?.inProgress ?? 0;

  return {
    executions,
    lastExecutionAt: row?.lastExecutionAt ?? null,
    failures: row?.failures ?? 0,
    successes,
    inProgress,
    /** Share of finished executions (in-flight ones excluded) that succeeded. */
    successRate: rate(successes, executions - inProgress),
    statuses: (statusRows.results ?? []).map((item) => ({
      status: item.status,
      executions: item.executions,
      percentage: executions ? Math.round((item.executions / executions) * 10000) / 100 : 0,
    })),
    events: eventRows.results ?? [],
    trend: (trendRows.results ?? []).map(({ inProgress: dayInProgress, ...item }) => ({
      ...item,
      successRate: rate(item.successes, item.executions - dayInProgress),
    })),
  };
}

export type WorkflowExecutionRow = {
  id: string;
  workflowId: string;
  sessionId: string | null;
  visitId: string | null;
  eventId: string | null;
  eventName: string | null;
  distinctId: string | null;
  status: string;
  error: string | null;
  currentStep: number | null;
  attempts: number;
  responseCode: number | null;
  nextRetryAt: number | null;
  createdAt: number;
  updatedAt: number | null;
  completedAt: number | null;
};

const EXECUTION_COLUMNS = `execution_id as id,
            workflow_id as workflowId,
            session_id as sessionId,
            visit_id as visitId,
            event_id as eventId,
            event_name as eventName,
            distinct_id as distinctId,
            status,
            error,
            current_step as currentStep,
            attempts,
            response_code as responseCode,
            next_retry_at as nextRetryAt,
            created_at as createdAt,
            updated_at as updatedAt,
            completed_at as completedAt`;

export async function getWorkflowExecutions(
  env: Env,
  websiteId: string,
  workflowId: string,
  limit = 100,
  filters: WorkflowExecutionFilters = {},
) {
  const filter = buildExecutionFilterClause(filters);
  const rows = await env.DB.prepare(
    `SELECT ${EXECUTION_COLUMNS}
     FROM workflow_execution
     WHERE ${filter.where}
     ORDER BY created_at DESC
     LIMIT ?${filter.bindings.length + 3}`,
  )
    .bind(websiteId, workflowId, ...filter.bindings, Math.min(Math.max(limit, 1), 500))
    .all<WorkflowExecutionRow>();

  return rows.results ?? [];
}

export type WorkflowAttemptRow = {
  id: string;
  stepIndex: number;
  stepType: string;
  attempt: number;
  status: string;
  responseCode: number | null;
  error: string | null;
  responseBody: string | null;
  durationMs: number | null;
  nextRetryAt: number | null;
  createdAt: number;
};

/** One execution with every recorded step outcome and delivery attempt, oldest first. */
export async function getWorkflowExecutionDetail(
  env: Env,
  websiteId: string,
  workflowId: string,
  executionId: string,
) {
  const execution = await env.DB.prepare(
    `SELECT ${EXECUTION_COLUMNS}
     FROM workflow_execution
     WHERE website_id = ?1 AND workflow_id = ?2 AND execution_id = ?3
     LIMIT 1`,
  )
    .bind(websiteId, workflowId, executionId)
    .first<WorkflowExecutionRow>();
  if (!execution) return null;

  const attempts = await env.DB.prepare(
    `SELECT attempt_id as id,
            step_index as stepIndex,
            step_type as stepType,
            attempt,
            status,
            response_code as responseCode,
            error,
            response_body as responseBody,
            duration_ms as durationMs,
            next_retry_at as nextRetryAt,
            created_at as createdAt
     FROM workflow_execution_attempt
     WHERE execution_id = ?1
     ORDER BY step_index ASC, attempt ASC
     LIMIT 200`,
  )
    .bind(executionId)
    .all<WorkflowAttemptRow>();

  return { execution, attempts: attempts.results ?? [] };
}

/** Delete a workflow with its executions and attempt logs (D1 enforces the foreign keys). */
export async function deleteWorkflowCascade(env: Env, workflowId: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM workflow_execution_attempt WHERE workflow_id = ?1').bind(workflowId),
    env.DB.prepare('DELETE FROM workflow_execution WHERE workflow_id = ?1').bind(workflowId),
    env.DB.prepare('DELETE FROM workflow WHERE workflow_id = ?1').bind(workflowId),
  ]);
}

const PURGE_BATCH = 500;
const PURGE_ROUNDS = 10;

/**
 * Hourly cron: drop executions (and their attempt logs, which hold truncated destination
 * responses) older than WORKFLOW_LOG_RETENTION_DAYS. The longest flow (20 delays of 7 days is
 * refused by the step limits long before) finishes well inside that window.
 */
export async function purgeWorkflowLogs(env: Env, now = Date.now()) {
  const cutoff = now - WORKFLOW_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (let round = 0; round < PURGE_ROUNDS; round++) {
    const ids = await env.DB.prepare(
      `SELECT execution_id as id FROM workflow_execution WHERE created_at < ?1 ORDER BY created_at LIMIT ${PURGE_BATCH}`,
    )
      .bind(cutoff)
      .all<{ id: string }>();
    const batch = (ids.results ?? []).map((item) => item.id);
    if (!batch.length) break;
    const placeholders = batch.map((_, index) => `?${index + 1}`).join(', ');
    const results = await env.DB.batch([
      env.DB.prepare(`DELETE FROM workflow_execution_attempt WHERE execution_id IN (${placeholders})`).bind(...batch),
      env.DB.prepare(`DELETE FROM workflow_execution WHERE execution_id IN (${placeholders})`).bind(...batch),
    ]);
    deleted += results[1]?.meta?.changes ?? 0;
    if (batch.length < PURGE_BATCH) break;
  }
  return deleted;
}
