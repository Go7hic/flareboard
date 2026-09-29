import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE, type PropertyFilter } from '@flareboard/shared';
import { getSavedReplays, listReplays, type ReplayListOptions } from '../../src/lib/replays';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const BASE = Date.UTC(2026, 0, 10, 12);

describe('replay query helpers', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('returns saved replays with replay metadata', async () => {
    await testSiteDb(TEST_WEBSITE_ID).prepare(
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
    await testSiteDb(TEST_WEBSITE_ID).prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
       VALUES ('replay-context-session', ?1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await testSiteDb(TEST_WEBSITE_ID).prepare(
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
      await testSiteDb(TEST_WEBSITE_ID).prepare(
        `INSERT INTO website_event
         (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
         VALUES (?1, ?2, 'replay-context-session', 'replay-context-visit', ?3, '/checkout', ?4, ?5)`,
      )
        .bind(eventId, TEST_WEBSITE_ID, createdAt, eventType, eventName)
        .run();
    }

    const replays = await listReplays(env, TEST_WEBSITE_ID, { limit: 100 });

    expect(replays).toContainEqual(
      expect.objectContaining({
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
        entryPath: '/checkout',
        clickCount: 0,
        consoleErrorCount: 0,
      }),
    );
  });
});

/** Three visits in their own day so other specs' rows stay out of the range. */
const DAY = Date.UTC(2026, 1, 3);
const RANGE = { startAt: DAY, endAt: DAY + 24 * 60 * 60 * 1000 };

const VISITS = [
  {
    visit: 'flt-a',
    session: { country: 'US', browser: 'chrome', os: 'Mac OS', device: 'desktop', distinct: 'user-a' },
    start: DAY + 1000,
    durationMs: 60_000,
    clicks: 10,
    consoleErrors: 0,
    events: [
      [EVENT_TYPE.pageView, null, '/pricing'],
      [EVENT_TYPE.customEvent, 'signup', '/pricing'],
    ],
  },
  {
    visit: 'flt-b',
    session: { country: 'DE', browser: 'firefox', os: 'Android OS', device: 'mobile', distinct: 'user-b' },
    start: DAY + 2000,
    durationMs: 5000,
    clicks: 1,
    consoleErrors: 2,
    events: [[EVENT_TYPE.pageView, null, '/home']],
  },
  {
    visit: 'flt-c',
    session: { country: 'US', browser: 'safari', os: 'iOS', device: 'mobile', distinct: 'user-c' },
    start: DAY + 3000,
    durationMs: 30_000,
    clicks: 3,
    consoleErrors: 0,
    events: [
      [EVENT_TYPE.pageView, null, '/checkout'],
      [EVENT_TYPE.error, 'Payment failed', '/checkout'],
    ],
  },
] as const;

async function visits(options: Omit<ReplayListOptions, 'range'>) {
  const rows = await listReplays(env, TEST_WEBSITE_ID, { ...options, range: RANGE });
  return rows.map((row) => row.visitId);
}

describe('replay list filters', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    const db = testSiteDb(TEST_WEBSITE_ID);
    for (const v of VISITS) {
      const sessionId = `${v.visit}-session`;
      await db
        .prepare(
          `INSERT OR IGNORE INTO session (session_id, website_id, country, browser, os, device, distinct_id, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        )
        .bind(sessionId, TEST_WEBSITE_ID, v.session.country, v.session.browser, v.session.os, v.session.device, v.session.distinct, v.start)
        .run();
      await db
        .prepare(
          `INSERT OR IGNORE INTO session_replay_summary
           (website_id, visit_id, session_id, started_at, ended_at, event_count, chunks, click_count, console_error_count)
           VALUES (?1, ?2, ?3, ?4, ?5, 10, 1, ?6, ?7)`,
        )
        .bind(TEST_WEBSITE_ID, v.visit, sessionId, v.start, v.start + v.durationMs, v.clicks, v.consoleErrors)
        .run();
      let i = 0;
      for (const [type, name, path] of v.events) {
        await db
          .prepare(
            `INSERT OR IGNORE INTO website_event
             (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
          )
          .bind(`${v.visit}-e${i}`, TEST_WEBSITE_ID, sessionId, v.visit, v.start + i * 100, path, type, name)
          .run();
        i++;
      }
    }
  });

  it('lists the range newest first with session details', async () => {
    const rows = await listReplays(env, TEST_WEBSITE_ID, { range: RANGE });
    expect(rows.map((row) => row.visitId)).toEqual(['flt-c', 'flt-b', 'flt-a']);
    expect(rows[2]).toMatchObject({
      country: 'US',
      browser: 'chrome',
      device: 'desktop',
      distinctId: 'user-a',
      entryPath: '/pricing',
      clickCount: 10,
      durationMs: 60_000,
    });
  });

  it('filters by duration, errors, person, event and URL', async () => {
    expect(await visits({ minDurationMs: 20_000 })).toEqual(['flt-c', 'flt-a']);
    expect(await visits({ maxDurationMs: 10_000 })).toEqual(['flt-b']);
    expect(await visits({ hasErrors: true })).toEqual(['flt-c', 'flt-b']);
    expect(await visits({ hasErrors: false })).toEqual(['flt-a']);
    expect(await visits({ distinctId: 'user-a' })).toEqual(['flt-a']);
    expect(await visits({ event: 'signup' })).toEqual(['flt-a']);
    expect(await visits({ url: 'check' })).toEqual(['flt-c']);
  });

  it('applies property filters to the visit, negated ones as "no event matches"', async () => {
    const country = (operator: PropertyFilter['operator']): PropertyFilter[] => [
      { type: 'dimension', key: 'country', operator, value: 'US' },
    ];
    expect(await visits({ filters: country('is') })).toEqual(['flt-c', 'flt-a']);
    expect(await visits({ filters: country('is_not') })).toEqual(['flt-b']);
    expect(await visits({ filters: [{ type: 'dimension', key: 'browser', operator: 'contains', value: 'fire' }] })).toEqual([
      'flt-b',
    ]);
    expect(
      await visits({
        filters: [
          { type: 'dimension', key: 'device', operator: 'is', value: 'mobile' },
          { type: 'dimension', key: 'path', operator: 'is_not', value: '/home' },
        ],
      }),
    ).toEqual(['flt-c']);
  });

  it('sorts by duration, activity and errors', async () => {
    expect(await visits({ sort: 'oldest' })).toEqual(['flt-a', 'flt-b', 'flt-c']);
    expect(await visits({ sort: 'longest' })).toEqual(['flt-a', 'flt-c', 'flt-b']);
    expect(await visits({ sort: 'shortest' })).toEqual(['flt-b', 'flt-c', 'flt-a']);
    expect(await visits({ sort: 'most_active' })).toEqual(['flt-a', 'flt-c', 'flt-b']);
    expect(await visits({ sort: 'most_errors' })).toEqual(['flt-b', 'flt-c', 'flt-a']);
  });
});
