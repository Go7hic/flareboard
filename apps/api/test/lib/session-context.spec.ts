import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getSessionContext } from '../../src/lib/session-context';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 4, 12);
const SESSION_ID = 'context-session';

async function insertEvent(
  id: string,
  eventType: number,
  eventName: string | null,
  createdAt: number,
  data: Record<string, string> = {},
) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, '/checkout', ?5, ?6)`,
  )
    .bind(id, TEST_WEBSITE_ID, SESSION_ID, createdAt, eventType, eventName)
    .run();

  let index = 0;
  for (const [key, value] of Object.entries(data)) {
    await env.DB.prepare(
      `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)`,
    )
      .bind(`${id}-data-${index++}`, TEST_WEBSITE_ID, id, key, value, createdAt)
      .run();
  }
}

describe('getSessionContext', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('combines feature exposures, errors, logs, surveys, and workflows for a session', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
       VALUES (?1, ?2, ?3)`,
    )
      .bind(SESSION_ID, TEST_WEBSITE_ID, BASE)
      .run();

    await insertEvent('ctx-page', EVENT_TYPE.pageView, null, BASE);
    await insertEvent('ctx-flag', EVENT_TYPE.customEvent, '$feature_flag_called', BASE + 1000, {
      '$feature_flag': 'checkout.new_flow',
      '$feature_flag_response': 'test',
    });
    await insertEvent('ctx-error', EVENT_TYPE.error, 'Payment failed', BASE + 2000, {
      message: 'Payment failed',
      severity: 'error',
    });
    await insertEvent('ctx-log', EVENT_TYPE.log, 'log', BASE + 3000, {
      message: 'Retrying payment provider',
      level: 'warn',
    });
    await insertEvent('ctx-ai', EVENT_TYPE.ai, 'ai_generation', BASE + 3500, {
      model: 'gpt-4.1-mini',
      status: 'success',
    });
    await env.DB.prepare(
      `INSERT INTO survey (survey_id, website_id, name, question, type, enabled, created_at, updated_at)
       VALUES ('context-survey', ?1, 'Checkout feedback', 'What stopped you?', 'text', 1, ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO survey_response (response_id, survey_id, website_id, session_id, visit_id, answer, url_path, created_at)
       VALUES ('context-response', 'context-survey', ?1, ?2, ?2, 'Card was declined', '/checkout', ?3)`,
    )
      .bind(TEST_WEBSITE_ID, SESSION_ID, BASE + 4000)
      .run();
    await env.DB.prepare(
      `INSERT INTO workflow (workflow_id, website_id, name, trigger_event, enabled, action_type, created_at, updated_at)
       VALUES ('context-workflow', ?1, 'Notify sales', 'checkout_completed', 1, 'record', ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO workflow_execution
         (execution_id, workflow_id, website_id, session_id, visit_id, event_id, event_name, status, created_at)
       VALUES ('context-workflow-execution', 'context-workflow', ?1, ?2, ?2, 'ctx-event', 'checkout_completed', 'recorded', ?3)`,
    )
      .bind(TEST_WEBSITE_ID, SESSION_ID, BASE + 4500)
      .run();

    const context = await getSessionContext(env, TEST_WEBSITE_ID, SESSION_ID);

    expect(context.map((item) => item.kind)).toEqual([
      'pageview',
      'feature_flag',
      'error',
      'log',
      'ai',
      'survey_response',
      'workflow_execution',
    ]);
    expect(context[1]).toMatchObject({
      title: 'checkout.new_flow',
      detail: 'test',
      source: { module: 'feature_flags', id: 'checkout.new_flow' },
    });
    expect(context[2]).toMatchObject({
      title: 'Payment failed',
      detail: 'error',
      source: { module: 'errors' },
    });
    expect(context[3]).toMatchObject({
      title: 'Retrying payment provider',
      detail: 'warn',
      source: { module: 'logs' },
    });
    expect(context[4]).toMatchObject({
      title: 'gpt-4.1-mini',
      detail: 'success',
      source: { module: 'ai_observability' },
    });
    expect(context[5]).toMatchObject({
      title: 'Checkout feedback',
      detail: 'Card was declined',
      source: { module: 'surveys', id: 'context-survey' },
    });
    expect(context[6]).toMatchObject({
      title: 'Notify sales',
      detail: 'recorded',
      source: { module: 'workflows', id: 'context-workflow' },
      properties: [
        { key: 'event', value: 'checkout_completed' },
        { key: 'action', value: 'record' },
      ],
    });
  });
});
