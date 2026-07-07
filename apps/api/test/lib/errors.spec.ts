import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import {
  addErrorIssueComment,
  createErrorAlertRule,
  evaluateErrorAlertRules,
  getErrorEvent,
  getErrorEvents,
  getErrorIssues,
  getErrorStats,
  updateErrorIssueState,
} from '../../src/lib/errors';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 7, 12);
const DAY = 24 * 60 * 60 * 1000;

async function insertSession(id: string) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(id, TEST_WEBSITE_ID, BASE)
    .run();
}

async function insertError(
  id: string,
  sessionId: string,
  name: string,
  message: string,
  createdAt: number,
  severity = 'error',
  release = '1.0.0',
  environment = 'production',
) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, '/checkout', ?5, ?6)`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, createdAt, EVENT_TYPE.error, message)
    .run();

  await env.DB.prepare(
    `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
     VALUES
       (?1, ?2, ?3, 'name', ?4, 1, ?8),
       (?5, ?2, ?3, 'message', ?6, 1, ?8),
       (?7, ?2, ?3, 'severity', ?9, 1, ?8),
       (?10, ?2, ?3, 'release', ?11, 1, ?8),
       (?12, ?2, ?3, 'environment', ?13, 1, ?8)`,
  )
    .bind(
      `${id}-name`,
      TEST_WEBSITE_ID,
      id,
      name,
      `${id}-message`,
      message,
      `${id}-severity`,
      createdAt,
      severity,
      `${id}-release`,
      release,
      `${id}-environment`,
      environment,
    )
    .run();
}

describe('errors query helpers', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('groups repeated errors into issues and keeps recent samples', async () => {
    await insertSession('error-session-a');
    await insertSession('error-session-b');
    await insertError(
      'error-1',
      'error-session-a',
      'TypeError',
      'Cannot read properties of undefined',
      BASE + 1000,
    );
    await insertError(
      'error-2',
      'error-session-b',
      'TypeError',
      'Cannot read properties of undefined',
      BASE + 2000,
    );
    await insertError('error-3', 'error-session-b', 'ReferenceError', 'checkout is not defined', BASE + 3000);

    const [stats, issues, events] = await Promise.all([
      getErrorStats(env, TEST_WEBSITE_ID, BASE, BASE + 4000),
      getErrorIssues(env, TEST_WEBSITE_ID, BASE, BASE + 4000),
      getErrorEvents(env, TEST_WEBSITE_ID, BASE, BASE + 4000),
    ]);

    expect(stats).toMatchObject({ errors: 3, sessions: 2, lastSeenAt: BASE + 3000 });
    expect(stats.trend).toEqual([{ date: '2026-01-07', errors: 3, sessions: 2 }]);
    expect(stats.severities).toEqual([{ severity: 'error', errors: 3 }]);
    expect(stats.releases).toEqual([{ release: '1.0.0', errors: 3 }]);
    expect(stats.environments).toEqual([{ environment: 'production', errors: 3 }]);
    expect(events.map((event) => event.id)).toEqual(['error-3', 'error-2', 'error-1']);
    expect(
      issues.map((issue) => ({
        message: issue.message,
        name: issue.name,
        events: issue.events,
        sessions: issue.sessions,
        latestEventId: issue.latestEventId,
        status: issue.status,
        samples: issue.samples.map((sample) => sample.id),
      })),
    ).toEqual([
      {
        message: 'Cannot read properties of undefined',
        name: 'TypeError',
        events: 2,
        sessions: 2,
        latestEventId: 'error-2',
        status: 'open',
        samples: ['error-2', 'error-1'],
      },
      {
        message: 'checkout is not defined',
        name: 'ReferenceError',
        events: 1,
        sessions: 1,
        latestEventId: 'error-3',
        status: 'open',
        samples: ['error-3'],
      },
    ]);
  });

  it('returns daily trend and severity breakdown for the selected period', async () => {
    const later = BASE + DAY * 2;

    await insertSession('error-trend-session-a');
    await insertSession('error-trend-session-b');
    await insertError('error-trend-1', 'error-trend-session-a', 'NetworkError', 'Failed to fetch', later + 1000, 'warning');
    await insertError(
      'error-trend-2',
      'error-trend-session-b',
      'ChunkLoadError',
      'Loading chunk failed',
      later + DAY + 1000,
      'fatal',
    );

    const stats = await getErrorStats(env, TEST_WEBSITE_ID, later, later + DAY + 2000);

    expect(stats.trend).toEqual([
      { date: '2026-01-09', errors: 1, sessions: 1 },
      { date: '2026-01-10', errors: 1, sessions: 1 },
    ]);
    expect(stats.severities).toEqual([
      { severity: 'fatal', errors: 1 },
      { severity: 'warning', errors: 1 },
    ]);
  });

  it('filters errors by release and environment across stats, issues, and events', async () => {
    const later = BASE + DAY * 4;

    await insertSession('error-filter-session-a');
    await insertSession('error-filter-session-b');
    await insertSession('error-filter-session-c');
    await insertError(
      'error-filter-1',
      'error-filter-session-a',
      'TypeError',
      'Broken production release',
      later + 1000,
      'error',
      '2.0.0',
      'production',
    );
    await insertError(
      'error-filter-2',
      'error-filter-session-b',
      'TypeError',
      'Broken production release',
      later + 2000,
      'error',
      '2.0.0',
      'preview',
    );
    await insertError(
      'error-filter-3',
      'error-filter-session-c',
      'ReferenceError',
      'Old release issue',
      later + 3000,
      'warning',
      '1.9.0',
      'production',
    );

    const filters = { release: '2.0.0', environment: 'production' };
    const [stats, issues, events] = await Promise.all([
      getErrorStats(env, TEST_WEBSITE_ID, later, later + 4000, filters),
      getErrorIssues(env, TEST_WEBSITE_ID, later, later + 4000, filters),
      getErrorEvents(env, TEST_WEBSITE_ID, later, later + 4000, filters),
    ]);

    expect(stats).toMatchObject({ errors: 1, sessions: 1, lastSeenAt: later + 1000 });
    expect(stats.releases).toEqual([{ release: '2.0.0', errors: 1 }]);
    expect(stats.environments).toEqual([{ environment: 'production', errors: 1 }]);
    expect(stats.trend).toEqual([{ date: '2026-01-11', errors: 1, sessions: 1 }]);
    expect(issues.map((issue) => issue.latestEventId)).toEqual(['error-filter-1']);
    expect(events.map((event) => event.id)).toEqual(['error-filter-1']);
  });

  it('persists issue status by fingerprint', async () => {
    const later = BASE + DAY * 6;

    await insertSession('error-state-session-a');
    await insertError(
      'error-state-1',
      'error-state-session-a',
      'TypeError',
      'Stateful issue',
      later + 1000,
    );

    const fingerprint = 'TypeError|Stateful issue';
    await updateErrorIssueState(env, TEST_WEBSITE_ID, fingerprint, 'resolved', 'Fixed in 2.1.0');

    const issues = await getErrorIssues(env, TEST_WEBSITE_ID, later, later + 2000);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      fingerprint,
      status: 'resolved',
      note: 'Fixed in 2.1.0',
    });
    expect(issues[0].stateUpdatedAt).toEqual(expect.any(Number));
  });

  it('persists issue assignment and note history', async () => {
    const later = BASE + DAY * 10;

    await insertSession('error-assignee-session-a');
    await insertError(
      'error-assignee-1',
      'error-assignee-session-a',
      'TypeError',
      'Assigned issue',
      later + 1000,
    );

    const fingerprint = 'TypeError|Assigned issue';
    await updateErrorIssueState(
      env,
      TEST_WEBSITE_ID,
      fingerprint,
      'open',
      'Needs owner',
      '00000000-0000-0000-0000-000000000001',
    );
    await addErrorIssueComment(
      env,
      TEST_WEBSITE_ID,
      fingerprint,
      '00000000-0000-0000-0000-000000000001',
      'Investigating the checkout bundle.',
    );

    const issues = await getErrorIssues(env, TEST_WEBSITE_ID, later, later + 2000);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      fingerprint,
      status: 'open',
      note: 'Needs owner',
      assigneeUserId: '00000000-0000-0000-0000-000000000001',
      comments: [
        {
          userId: '00000000-0000-0000-0000-000000000001',
          body: 'Investigating the checkout bundle.',
          createdAt: expect.any(Number),
        },
      ],
    });
  });

  it('filters stats, issues, and events by issue status', async () => {
    const later = BASE + DAY * 7;

    await insertSession('error-status-filter-session-a');
    await insertSession('error-status-filter-session-b');
    await insertError(
      'error-status-filter-1',
      'error-status-filter-session-a',
      'TypeError',
      'Still open issue',
      later + 1000,
    );
    await insertError(
      'error-status-filter-2',
      'error-status-filter-session-b',
      'TypeError',
      'Already fixed issue',
      later + 2000,
    );

    await updateErrorIssueState(env, TEST_WEBSITE_ID, 'TypeError|Already fixed issue', 'resolved');

    const [openStats, openIssues, openEvents, resolvedStats, resolvedIssues, resolvedEvents] = await Promise.all([
      getErrorStats(env, TEST_WEBSITE_ID, later, later + 3000, { status: 'open' }),
      getErrorIssues(env, TEST_WEBSITE_ID, later, later + 3000, { status: 'open' }),
      getErrorEvents(env, TEST_WEBSITE_ID, later, later + 3000, { status: 'open' }),
      getErrorStats(env, TEST_WEBSITE_ID, later, later + 3000, { status: 'resolved' }),
      getErrorIssues(env, TEST_WEBSITE_ID, later, later + 3000, { status: 'resolved' }),
      getErrorEvents(env, TEST_WEBSITE_ID, later, later + 3000, { status: 'resolved' }),
    ]);

    expect(openStats.errors).toBe(1);
    expect(openIssues.map((issue) => issue.fingerprint)).toEqual(['TypeError|Still open issue']);
    expect(openEvents.map((event) => event.id)).toEqual(['error-status-filter-1']);

    expect(resolvedStats.errors).toBe(1);
    expect(resolvedIssues.map((issue) => issue.fingerprint)).toEqual(['TypeError|Already fixed issue']);
    expect(resolvedEvents.map((event) => event.id)).toEqual(['error-status-filter-2']);
  });

  it('returns full error event detail with captured properties', async () => {
    const later = BASE + DAY * 9;

    await insertSession('error-detail-session-a');
    await insertError(
      'error-detail-1',
      'error-detail-session-a',
      'TypeError',
      'Detailed issue',
      later + 1000,
      'fatal',
      '3.0.0',
      'production',
    );

    const detail = await getErrorEvent(env, TEST_WEBSITE_ID, 'error-detail-1');

    expect(detail).toMatchObject({
      id: 'error-detail-1',
      message: 'Detailed issue',
      name: 'TypeError',
      severity: 'fatal',
      release: '3.0.0',
      environment: 'production',
    });
    expect(detail?.properties).toEqual(
      expect.arrayContaining([
        { key: 'message', value: 'Detailed issue' },
        { key: 'severity', value: 'fatal' },
        { key: 'release', value: '3.0.0' },
        { key: 'environment', value: 'production' },
      ]),
    );
  });

  it('records triggered alert rules when errors cross the threshold', async () => {
    const later = BASE + DAY * 12;

    await insertSession('error-alert-session-a');
    await insertSession('error-alert-session-b');
    await insertError(
      'error-alert-1',
      'error-alert-session-a',
      'TypeError',
      'Alert threshold issue',
      later + 1000,
      'error',
      '5.0.0',
      'production',
    );
    await insertError(
      'error-alert-2',
      'error-alert-session-b',
      'TypeError',
      'Alert threshold issue',
      later + 2000,
      'error',
      '5.0.0',
      'production',
    );

    const rule = await createErrorAlertRule(env, TEST_WEBSITE_ID, {
      name: 'Production error spike',
      enabled: true,
      threshold: 2,
      windowMinutes: 10,
      severity: 'error',
      release: '5.0.0',
      environment: 'production',
      channel: 'record',
    });

    const triggered = await evaluateErrorAlertRules(env, TEST_WEBSITE_ID, later + 2000);

    expect(triggered).toEqual([
      expect.objectContaining({
        alertRuleId: rule.id,
        count: 2,
        threshold: 2,
      }),
    ]);

    const stored = await env.DB.prepare(
      `SELECT alert_rule_id as alertRuleId, count, threshold
       FROM error_alert_event
       WHERE website_id = ?1 AND alert_rule_id = ?2`,
    )
      .bind(TEST_WEBSITE_ID, rule.id)
      .all<{ alertRuleId: string; count: number; threshold: number }>();

    expect(stored.results).toEqual([
      {
        alertRuleId: rule.id,
        count: 2,
        threshold: 2,
      },
    ]);
  });
});
