import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENT_TYPE, flattenEventData, type QueueMessage } from '@flareboard/shared';
import aggregator from '../../../../workers/aggregator/src/index';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const EVENT_ID = 'aggregator-fallback-event';
const SESSION_ID = 'aggregator-fallback-session';
const CREATED_AT = Date.UTC(2026, 1, 3, 10);
const DAY = '2026-02-03';

/** Real D1, except the first batch() after the event row lands throws once. */
function dbFailingAfterEventInsert(): D1Database {
  let failed = false;
  return new Proxy(env.DB, {
    get(target, prop) {
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          const exists = await target
            .prepare('SELECT 1 AS ok FROM website_event WHERE event_id = ?1')
            .bind(EVENT_ID)
            .first();
          if (exists && !failed) {
            failed = true;
            throw new Error('injected failure after the event insert');
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function message(body: QueueMessage) {
  return { body, attempts: 1, ack: vi.fn(), retry: vi.fn() };
}

describe('aggregator per-message fallback', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('still writes event data and rollups for an event the failed batch had inserted', async () => {
    const messages = [
      message({ type: 'session', data: { id: SESSION_ID, websiteId: TEST_WEBSITE_ID, createdAt: CREATED_AT } }),
      message({
        type: 'event',
        data: {
          id: EVENT_ID,
          websiteId: TEST_WEBSITE_ID,
          sessionId: SESSION_ID,
          visitId: SESSION_ID,
          createdAt: CREATED_AT,
          urlPath: '/checkout',
          eventType: EVENT_TYPE.pageView,
        },
        eventData: flattenEventData(TEST_WEBSITE_ID, EVENT_ID, { plan: 'cloud' }, CREATED_AT),
      }),
    ];
    const batch = { queue: 'flareboard-events', messages, ackAll: vi.fn(), retryAll: vi.fn() };

    await aggregator.queue(batch as unknown as MessageBatch<QueueMessage>, { DB: dbFailingAfterEventInsert() });

    expect(messages.every((m) => m.ack.mock.calls.length === 1)).toBe(true);
    const data = await env.DB.prepare(
      `SELECT string_value AS value FROM event_data WHERE website_event_id = ?1 AND data_key = 'plan'`,
    )
      .bind(EVENT_ID)
      .first<{ value: string }>();
    expect(data?.value).toBe('cloud');

    const rollup = await env.DB.prepare(
      `SELECT pageviews FROM rollup_session_day WHERE website_id = ?1 AND day = ?2 AND session_id = ?3`,
    )
      .bind(TEST_WEBSITE_ID, DAY, SESSION_ID)
      .first<{ pageviews: number }>();
    expect(rollup?.pageviews).toBe(1);
  });
});
