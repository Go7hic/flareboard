import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENTITY_TYPE, EVENT_TYPE } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

describe('public board shares', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('embeds stats and insight widget data with board range and layout', async () => {
    const now = Date.now();
    const boardId = '00000000-0000-0000-0000-00000000b001';
    const shareId = '00000000-0000-0000-0000-00000000b002';
    const insightId = '00000000-0000-0000-0000-00000000b003';
    const slug = 'publicboardshare';
    const sessionId = 'board-share-session';

    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
       VALUES (?1, ?2, ?3)`,
    )
      .bind(sessionId, TEST_WEBSITE_ID, now)
      .run();

    await env.DB.prepare(
      `INSERT OR IGNORE INTO website_event
        (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind('board-share-event', TEST_WEBSITE_ID, sessionId, now, '/pricing', EVENT_TYPE.pageView, null)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO insight
        (insight_id, website_id, user_id, type, name, description, query, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    )
      .bind(
        insightId,
        TEST_WEBSITE_ID,
        TEST_USER_ID,
        'trend',
        'Pricing traffic',
        '',
        JSON.stringify({ metric: 'pageviews' }),
        now,
      )
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO board
        (board_id, type, name, description, parameters, user_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
      .bind(
        boardId,
        'dashboard',
        'Growth board',
        '',
        JSON.stringify({
          rangePreset: '30d',
          widgets: [
            { type: 'stats', websiteId: TEST_WEBSITE_ID, label: 'Traffic', width: 'full' },
            { type: 'insight', insightId, label: 'Pricing trend', width: 'half' },
          ],
        }),
        TEST_USER_ID,
        now,
      )
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO share
        (share_id, entity_id, name, share_type, slug, parameters, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
      .bind(shareId, boardId, 'Public growth board', ENTITY_TYPE.board, slug, JSON.stringify({ boardId }), now)
      .run();

    const { response, body } = await fetchWorkerJson<{
      board: {
        parameters: {
          rangePreset: string;
          widgets: Array<{
            type: string;
            width?: string;
            stats?: { pageviews: { value: number } };
            result?: { kind: string; series?: Array<{ y: number }> };
          }>;
        };
      };
    }>(`/api/share/${slug}?startAt=${now - 86400000}&endAt=${now + 1000}`);

    expect(response.status).toBe(200);
    expect(body.board.parameters.rangePreset).toBe('30d');
    expect(body.board.parameters.widgets[0]).toMatchObject({
      type: 'stats',
      width: 'full',
      stats: { pageviews: { value: 1 } },
    });
    expect(body.board.parameters.widgets[1]).toMatchObject({
      type: 'insight',
      width: 'half',
      result: { kind: 'trend' },
    });
    expect(body.board.parameters.widgets[1]?.result?.series?.some((point) => point.y > 0)).toBe(true);
  });

  it('uses the saved board range when no public range query is provided', async () => {
    const now = Date.now();
    const boardId = '00000000-0000-0000-0000-00000000b011';
    const shareId = '00000000-0000-0000-0000-00000000b012';
    const slug = 'publicboardrange';
    const sessionId = 'board-share-range-session';
    const olderThanOneDay = now - 10 * 86400000;

    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
       VALUES (?1, ?2, ?3)`,
    )
      .bind(sessionId, TEST_WEBSITE_ID, olderThanOneDay)
      .run();

    await env.DB.prepare(
      `INSERT OR IGNORE INTO website_event
        (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind('board-share-range-event', TEST_WEBSITE_ID, sessionId, olderThanOneDay, '/range', EVENT_TYPE.pageView, null)
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO board
        (board_id, type, name, description, parameters, user_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
      .bind(
        boardId,
        'dashboard',
        'Default range board',
        '',
        JSON.stringify({
          rangePreset: '30d',
          widgets: [{ type: 'stats', websiteId: TEST_WEBSITE_ID, width: 'half' }],
        }),
        TEST_USER_ID,
        now,
      )
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO share
        (share_id, entity_id, name, share_type, slug, parameters, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
      .bind(shareId, boardId, 'Default range share', ENTITY_TYPE.board, slug, JSON.stringify({ boardId }), now)
      .run();

    const { response, body } = await fetchWorkerJson<{
      board: { parameters: { widgets: Array<{ stats?: { pageviews: { value: number } } }> } };
      period: { startAt: number; endAt: number };
    }>(`/api/share/${slug}`);

    expect(response.status).toBe(200);
    expect(body.period.startAt).toBeLessThanOrEqual(olderThanOneDay);
    expect(body.board.parameters.widgets[0]?.stats?.pageviews.value).toBeGreaterThanOrEqual(1);
  });
});
