import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { getWorkflowExecutions, getWorkflowSummary } from '../../src/lib/workflows';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 9, 12);

async function insertWorkflowExecution(
  id: string,
  workflowId: string,
  eventName: string,
  status: string,
  createdAt: number,
  error?: string | null,
) {
  await env.DB.prepare(
    `INSERT INTO workflow_execution
       (execution_id, workflow_id, website_id, session_id, visit_id, event_id, event_name, status, error, created_at)
     VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      id,
      workflowId,
      TEST_WEBSITE_ID,
      `${id}-session`,
      `${id}-event`,
      eventName,
      status,
      error ?? (status === 'failed' ? 'Webhook failed' : null),
      createdAt,
    )
    .run();
}

describe('workflow query helpers', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('summarizes executions by status and event', async () => {
    await env.DB.prepare(
      `INSERT INTO workflow (workflow_id, website_id, name, trigger_event, enabled, action_type, created_at, updated_at)
       VALUES ('workflow-summary', ?1, 'Notify sales', 'checkout_completed', 1, 'record', ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await insertWorkflowExecution(
      'workflow-exec-1',
      'workflow-summary',
      'checkout_completed',
      'success',
      BASE + 1000,
    );
    await insertWorkflowExecution(
      'workflow-exec-2',
      'workflow-summary',
      'checkout_completed',
      'success',
      BASE + 2000,
    );
    await insertWorkflowExecution(
      'workflow-exec-3',
      'workflow-summary',
      'signup',
      'failed',
      BASE + 3000,
    );

    const [summary, executions] = await Promise.all([
      getWorkflowSummary(env, TEST_WEBSITE_ID, 'workflow-summary'),
      getWorkflowExecutions(env, TEST_WEBSITE_ID, 'workflow-summary'),
    ]);

    expect(summary).toEqual({
      executions: 3,
      lastExecutionAt: BASE + 3000,
      failures: 1,
      successes: 2,
      successRate: 66.67,
      statuses: [
        { status: 'success', executions: 2, percentage: 66.67 },
        { status: 'failed', executions: 1, percentage: 33.33 },
      ],
      events: [
        { eventName: 'checkout_completed', executions: 2, lastExecutionAt: BASE + 2000 },
        { eventName: 'signup', executions: 1, lastExecutionAt: BASE + 3000 },
      ],
      trend: [
        {
          date: '2026-01-09',
          executions: 3,
          failures: 1,
          successes: 2,
          successRate: 66.67,
        },
      ],
    });
    expect(executions.map((execution) => execution.id)).toEqual([
      'workflow-exec-3',
      'workflow-exec-2',
      'workflow-exec-1',
    ]);
  });

  it('filters workflow summaries and executions', async () => {
    await env.DB.prepare(
      `INSERT INTO workflow (workflow_id, website_id, name, trigger_event, enabled, action_type, created_at, updated_at)
       VALUES ('workflow-filtered', ?1, 'Route leads', 'signup', 1, 'record', ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await insertWorkflowExecution(
      'workflow-filter-1',
      'workflow-filtered',
      'signup',
      'recorded',
      BASE + 1000,
    );
    await insertWorkflowExecution(
      'workflow-filter-2',
      'workflow-filtered',
      'checkout_completed',
      'failed',
      BASE + 2000,
      'Webhook failed for session workflow-filter-2-session',
    );
    await insertWorkflowExecution(
      'workflow-filter-3',
      'workflow-filtered',
      'signup',
      'recorded',
      BASE + 3000,
    );

    const [summary, executions] = await Promise.all([
      getWorkflowSummary(env, TEST_WEBSITE_ID, 'workflow-filtered', {
        status: 'recorded',
        event: 'signup',
      }),
      getWorkflowExecutions(env, TEST_WEBSITE_ID, 'workflow-filtered', 100, {
        status: 'recorded',
        event: 'signup',
      }),
    ]);

    expect(summary.executions).toBe(2);
    expect(summary.successes).toBe(2);
    expect(summary.failures).toBe(0);
    expect(summary.events).toEqual([
      { eventName: 'signup', executions: 2, lastExecutionAt: BASE + 3000 },
    ]);
    expect(summary.trend).toEqual([
      {
        date: '2026-01-09',
        executions: 2,
        failures: 0,
        successes: 2,
        successRate: 100,
      },
    ]);
    expect(executions.map((execution) => execution.id)).toEqual([
      'workflow-filter-3',
      'workflow-filter-1',
    ]);

    const searchExecutions = await getWorkflowExecutions(
      env,
      TEST_WEBSITE_ID,
      'workflow-filtered',
      100,
      { search: 'Webhook failed' },
    );
    expect(searchExecutions.map((execution) => execution.id)).toEqual(['workflow-filter-2']);
  });

  it('counts queued workflow actions as successful executions', async () => {
    await env.DB.prepare(
      `INSERT INTO workflow (workflow_id, website_id, name, trigger_event, enabled, action_type, action_config, created_at, updated_at)
       VALUES ('workflow-actions', ?1, 'Route action', 'signup', 1, 'webhook', ?2, ?3, ?3)`,
    )
      .bind(TEST_WEBSITE_ID, JSON.stringify({ url: 'https://example.com/webhook' }), BASE)
      .run();
    await insertWorkflowExecution(
      'workflow-action-queued',
      'workflow-actions',
      'signup',
      'queued',
      BASE + 1000,
      null,
    );
    await insertWorkflowExecution(
      'workflow-action-failed',
      'workflow-actions',
      'signup',
      'failed',
      BASE + 2000,
      'Missing webhook URL',
    );

    const [summary, executions] = await Promise.all([
      getWorkflowSummary(env, TEST_WEBSITE_ID, 'workflow-actions'),
      getWorkflowExecutions(env, TEST_WEBSITE_ID, 'workflow-actions'),
    ]);

    expect(summary).toMatchObject({
      executions: 2,
      successes: 1,
      failures: 1,
      successRate: 50,
      statuses: [
        { status: 'failed', executions: 1, percentage: 50 },
        { status: 'queued', executions: 1, percentage: 50 },
      ],
    });
    expect(executions[0]).toMatchObject({
      id: 'workflow-action-failed',
      status: 'failed',
      error: 'Missing webhook URL',
    });
  });
});
