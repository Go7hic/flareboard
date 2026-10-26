import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENT_TYPE, flattenEventData, type QueueMessage } from '@flareboard/shared';
import type { SiteStoreRpc, StoreStatement } from '@flareboard/db/site-store';
import aggregator from '../../../../workers/aggregator/src/index';
import type { Env } from '../../src/env';
import { getMetricsFromRollups } from '../../src/lib/rollups';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

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

  it('writes a website store\'s session dimensions as one combination row', async () => {
    const site = 'aggregator-fallback-store';
    const eventId = 'aggregator-fallback-store-event';
    const sessionId = 'aggregator-fallback-store-session';
    // The store's batch() throws once after the event row is in, before any rollup is written.
    let failed = false;
    const namespace = env.SITE_STORE as DurableObjectNamespace;
    const failingStores = {
      idFromName: (name: string) => namespace.idFromName(name),
      get: (id: DurableObjectId) => {
        const stub = namespace.get(id) as unknown as SiteStoreRpc;
        return {
          query: (websiteId: string, statement: StoreStatement) => stub.query(websiteId, statement),
          execScript: (websiteId: string, script: string) => stub.execScript(websiteId, script),
          batch: async (websiteId: string, statements: StoreStatement[]) => {
            const found = await stub.query(websiteId, {
              sql: 'SELECT 1 AS ok FROM website_event WHERE event_id = ?',
              params: [eventId],
              mode: 'all',
            });
            if (found.results.length && !failed) {
              failed = true;
              throw new Error('injected failure after the event insert');
            }
            return stub.batch(websiteId, statements);
          },
        };
      },
    };
    const messages = [
      message({
        type: 'session',
        data: { id: sessionId, websiteId: site, createdAt: CREATED_AT, browser: 'Chrome', os: 'macOS', device: 'desktop', language: 'en-US', country: 'US' },
      } as QueueMessage),
      message({
        type: 'event',
        data: { id: eventId, websiteId: site, sessionId, visitId: sessionId, createdAt: CREATED_AT, urlPath: '/checkout', eventType: EVENT_TYPE.pageView },
      }),
      // Website stores keep properties on the event row, so the revenue row is the first write
      // after the event insert: failing there sends the batch to the per-message fallback.
      message({
        type: 'revenue',
        data: { id: `${eventId}-revenue`, websiteId: site, sessionId, eventId, eventName: 'purchase', currency: 'USD', revenue: 10, createdAt: CREATED_AT },
      }),
    ];
    const batch = { queue: 'flareboard-events', messages, ackAll: vi.fn(), retryAll: vi.fn() };

    await aggregator.queue(batch as unknown as MessageBatch<QueueMessage>, {
      DB: env.DB,
      EVENT_STORE: 'do',
      SITE_STORE: failingStores as unknown as DurableObjectNamespace,
    });

    expect(failed).toBe(true);
    expect(messages.every((m) => m.ack.mock.calls.length === 1)).toBe(true);
    const db = testSiteDb(site);
    const combinations = await db
      .prepare('SELECT day, browser, os, device, language, country, count FROM rollup_session_dims_daily')
      .all();
    expect(combinations.results).toEqual([
      { day: DAY, browser: 'Chrome', os: 'macOS', device: 'desktop', language: 'en-US', country: 'US', count: 1 },
    ]);
    const dimensions = await db.prepare('SELECT dimension FROM rollup_dimension_daily ORDER BY dimension').all();
    expect(dimensions.results).toEqual([{ dimension: 'path' }, { dimension: 'referrer' }]);
    const start = Date.parse(`${DAY}T00:00:00.000Z`);
    const end = Date.parse(`${DAY}T23:59:59.999Z`);
    expect(await getMetricsFromRollups(env as unknown as Env, site, start, end, 'browser')).toEqual([{ x: 'Chrome', y: 1 }]);
  });
});
