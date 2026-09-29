import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, EVENT_TYPE, ROLES } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const OWNER_ID = 'catalog-recent-owner';
const WEBSITE_ID = 'catalog-recent-site';
const AT = Date.UTC(2026, 8, 20, 12);

describe('event catalog recent examples', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
       VALUES (?1, 'catalog-recent-owner', 'hash', ?2, ?3, ?3)`,
    )
      .bind(OWNER_ID, ROLES.user, AT)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, 'Catalog', 'catalog.example', ?2, ?3, ?3)`,
    )
      .bind(WEBSITE_ID, OWNER_ID, AT)
      .run();
    const db = testSiteDb(WEBSITE_ID);
    await db
      .prepare(`INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES ('catalog-s1', ?1, ?2)`)
      .bind(WEBSITE_ID, AT)
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
         VALUES ('catalog-e1', ?1, 'catalog-s1', 'catalog-v1', ?2, '/pricing', ?3, '$autocapture')`,
      )
      .bind(WEBSITE_ID, AT, EVENT_TYPE.customEvent)
      .run();
    for (const [key, value] of [
      ['$event_type', 'click'],
      ['$el_tag', 'button'],
      ['$el_text', 'Sign up'],
    ]) {
      await db
        .prepare(
          `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
           VALUES (?1, ?2, 'catalog-e1', ?3, ?4, 1, ?5)`,
        )
        .bind(`catalog-d-${key}`, WEBSITE_ID, key, value, AT)
        .run();
    }
  });

  it('returns each recent example with its properties', async () => {
    const token = await createSecureToken({ userId: OWNER_ID, role: ROLES.user }, env.APP_SECRET);
    const { response, body } = await fetchWorkerJson<{
      recent: Array<{ id: string; properties: Array<{ key: string; value: string | null }> }>;
    }>(
      `/api/websites/${WEBSITE_ID}/events/catalog/${encodeURIComponent('$autocapture')}?startAt=${AT - 3_600_000}&endAt=${AT + 3_600_000}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(200);
    expect(body.recent[0]?.id).toBe('catalog-e1');
    expect(body.recent[0]?.properties).toEqual([
      { key: '$el_tag', value: 'button' },
      { key: '$el_text', value: 'Sign up' },
      { key: '$event_type', value: 'click' },
    ]);
  });
});
