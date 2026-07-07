import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getWebsiteReplays } from '../../src/lib/queries';
import { getSavedReplays } from '../../src/lib/replays';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 10, 12);

describe('replay query helpers', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('returns saved replays with replay metadata', async () => {
    await env.DB.prepare(
      `INSERT INTO session_replay_summary
       (website_id, visit_id, session_id, started_at, ended_at, event_count, chunks)
       VALUES (?1, 'saved-visit-a', 'saved-session-a', ?2, ?3, 42, 3)`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 1000, BASE + 5000)
      .run();
    await env.DB.prepare(
      `INSERT INTO session_replay_saved
       (saved_replay_id, name, website_id, visit_id, created_at, updated_at)
       VALUES ('saved-replay-a', 'Checkout failure', ?1, 'saved-visit-a', ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 6000)
      .run();

    const replays = await getSavedReplays(env, TEST_WEBSITE_ID);

    expect(replays).toContainEqual({
      id: 'saved-replay-a',
      name: 'Checkout failure',
      visitId: 'saved-visit-a',
      createdAt: BASE + 6000,
      sessionId: 'saved-session-a',
      startedAt: BASE + 1000,
      endedAt: BASE + 5000,
      eventCount: 42,
      chunks: 3,
      durationMs: 4000,
      pageviews: 0,
      customEvents: 0,
      errors: 0,
      logs: 0,
      aiCalls: 0,
      lastIssueAt: null,
    });
  });

  it('returns replay context counts for filtering and triage', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
       VALUES ('replay-context-session', ?1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO session_replay_summary
       (website_id, visit_id, session_id, started_at, ended_at, event_count, chunks)
       VALUES (?1, 'replay-context-visit', 'replay-context-session', ?2, ?3, 80, 4)`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 10_000, BASE + 30_000)
      .run();

    const events = [
      ['replay-page', EVENT_TYPE.pageView, null, BASE + 11_000],
      ['replay-custom', EVENT_TYPE.customEvent, 'checkout_started', BASE + 12_000],
      ['replay-error', EVENT_TYPE.error, 'Payment failed', BASE + 13_000],
      ['replay-log', EVENT_TYPE.log, 'log', BASE + 14_000],
      ['replay-ai', EVENT_TYPE.ai, 'ai_generation', BASE + 15_000],
    ] as const;
    for (const [eventId, eventType, eventName, createdAt] of events) {
      await env.DB.prepare(
        `INSERT INTO website_event
         (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
         VALUES (?1, ?2, 'replay-context-session', 'replay-context-visit', ?3, '/checkout', ?4, ?5)`,
      )
        .bind(eventId, TEST_WEBSITE_ID, createdAt, eventType, eventName)
        .run();
    }

    const replays = await getWebsiteReplays(env, TEST_WEBSITE_ID, 100);

    expect(replays).toContainEqual({
      visitId: 'replay-context-visit',
      sessionId: 'replay-context-session',
      startedAt: BASE + 10_000,
      endedAt: BASE + 30_000,
      eventCount: 80,
      chunks: 4,
      durationMs: 20_000,
      pageviews: 1,
      customEvents: 1,
      errors: 1,
      logs: 1,
      aiCalls: 1,
      lastIssueAt: BASE + 14_000,
    });
  });
});
