import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeErrorFingerprint, createSecureToken, EVENT_TYPE, messageFingerprint } from '@flareboard/shared';
import migration0048 from '../../../../packages/db/migrations/0048_error_tracking_grouping.sql?raw';
import { detectErrorRegressions } from '../../src/lib/error-regressions';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const HOUR = 60 * 60 * 1000;

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

let siteCounter = 0;
async function createWebsite() {
  siteCounter++;
  const websiteId = `00000000-0000-0000-00e7-${String(siteCounter).padStart(12, '0')}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO website (website_id, name, domain, user_id, created_at, updated_at) VALUES (?1, 'Errors', 'errors.example.com', ?2, ?3, ?3)`,
  )
    .bind(websiteId, TEST_USER_ID, now)
    .run();
  return websiteId;
}

type ErrorSeed = {
  id: string;
  sessionId: string;
  createdAt: number;
  name: string;
  message: string;
  stack?: string;
  /** Omit to store a legacy event (before `$exception_fingerprint` existed). */
  fingerprint?: string;
  release?: string;
  distinctId?: string;
};

async function insertError(websiteId: string, seed: ErrorSeed) {
  const db = testSiteDb(websiteId);
  await db
    .prepare(`INSERT OR IGNORE INTO session (session_id, website_id, distinct_id, created_at) VALUES (?1, ?2, ?3, ?4)`)
    .bind(seed.sessionId, websiteId, seed.distinctId ?? null, seed.createdAt)
    .run();
  await db
    .prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES (?1, ?2, ?3, ?3, ?4, '/checkout', ?5, ?6)`,
    )
    .bind(seed.id, websiteId, seed.sessionId, seed.createdAt, EVENT_TYPE.error, seed.message)
    .run();
  const props: Array<[string, string]> = [
    ['name', seed.name],
    ['message', seed.message],
    ['severity', 'error'],
  ];
  if (seed.stack) props.push(['stack', seed.stack]);
  if (seed.fingerprint) props.push(['$exception_fingerprint', seed.fingerprint]);
  if (seed.release) props.push(['release', seed.release]);
  for (const [key, value] of props) {
    await db
      .prepare(
        `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)`,
      )
      .bind(`${seed.id}-${key}`, websiteId, seed.id, key, value, seed.createdAt)
      .run();
  }
}

type IssueListItem = {
  fingerprint: string;
  message: string;
  events: number;
  sessions: number;
  users: number;
  status: string;
  mergedCount: number;
  trend: number[];
  comments: Array<{ body: string }>;
};

async function listIssues(websiteId: string, startAt: number, endAt: number, status = '') {
  const qs = `startAt=${startAt}&endAt=${endAt}${status ? `&status=${status}` : ''}`;
  const { response, body } = await fetchWorkerJson<{ issues: IssueListItem[]; stats: { errors: number; users: number } }>(
    `/api/websites/${websiteId}/errors?${qs}`,
    { headers: await authHeader() },
  );
  expect(response.status).toBe(200);
  return body;
}

const CHECKOUT_STACK = (hash: string, column: number) =>
  [
    "TypeError: Cannot read properties of undefined (reading 'price')",
    `    at lineTotal (https://shop.example.com/assets/cart-${hash}.js:1:${column})`,
    `    at renderCart (https://shop.example.com/assets/cart-${hash}.js:1:${column + 300})`,
  ].join('\n');
const CHECKOUT_FP = computeErrorFingerprint({ type: 'TypeError', stack: CHECKOUT_STACK('C3sPvF1q', 10) }).fingerprint;

describe('error issue grouping, merges and regressions', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  afterEach(() => vi.restoreAllMocks());

  it('groups by $exception_fingerprint and groups legacy events by normalized message', async () => {
    const websiteId = await createWebsite();
    const base = Date.UTC(2026, 5, 1, 12);
    // Two deploys of the same crash (fingerprint computed at ingest), three users.
    await insertError(websiteId, { id: 'g1', sessionId: 'g-s1', createdAt: base + 1, name: 'TypeError', message: "Cannot read properties of undefined (reading 'price')", stack: CHECKOUT_STACK('C3sPvF1q', 10), fingerprint: CHECKOUT_FP, distinctId: 'ana' });
    await insertError(websiteId, { id: 'g2', sessionId: 'g-s2', createdAt: base + 2, name: 'TypeError', message: "Cannot read properties of undefined (reading 'price')", stack: CHECKOUT_STACK('Df0a9QeZ', 44), fingerprint: CHECKOUT_FP, distinctId: 'ana' });
    await insertError(websiteId, { id: 'g3', sessionId: 'g-s3', createdAt: base + 3, name: 'TypeError', message: "Cannot read properties of undefined (reading 'price')", fingerprint: CHECKOUT_FP });
    // Legacy events with dynamic ids: used to be three issues, now one.
    await insertError(websiteId, { id: 'l1', sessionId: 'g-s1', createdAt: base + 4, name: 'NotFoundError', message: 'User 123 not found' });
    await insertError(websiteId, { id: 'l2', sessionId: 'g-s1', createdAt: base + 5, name: 'NotFoundError', message: 'User 456 not found' });
    await insertError(websiteId, { id: 'l3', sessionId: 'g-s2', createdAt: base + 6, name: 'NotFoundError', message: 'User 789 not found' });

    const { issues, stats } = await listIssues(websiteId, base, base + HOUR);
    expect(stats.errors).toBe(6);
    // Equal counts: the more recently seen issue first. Users are distinct ids, else sessions.
    expect(issues.map((issue) => [issue.fingerprint, issue.events, issue.sessions, issue.users])).toEqual([
      [messageFingerprint('NotFoundError', 'User 1 not found'), 3, 2, 1],
      [CHECKOUT_FP, 3, 3, 2],
    ]);
    expect(issues[1]!.trend).toHaveLength(24);
    expect(issues[1]!.trend.reduce((sum, value) => sum + value, 0)).toBe(3);
    expect(issues[0]!.message).toBe('User 789 not found');
  });

  it('rekeys legacy issue state and comments to the new fingerprint without losing any', async () => {
    const websiteId = await createWebsite();
    const base = Date.UTC(2026, 5, 2, 12);
    await insertError(websiteId, { id: 'm1', sessionId: 'm-s1', createdAt: base + 1, name: 'NotFoundError', message: 'User 1 not found' });
    await insertError(websiteId, { id: 'm2', sessionId: 'm-s2', createdAt: base + 2, name: 'NotFoundError', message: 'User 2 not found' });
    await insertError(websiteId, { id: 'm3', sessionId: 'm-s3', createdAt: base + 3, name: 'RangeError', message: 'Invalid array length' });

    // State as the previous release wrote it (resolved_at did not exist yet).
    const legacy: Array<[string, string, string | null, number]> = [
      ['NotFoundError|User 1 not found', 'resolved', null, base - 3 * HOUR],
      ['NotFoundError|User 2 not found', 'ignored', TEST_USER_ID, base - HOUR],
      ['RangeError|Invalid array length', 'resolved', null, base - 2 * HOUR],
    ];
    for (const [fingerprint, status, assignee, updatedAt] of legacy) {
      await env.DB.prepare(
        `INSERT INTO error_issue_state (website_id, fingerprint, status, note, assignee_user_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'legacy note', ?4, ?5, ?5)`,
      )
        .bind(websiteId, fingerprint, status, assignee, updatedAt)
        .run();
      await env.DB.prepare(
        `INSERT INTO error_issue_comment (comment_id, website_id, fingerprint, user_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
        .bind(crypto.randomUUID(), websiteId, fingerprint, TEST_USER_ID, `comment on ${fingerprint}`, updatedAt)
        .run();
    }
    // The 0048 data step backfills resolved_at for issues resolved before this release.
    const backfill = migration0048.split(';').find((statement) => statement.includes('UPDATE `error_issue_state`'))!;
    await env.DB.prepare(backfill).run();

    const { issues } = await listIssues(websiteId, base, base + HOUR);
    const notFound = issues.find((issue) => issue.fingerprint === messageFingerprint('NotFoundError', 'User 9 not found'))!;
    const range = issues.find((issue) => issue.fingerprint === messageFingerprint('RangeError', 'Invalid array length'))!;
    // Most recently updated legacy state wins; every comment follows the issue.
    expect(notFound).toMatchObject({ events: 2, status: 'ignored' });
    expect(notFound.comments.map((comment) => comment.body).sort()).toEqual([
      'comment on NotFoundError|User 1 not found',
      'comment on NotFoundError|User 2 not found',
    ]);
    expect(range).toMatchObject({ status: 'resolved', comments: [{ body: 'comment on RangeError|Invalid array length' }] });

    const leftovers = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM error_issue_state WHERE website_id = ?1 AND instr(fingerprint, '|') > 0)
            + (SELECT COUNT(*) FROM error_issue_comment WHERE website_id = ?1 AND instr(fingerprint, '|') > 0) AS n`,
    )
      .bind(websiteId)
      .first<{ n: number }>();
    expect(leftovers?.n).toBe(0);
    const rangeState = await env.DB.prepare(
      `SELECT assignee_user_id AS assignee, resolved_at AS resolvedAt FROM error_issue_state WHERE website_id = ?1 AND fingerprint = ?2`,
    )
      .bind(websiteId, range.fingerprint)
      .first<{ assignee: string | null; resolvedAt: number }>();
    expect(rangeState).toEqual({ assignee: null, resolvedAt: base - 2 * HOUR });
    // Resolved issues are indexed for the ingest regression check.
    expect(await env.CACHE.get(`error-resolved:${websiteId}:${range.fingerprint}`, 'json')).toEqual({
      issue: range.fingerprint,
      resolvedAt: base - 2 * HOUR,
    });

    // Old clients that still send `name|message` keep working.
    const patch = await fetchWorkerJson<{ fingerprint: string; status: string; note: string | null }>(
      `/api/websites/${websiteId}/errors/issues`,
      { method: 'PATCH', headers: await authHeader(), body: JSON.stringify({ fingerprint: 'NotFoundError|User 77 not found', status: 'open' }) },
    );
    expect(patch.body).toMatchObject({ fingerprint: notFound.fingerprint, status: 'open', note: 'legacy note' });
  });

  it('merges issues: the target keeps its state, merged events and future occurrences land in it', async () => {
    const websiteId = await createWebsite();
    const base = Date.now() - 2 * HOUR;
    const fpA = 'aaaaaaaaaaaaaaa1';
    const fpB = 'bbbbbbbbbbbbbbb2';
    const fpC = 'ccccccccccccccc3';
    await insertError(websiteId, { id: 'a1', sessionId: 'mg-s1', createdAt: base + 1, name: 'TypeError', message: 'A', fingerprint: fpA });
    await insertError(websiteId, { id: 'b1', sessionId: 'mg-s1', createdAt: base + 2, name: 'TypeError', message: 'B', fingerprint: fpB });
    await insertError(websiteId, { id: 'b2', sessionId: 'mg-s2', createdAt: base + 3, name: 'TypeError', message: 'B', fingerprint: fpB });
    await insertError(websiteId, { id: 'c1', sessionId: 'mg-s3', createdAt: base + 4, name: 'TypeError', message: 'C', fingerprint: fpC });
    const headers = await authHeader();
    const api = `/api/websites/${websiteId}/errors`;
    await fetchWorkerJson(`${api}/issues`, { method: 'PATCH', headers, body: JSON.stringify({ fingerprint: fpA, status: 'ignored', note: 'noise' }) });
    await fetchWorkerJson(`${api}/issues`, { method: 'PATCH', headers, body: JSON.stringify({ fingerprint: fpB, status: 'resolved' }) });
    await fetchWorkerJson(`${api}/issues/comments`, { method: 'POST', headers, body: JSON.stringify({ fingerprint: fpA, body: 'on A' }) });

    const self = await fetchWorkerJson<{ message: string }>(`${api}/issues/merge`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ targetFingerprint: fpA, sourceFingerprints: [fpA] }),
    });
    expect(self.response.status).toBe(400);

    // C into B, then B into A: C follows B (chains are flattened).
    await fetchWorkerJson(`${api}/issues/merge`, { method: 'POST', headers, body: JSON.stringify({ targetFingerprint: fpB, sourceFingerprints: [fpC] }) });
    const merge = await fetchWorkerJson<{ fingerprint: string; merged: string[]; mergedIssues: Array<{ sourceFingerprint: string; sourceMessage: string }> }>(
      `${api}/issues/merge`,
      { method: 'POST', headers, body: JSON.stringify({ targetFingerprint: fpA, sourceFingerprints: [fpB] }) },
    );
    expect(merge.response.status).toBe(200);
    expect(merge.body.mergedIssues.map((row) => [row.sourceFingerprint, row.sourceMessage]).sort()).toEqual([
      [fpB, 'B'],
      [fpC, 'C'],
    ]);

    const { issues } = await listIssues(websiteId, base, base + HOUR);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ fingerprint: fpA, events: 4, sessions: 3, status: 'ignored', mergedCount: 2, comments: [{ body: 'on A' }] });

    // A merged-away fingerprint points at its issue; A's detail lists what was merged in.
    const redirect = await fetchWorkerJson<{ mergedInto: string }>(`${api}/issues/${fpB}?startAt=${base}&endAt=${base + HOUR}`, { headers });
    expect(redirect.body).toEqual({ mergedInto: fpA });
    const detail = await fetchWorkerJson<{
      issue: { status: string; note: string; events: number; mergedIssues: Array<{ fingerprint: string; events: number }>; samples: Array<{ id: string; fingerprint: string }> };
    }>(`${api}/issues/${fpA}?startAt=${base}&endAt=${base + HOUR}`, { headers });
    expect(detail.body.issue).toMatchObject({ status: 'ignored', note: 'noise', events: 4 });
    expect(detail.body.issue.mergedIssues.map((row) => [row.fingerprint, row.events]).sort()).toEqual([
      [fpB, 2],
      [fpC, 1],
    ]);
    expect(new Set(detail.body.issue.samples.map((sample) => sample.fingerprint))).toEqual(new Set([fpA]));

    // A new occurrence of B lands in A; state updates addressed to B apply to A.
    await insertError(websiteId, { id: 'b3', sessionId: 'mg-s4', createdAt: base + 10, name: 'TypeError', message: 'B', fingerprint: fpB });
    expect((await listIssues(websiteId, base, base + HOUR)).issues[0]).toMatchObject({ fingerprint: fpA, events: 5 });
    const state = await fetchWorkerJson<{ fingerprint: string }>(`${api}/issues`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fingerprint: fpB, status: 'ignored' }),
    });
    expect(state.body.fingerprint).toBe(fpA);

    // Unmerging B restores it with its own state (resolved after all its events); C stays with A.
    const unmerge = await fetchWorkerJson<{ target: string }>(`${api}/issues/${fpB}/merge`, { method: 'DELETE', headers });
    expect(unmerge.body.target).toBe(fpA);
    const after = await listIssues(websiteId, base, base + HOUR, '');
    expect(after.issues.map((issue) => [issue.fingerprint, issue.events, issue.status])).toEqual([
      [fpB, 3, 'resolved'],
      [fpA, 2, 'ignored'],
    ]);
  });

  it('reopens a resolved issue as regressed once and alerts through the configured channels', async () => {
    const websiteId = await createWebsite();
    const now = Date.now();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('ok', { status: 200 }));
    const headers = await authHeader();
    const api = `/api/websites/${websiteId}/errors`;
    await insertError(websiteId, { id: 'r1', sessionId: 'r-s1', createdAt: now - 2 * HOUR, name: 'TypeError', message: 'boom', fingerprint: CHECKOUT_FP, release: '1.0.0' });
    for (const [name, notifyRegressions] of [['Pager', true], ['Pager copy', true], ['Quiet', false]] as const) {
      await fetchWorkerJson(`${api}/alerts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, threshold: 1000, windowMinutes: 5, channel: 'webhook', target: 'https://hooks.example.com/errors', notifyRegressions }),
      });
    }

    const resolved = await fetchWorkerJson<{ status: string; resolvedAt: number }>(`${api}/issues`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fingerprint: CHECKOUT_FP, status: 'resolved' }),
    });
    expect(resolved.body.status).toBe('resolved');
    expect(await env.CACHE.get(`error-resolved:${websiteId}:${CHECKOUT_FP}`, 'json')).toMatchObject({ issue: CHECKOUT_FP });
    expect(await detectErrorRegressions(env, websiteId)).toEqual([]);

    await insertError(websiteId, { id: 'r2', sessionId: 'r-s2', createdAt: resolved.body.resolvedAt + 1000, name: 'TypeError', message: 'boom', fingerprint: CHECKOUT_FP, release: '1.1.0' });
    const regressions = await detectErrorRegressions(env, websiteId);
    expect(regressions).toEqual([expect.objectContaining({ fingerprint: CHECKOUT_FP, eventId: 'r2', release: '1.1.0' })]);
    // Two rules share a webhook and one opted out: exactly one delivery.
    const hookCalls = fetchSpy.mock.calls.filter(([url]) => String(url).startsWith('https://hooks.example.com'));
    expect(hookCalls).toHaveLength(1);
    expect(JSON.parse(String((hookCalls[0]![1] as RequestInit).body))).toMatchObject({
      type: 'error_regression',
      fingerprint: CHECKOUT_FP,
      release: '1.1.0',
    });
    expect(await env.CACHE.get(`error-resolved:${websiteId}:${CHECKOUT_FP}`)).toBeNull();

    // Every other path (cron again, the ingest report, the list) sees it already regressed.
    expect(await detectErrorRegressions(env, websiteId)).toEqual([]);
    const report = await fetchWorkerJson<{ regressed: boolean }>('/api/internal/errors/regressions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.APP_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteId, fingerprint: CHECKOUT_FP, occurredAt: Date.now() }),
    });
    expect(report.body.regressed).toBe(false);
    const open = await listIssues(websiteId, now - 3 * HOUR, Date.now() + HOUR, 'open');
    expect(open.issues.map((issue) => [issue.fingerprint, issue.status])).toEqual([[CHECKOUT_FP, 'regressed']]);
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).startsWith('https://hooks.example.com'))).toHaveLength(1);

    const detail = await fetchWorkerJson<{ issue: { regressions: Array<{ eventId: string; notifiedAt: number | null }> } }>(
      `${api}/issues/${CHECKOUT_FP}?startAt=${now - 3 * HOUR}&endAt=${Date.now() + HOUR}`,
      { headers },
    );
    expect(detail.body.issue.regressions).toEqual([expect.objectContaining({ eventId: 'r2', notifiedAt: expect.any(Number) })]);

    // Resolving again arms it for the next regression, which ingest can report directly.
    await fetchWorkerJson(`${api}/issues`, { method: 'PATCH', headers, body: JSON.stringify({ fingerprint: CHECKOUT_FP, status: 'resolved' }) });
    const unauthorized = await fetchWorkerJson('/api/internal/errors/regressions', {
      method: 'POST',
      headers: { Authorization: 'Bearer nope', 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteId, fingerprint: CHECKOUT_FP, occurredAt: Date.now() + 1000 }),
    });
    expect(unauthorized.response.status).toBe(401);
    const fastPath = await fetchWorkerJson<{ regressed: boolean }>('/api/internal/errors/regressions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.APP_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteId, fingerprint: CHECKOUT_FP, occurredAt: Date.now() + 1000, release: '1.2.0' }),
    });
    expect(fastPath.body.regressed).toBe(true);
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM error_issue_regression WHERE website_id = ?1`)
      .bind(websiteId)
      .first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it('does not treat occurrences from before the resolve, or legacy events, as regressions', async () => {
    const websiteId = await createWebsite();
    const now = Date.now();
    await insertError(websiteId, { id: 'n1', sessionId: 'n-s1', createdAt: now - HOUR, name: 'TypeError', message: 'late', fingerprint: 'dddddddddddddddd' });
    await insertError(websiteId, { id: 'n2', sessionId: 'n-s1', createdAt: now - HOUR, name: 'RangeError', message: 'legacy 1' });
    for (const fingerprint of ['dddddddddddddddd', messageFingerprint('RangeError', 'legacy 1')]) {
      await env.DB.prepare(
        `INSERT INTO error_issue_state (website_id, fingerprint, status, resolved_at, created_at, updated_at) VALUES (?1, ?2, 'resolved', ?3, ?3, ?3)`,
      )
        .bind(websiteId, fingerprint, now - 2 * HOUR)
        .run();
    }
    // An event timestamped before the resolve but arriving late is not a regression.
    await insertError(websiteId, { id: 'n3', sessionId: 'n-s2', createdAt: now - 3 * HOUR, name: 'TypeError', message: 'late', fingerprint: 'dddddddddddddddd' });
    await env.DB.prepare(`UPDATE error_issue_state SET resolved_at = ?2 WHERE website_id = ?1`).bind(websiteId, now - 30 * 60 * 1000).run();
    expect(await detectErrorRegressions(env, websiteId)).toEqual([]);
    const { issues } = await listIssues(websiteId, now - 4 * HOUR, now);
    expect(issues.map((issue) => issue.status)).toEqual(['resolved', 'resolved']);
  });
});
