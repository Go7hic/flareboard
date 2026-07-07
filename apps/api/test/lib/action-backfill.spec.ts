import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { backfillActionTags } from '../../src/lib/action-backfill';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

describe('backfillActionTags', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('tags historical events idempotently and skips already-tagged rows', async () => {
    const now = Date.UTC(2026, 0, 22, 12);
    const sessionId = 'session-backfill-1';
    const eventId = 'event-backfill-1';

    await env.DB.prepare(
      `INSERT INTO session (session_id, website_id, created_at)
       VALUES (?1, ?2, ?3)`,
    )
      .bind(sessionId, TEST_WEBSITE_ID, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO website_event
       (event_id, website_id, session_id, visit_id, event_type, event_name, url_path, created_at)
       VALUES (?1, ?2, ?3, ?3, ?4, 'checkout_started', '/checkout', ?5)`,
    )
      .bind(eventId, TEST_WEBSITE_ID, sessionId, EVENT_TYPE.customEvent, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO action_definition (action_id, website_id, name, rules, created_at, updated_at)
       VALUES ('action-backfill', ?1, 'Checkout started', ?2, ?3, ?3)`,
    )
      .bind(
        TEST_WEBSITE_ID,
        JSON.stringify([{ field: 'event_name', operator: 'equals', value: 'checkout_started' }]),
        now,
      )
      .run();

    const dryRun = await backfillActionTags(env, {
      websiteId: TEST_WEBSITE_ID,
      startAt: now - 60_000,
      endAt: now + 60_000,
      dryRun: true,
    });
    expect(dryRun).toMatchObject({ scanned: 1, tagged: 1, skipped: 0, dryRun: true });

    const tagged = await env.DB.prepare(
      `SELECT data_key as dataKey
       FROM event_data
       WHERE website_event_id = ?1 AND data_key = '$flareboard_action_ids'`,
    )
      .bind(eventId)
      .all();
    expect(tagged.results ?? []).toHaveLength(0);

    const first = await backfillActionTags(env, {
      websiteId: TEST_WEBSITE_ID,
      startAt: now - 60_000,
      endAt: now + 60_000,
    });
    expect(first).toMatchObject({ scanned: 1, tagged: 1, skipped: 0, dryRun: false });

    const row = await env.DB.prepare(
      `SELECT string_value as value
       FROM event_data
       WHERE website_event_id = ?1 AND data_key = '$flareboard_action_ids'
       LIMIT 1`,
    )
      .bind(eventId)
      .first<{ value: string }>();
    expect(row?.value).toBe('action-backfill');

    const second = await backfillActionTags(env, {
      websiteId: TEST_WEBSITE_ID,
      startAt: now - 60_000,
      endAt: now + 60_000,
    });
    expect(second).toMatchObject({ scanned: 0, tagged: 0, skipped: 0, dryRun: false });
  });
});
