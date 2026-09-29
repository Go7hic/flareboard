import { env } from 'cloudflare:workers';
import { createExecutionContext, createMessageBatch, getQueueResult, introspectWorkflow } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { uuid, type WorkflowCondition, type WorkflowStep, type WorkflowTriggerMessage } from '@flareboard/shared';
import worker from '../../src/index';
import type { Env } from '../../src/env';
import { purgeWorkflowLogs } from '../../src/lib/workflows';
import { startWorkflowExecutions } from '../../src/lib/workflow-triggers';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const appEnv = env as unknown as Env;
let counter = 0;

async function createWorkflow(input: {
  trigger?: string;
  filters?: WorkflowCondition[];
  steps?: WorkflowStep[] | string;
  enabled?: boolean;
}) {
  counter += 1;
  const workflowId = `trigger-wf-${counter}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO workflow (workflow_id, website_id, name, trigger_event, enabled, action_type, trigger_filters, steps, signing_secret, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'record', ?6, ?7, 'whsec_x', ?8, ?8)`,
  )
    .bind(
      workflowId,
      TEST_WEBSITE_ID,
      `Trigger ${counter}`,
      input.trigger ?? 'purchase',
      input.enabled === false ? 0 : 1,
      JSON.stringify(input.filters ?? []),
      typeof input.steps === 'string' ? input.steps : JSON.stringify(input.steps ?? []),
      now,
    )
    .run();
  return workflowId;
}

function message(workflowIds: string[], overrides: Partial<WorkflowTriggerMessage['event']> = {}): WorkflowTriggerMessage {
  counter += 1;
  return {
    type: 'workflow_trigger',
    websiteId: TEST_WEBSITE_ID,
    workflowIds,
    event: {
      id: `trigger-evt-${counter}`,
      name: 'purchase',
      createdAt: Date.now(),
      sessionId: 'sess-1',
      visitId: 'visit-1',
      distinctId: 'buyer-1',
      hostname: 'example.com',
      urlPath: '/checkout',
      urlQuery: null,
      properties: { amount: 120 },
      ...overrides,
    },
  };
}

async function executionsOf(workflowId: string) {
  const rows = await env.DB.prepare(
    `SELECT execution_id as id, status, error, distinct_id as distinctId, event_id as eventId
     FROM workflow_execution WHERE workflow_id = ?1`,
  )
    .bind(workflowId)
    .all<{ id: string; status: string; error: string | null; distinctId: string | null; eventId: string }>();
  return rows.results ?? [];
}

describe('workflow trigger consumer', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await testSiteDb(TEST_WEBSITE_ID)
      .prepare(
        `INSERT OR REPLACE INTO person (person_id, website_id, distinct_id, properties_json, created_at, updated_at)
         VALUES ('trigger-person', ?1, 'buyer-1', '{"plan":"pro"}', ?2, ?2)`,
      )
      .bind(TEST_WEBSITE_ID, Date.now())
      .run();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records record-only executions and evaluates event and person filters', async () => {
    const plain = await createWorkflow({});
    const bigOrders = await createWorkflow({
      filters: [{ field: 'property', key: 'amount', operator: 'greater_than', value: '100' }],
    });
    const freePlan = await createWorkflow({
      filters: [{ field: 'person', key: 'plan', operator: 'equals', value: 'free' }],
    });
    const proPlan = await createWorkflow({
      filters: [{ field: 'person', key: 'plan', operator: 'equals', value: 'PRO' }],
    });
    const disabled = await createWorkflow({ enabled: false });
    const otherTrigger = await createWorkflow({ trigger: 'signup' });

    const trigger = message([plain, bigOrders, freePlan, proPlan, disabled, otherTrigger]);
    await startWorkflowExecutions(appEnv, trigger);

    expect(await executionsOf(plain)).toEqual([
      { id: uuid('workflow-execution', trigger.event.id, plain), status: 'recorded', error: null, distinctId: 'buyer-1', eventId: trigger.event.id },
    ]);
    expect(await executionsOf(bigOrders)).toHaveLength(1);
    expect(await executionsOf(freePlan)).toHaveLength(0);
    expect(await executionsOf(proPlan)).toHaveLength(1);
    expect(await executionsOf(disabled)).toHaveLength(0);
    expect(await executionsOf(otherTrigger)).toHaveLength(0);

    await startWorkflowExecutions(appEnv, message([bigOrders], { properties: { amount: 20 } }));
    expect(await executionsOf(bigOrders)).toHaveLength(1);
  });

  it('is idempotent when a message is redelivered', async () => {
    const workflowId = await createWorkflow({});
    const trigger = message([workflowId]);
    await startWorkflowExecutions(appEnv, trigger);
    await startWorkflowExecutions(appEnv, trigger);
    expect(await executionsOf(workflowId)).toHaveLength(1);
  });

  it('starts one durable run for flows with steps', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('ok', { status: 200 }));
    const workflowId = await createWorkflow({
      steps: [{ id: 'hook', type: 'webhook', url: 'https://hooks.example.com/x', method: 'POST', headers: [], body: '' }],
    });
    await using introspector = await introspectWorkflow(appEnv.WORKFLOW_RUNNER!);
    const trigger = message([workflowId]);
    await startWorkflowExecutions(appEnv, trigger);
    // A redelivery must not fail on the existing instance or start a second one.
    await startWorkflowExecutions(appEnv, trigger);

    const instances = introspector.get();
    expect(instances).toHaveLength(1);
    await instances[0]!.waitForStatus('complete');
    expect(await executionsOf(workflowId)).toEqual([
      expect.objectContaining({ id: uuid('workflow-execution', trigger.event.id, workflowId), status: 'success' }),
    ]);
  });

  it('fails executions whose stored steps cannot be read', async () => {
    const workflowId = await createWorkflow({ steps: '{"not": "a list"}' });
    await startWorkflowExecutions(appEnv, message([workflowId]));
    expect(await executionsOf(workflowId)).toEqual([
      expect.objectContaining({ status: 'failed', error: 'Stored workflow steps are unreadable; edit and save the workflow' }),
    ]);
  });

  it('acks valid and malformed messages from the queue handler', async () => {
    const workflowId = await createWorkflow({});
    const batch = createMessageBatch('flareboard-workflow-triggers', [
      { id: 'm1', timestamp: new Date(), attempts: 1, body: message([workflowId]) },
      { id: 'm2', timestamp: new Date(), attempts: 1, body: { type: 'nonsense' } },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, appEnv);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks.sort()).toEqual(['m1', 'm2']);
    expect(result.retryMessages).toEqual([]);
    expect(await executionsOf(workflowId)).toHaveLength(1);
  });

  it('purges execution logs past the retention window', async () => {
    const workflowId = await createWorkflow({});
    const old = Date.now() - 91 * 24 * 3600_000;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO workflow_execution (execution_id, workflow_id, website_id, event_name, status, created_at)
         VALUES ('purge-old', ?1, ?2, 'purchase', 'success', ?3), ('purge-new', ?1, ?2, 'purchase', 'success', ?4),
                ('purge-old-running', ?1, ?2, 'purchase', 'waiting', ?3)`,
      ).bind(workflowId, TEST_WEBSITE_ID, old, Date.now()),
      env.DB.prepare(
        `INSERT INTO workflow_execution_attempt (attempt_id, execution_id, workflow_id, website_id, step_index, step_type, attempt, status, created_at)
         VALUES ('purge-old:0:1', 'purge-old', ?1, ?2, 0, 'webhook', 1, 'success', ?3)`,
      ).bind(workflowId, TEST_WEBSITE_ID, Date.now()),
    ]);
    expect(await purgeWorkflowLogs(appEnv)).toBeGreaterThanOrEqual(1);
    // Executions still in progress are kept.
    expect((await executionsOf(workflowId)).map((row) => row.id).sort()).toEqual(['purge-new', 'purge-old-running']);
    const attempts = await env.DB.prepare(`SELECT COUNT(*) as n FROM workflow_execution_attempt WHERE execution_id = 'purge-old'`).first<{ n: number }>();
    expect(attempts?.n).toBe(0);
  });
});
