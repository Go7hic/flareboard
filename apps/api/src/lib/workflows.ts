import type { Env } from '../env';

export type WorkflowExecutionFilters = {
  status?: string;
  event?: string;
  search?: string;
};

function buildExecutionFilterClause(filters: WorkflowExecutionFilters = {}) {
  const clauses = ['website_id = ?1', 'workflow_id = ?2'];
  const bindings: unknown[] = [];

  if (filters.status) {
    bindings.push(filters.status);
    clauses.push(`status = ?${bindings.length + 2}`);
  }
  if (filters.event) {
    bindings.push(filters.event);
    clauses.push(`event_name = ?${bindings.length + 2}`);
  }
  if (filters.search) {
    bindings.push(`%${filters.search}%`);
    const index = bindings.length + 2;
    clauses.push(
      `(COALESCE(event_name, '') LIKE ?${index} OR COALESCE(session_id, '') LIKE ?${index} OR COALESCE(error, '') LIKE ?${index})`,
    );
  }

  return {
    where: clauses.join(' AND '),
    bindings,
  };
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
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failures,
       SUM(CASE WHEN status IN ('success', 'recorded', 'queued') THEN 1 ELSE 0 END) as successes
     FROM workflow_execution
     WHERE ${filter.where}`,
  )
    .bind(websiteId, workflowId, ...filter.bindings)
    .first<{ executions: number; lastExecutionAt: number | null; failures: number; successes: number }>();

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
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failures,
            SUM(CASE WHEN status IN ('success', 'recorded', 'queued') THEN 1 ELSE 0 END) as successes
     FROM workflow_execution
     WHERE ${filter.where}
     GROUP BY date(created_at / 1000, 'unixepoch')
     ORDER BY date ASC
     LIMIT 90`,
  )
    .bind(websiteId, workflowId, ...filter.bindings)
    .all<{ date: string; executions: number; failures: number; successes: number }>();

  const executions = row?.executions ?? 0;
  const successes = row?.successes ?? 0;

  return {
    executions,
    lastExecutionAt: row?.lastExecutionAt ?? null,
    failures: row?.failures ?? 0,
    successes,
    successRate: executions ? Math.round((successes / executions) * 10000) / 100 : 0,
    statuses: (statusRows.results ?? []).map((item) => ({
      status: item.status,
      executions: item.executions,
      percentage: executions ? Math.round((item.executions / executions) * 10000) / 100 : 0,
    })),
    events: eventRows.results ?? [],
    trend: (trendRows.results ?? []).map((item) => ({
      ...item,
      successRate: item.executions ? Math.round((item.successes / item.executions) * 10000) / 100 : 0,
    })),
  };
}

export async function getWorkflowExecutions(
  env: Env,
  websiteId: string,
  workflowId: string,
  limit = 100,
  filters: WorkflowExecutionFilters = {},
) {
  const filter = buildExecutionFilterClause(filters);
  const rows = await env.DB.prepare(
    `SELECT execution_id as id,
            workflow_id as workflowId,
            session_id as sessionId,
            visit_id as visitId,
            event_id as eventId,
            event_name as eventName,
            status,
            error,
            created_at as createdAt
     FROM workflow_execution
     WHERE ${filter.where}
     ORDER BY created_at DESC
     LIMIT ?${filter.bindings.length + 3}`,
  )
    .bind(websiteId, workflowId, ...filter.bindings, Math.min(Math.max(limit, 1), 500))
    .all<{
      id: string;
      workflowId: string;
      sessionId: string | null;
      visitId: string | null;
      eventId: string | null;
      eventName: string | null;
      status: string;
      error: string | null;
      createdAt: number;
    }>();

  return rows.results ?? [];
}
