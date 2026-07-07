import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { runInsightQuery, serializeInsight } from '../../src/lib/insights';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 0, 22, 12);
const DAY = 24 * 60 * 60 * 1000;

async function insertSession(id: string, createdAt: number) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, distinct_id, browser, country, created_at)
     VALUES (?1, ?2, ?3, 'Chrome', 'US', ?4)`,
  )
    .bind(id, TEST_WEBSITE_ID, `user-${id}`, createdAt)
    .run();
}

async function insertEvent(id: string, sessionId: string, eventName: string | null, eventType: number, createdAt: number, path = '/app') {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, createdAt, path, eventType, eventName)
    .run();
}

describe('insight query helpers', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('runs trend insights for a selected event', async () => {
    await insertSession('insight-session-a', BASE);
    await insertSession('insight-session-b', BASE + DAY);
    await insertEvent('insight-trend-a', 'insight-session-a', 'signup', EVENT_TYPE.customEvent, BASE + 100);
    await insertEvent('insight-trend-b', 'insight-session-b', 'signup', EVENT_TYPE.customEvent, BASE + DAY + 100);
    await insertEvent('insight-trend-ignore', 'insight-session-b', 'purchase', EVENT_TYPE.customEvent, BASE + DAY + 200);

    const result = await runInsightQuery(
      env,
      TEST_WEBSITE_ID,
      'trend',
      { metric: 'events', event: 'signup', unit: 'day' },
      BASE,
      BASE + DAY * 2,
    );

    expect(result).toMatchObject({
      kind: 'trend',
      event: 'signup',
      series: [
        { x: '2026-01-22', y: 1 },
        { x: '2026-01-23', y: 1 },
      ],
    });
  });

  it('runs funnel insights from saved event steps', async () => {
    await insertSession('insight-funnel-a', BASE);
    await insertEvent('insight-funnel-1', 'insight-funnel-a', 'signup', EVENT_TYPE.customEvent, BASE + 300);
    await insertEvent('insight-funnel-2', 'insight-funnel-a', 'purchase', EVENT_TYPE.customEvent, BASE + 400);

    const result = await runInsightQuery(
      env,
      TEST_WEBSITE_ID,
      'funnel',
      { events: ['signup', 'purchase'] },
      BASE,
      BASE + DAY * 2,
    );

    expect(result).toMatchObject({
      kind: 'funnel',
      conversion: expect.any(Number),
      steps: [
        expect.objectContaining({ step: 'signup' }),
        expect.objectContaining({ step: 'purchase' }),
      ],
    });
  });

  it('runs table insights for top pages', async () => {
    await insertEvent('insight-page-a', 'insight-session-a', null, EVENT_TYPE.pageView, BASE + 500, '/pricing');
    await insertEvent('insight-page-b', 'insight-session-b', null, EVENT_TYPE.pageView, BASE + 600, '/pricing');

    const result = await runInsightQuery(
      env,
      TEST_WEBSITE_ID,
      'table',
      { dimension: 'path', limit: 5 },
      BASE,
      BASE + DAY * 2,
    );

    expect(result).toMatchObject({
      kind: 'table',
      dimension: 'path',
      rows: expect.arrayContaining([expect.objectContaining({ x: '/pricing', y: 2 })]),
    });
  });

  it('runs path insights from a selected prefix', async () => {
    await insertSession('insight-path-session', BASE);
    await insertEvent('insight-path-1', 'insight-path-session', null, EVENT_TYPE.pageView, BASE + 700, '/pricing');
    await insertEvent('insight-path-2', 'insight-path-session', null, EVENT_TYPE.pageView, BASE + 800, '/checkout');

    const result = await runInsightQuery(
      env,
      TEST_WEBSITE_ID,
      'path',
      { path: '/pricing', limit: 10 },
      BASE,
      BASE + DAY * 2,
    );

    expect(result).toMatchObject({
      kind: 'path',
      prefix: ['/pricing'],
      next: expect.arrayContaining([expect.objectContaining({ path: '/checkout' })]),
    });
  });

  it('serializes saved insight timestamps and query', () => {
    const serialized = serializeInsight({
      id: 'insight-1',
      websiteId: TEST_WEBSITE_ID,
      userId: TEST_USER_ID,
      type: 'trend',
      name: 'Signup trend',
      description: '',
      query: { event: 'signup', metric: 'events' },
      createdAt: new Date(BASE),
      updatedAt: null,
    });

    expect(serialized).toMatchObject({
      id: 'insight-1',
      type: 'trend',
      query: { event: 'signup', metric: 'events' },
      createdAt: BASE,
      updatedAt: null,
    });
  });
});
