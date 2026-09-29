import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../../src/env';
import { escapeLike, logSources } from '../../src/lib/log-sources';
import {
  countLogs,
  createLogAlertRule,
  evaluateLogAlertRules,
  getLogEvents,
  getLogHistogram,
  getLogStats,
  getTraceDetail,
  getTraceSummaries,
  histogramBucketMs,
  tailLogs,
} from '../../src/lib/logs';
import { runRetentionPurge } from '../../src/lib/retention';
import { siteStoreStub } from '../../src/lib/site-db';
import { applyTestMigrations } from '../helpers/migrations';
import { seedBrowserLog, seedOtlpLog, seedSpan } from '../helpers/otel-seed';
import { testSiteDb } from '../helpers/site-db';

const BASE = Date.UTC(2026, 8, 1, 12);
const MIN = 60_000;
const DAY = 86_400_000;
const testEnv = env as unknown as Env;

describe('unified log queries (OTLP + tracker logs)', () => {
  const SITE = 'otel-unified-site';

  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedOtlpLog(SITE, {
      id: 'otlp-1',
      at: BASE + 1000,
      severity: 'error',
      body: 'Payment 50% off failed',
      service: 'checkout',
      environment: 'production',
      release: '2.0.0',
      traceId: '5b8efff798038103d269b633813fc60c',
      sessionId: 'sess-a',
      attributes: { 'http.status_code': 502, retry: true, 'user.plan': 'pro' },
      resource: { 'host.name': 'web-1' },
    });
    await seedOtlpLog(SITE, { id: 'otlp-2', at: BASE + 3000, severity: 'debug', body: 'Payment 500 off', service: 'checkout' });
    await seedOtlpLog(SITE, { id: 'otlp-3', at: BASE + 5000, severity: 'warn', body: 'path a_b\\c', service: 'search' });
    await seedBrowserLog(SITE, {
      id: 'browser-1',
      at: BASE + 2000,
      level: 'warning',
      message: 'Coupon rejected',
      sessionId: 'sess-a',
      props: { release: '2.0.0', environment: 'production' },
    });
    await seedBrowserLog(SITE, { id: 'browser-2', at: BASE + 4000, level: 'error', message: 'Checkout crashed' });
  });

  it('merges both sources newest first with the same row shape', async () => {
    const rows = await getLogEvents(testEnv, SITE, BASE, BASE + 10_000);
    expect(rows.map((row) => [row.id, row.source, row.level])).toEqual([
      ['otlp-3', 'otlp', 'warn'],
      ['browser-2', 'browser', 'error'],
      ['otlp-2', 'otlp', 'debug'],
      ['browser-1', 'browser', 'warn'],
      ['otlp-1', 'otlp', 'error'],
    ]);
    expect(rows.find((row) => row.id === 'otlp-1')).toMatchObject({
      message: 'Payment 50% off failed',
      service: 'checkout',
      release: '2.0.0',
      environment: 'production',
      sessionId: 'sess-a',
      attributes: { 'http.status_code': 502, retry: true, 'user.plan': 'pro' },
      resource: { 'host.name': 'web-1' },
    });
    expect(rows.find((row) => row.id === 'browser-1')).toMatchObject({
      message: 'Coupon rejected',
      severityText: 'warning',
      sessionId: 'sess-a',
      urlPath: '/app',
      attributes: { level: 'warning', message: 'Coupon rejected', release: '2.0.0', environment: 'production' },
    });
  });

  it('pages with a before cursor', async () => {
    const first = await getLogEvents(testEnv, SITE, BASE, BASE + 10_000, {}, 2);
    const last = first[first.length - 1]!;
    const next = await getLogEvents(testEnv, SITE, BASE, BASE + 10_000, {}, 2, { timeUs: last.timeUs, id: last.id });
    const rest = await getLogEvents(testEnv, SITE, BASE, BASE + 10_000, {}, 10, {
      timeUs: next[1]!.timeUs,
      id: next[1]!.id,
    });
    expect([...first, ...next, ...rest].map((row) => row.id)).toEqual(['otlp-3', 'browser-2', 'otlp-2', 'browser-1', 'otlp-1']);
  });

  it('treats search text literally (LIKE wildcards escaped)', async () => {
    const ids = async (search: string) =>
      (await getLogEvents(testEnv, SITE, BASE, BASE + 10_000, { search })).map((row) => row.id);
    expect(await ids('50%')).toEqual(['otlp-1']);
    expect(await ids('payment 50')).toEqual(['otlp-2', 'otlp-1']);
    expect(await ids('a_b')).toEqual(['otlp-3']);
    expect(await ids('a%b')).toEqual([]);
    expect(await ids('b\\c')).toEqual(['otlp-3']);
    expect(await ids('CHECKOUT')).toEqual(['browser-2']);
    expect(escapeLike('50%_\\')).toBe('50\\%\\_\\\\');
  });

  it('filters by severities, service, source, session and trace id', async () => {
    const ids = async (filters: Parameters<typeof getLogEvents>[4]) =>
      (await getLogEvents(testEnv, SITE, BASE, BASE + 10_000, filters)).map((row) => row.id);
    expect(await ids({ levels: ['error', 'fatal'] })).toEqual(['browser-2', 'otlp-1']);
    expect(await ids({ levels: ['warn'] })).toEqual(['otlp-3', 'browser-1']);
    expect(await ids({ service: 'checkout' })).toEqual(['otlp-2', 'otlp-1']);
    expect(await ids({ source: 'browser' })).toEqual(['browser-2', 'browser-1']);
    expect(await ids({ sessionId: 'sess-a' })).toEqual(['browser-1', 'otlp-1']);
    expect(await ids({ traceId: '5B8EFFF798038103D269B633813FC60C' })).toEqual(['otlp-1']);
    expect(await ids({ release: '2.0.0', environment: 'production' })).toEqual(['browser-1', 'otlp-1']);
  });

  it('filters by record and resource attributes', async () => {
    const ids = async (attributes: Array<{ key: string; value?: string }>) =>
      (await getLogEvents(testEnv, SITE, BASE, BASE + 10_000, { attributes })).map((row) => row.id);
    expect(await ids([{ key: 'http.status_code', value: '502' }])).toEqual(['otlp-1']);
    expect(await ids([{ key: 'retry', value: 'true' }])).toEqual(['otlp-1']);
    expect(await ids([{ key: 'user.plan', value: 'free' }])).toEqual([]);
    expect(await ids([{ key: 'host.name', value: 'web-1' }])).toEqual(['otlp-1']);
    expect(await ids([{ key: 'host.name' }])).toEqual(['otlp-1']);
    // Tracker properties are attributes too.
    expect(await ids([{ key: 'release', value: '2.0.0' }])).toEqual(['browser-1']);
    // Keys are bound, never spliced into SQL.
    expect(await ids([{ key: `x') OR 1=1 --`, value: 'y' }])).toEqual([]);
  });

  it('counts by severity per time bucket', async () => {
    const histogram = await getLogHistogram(testEnv, SITE, BASE, BASE + 10_000);
    expect(histogram.bucketMs).toBe(1000);
    expect(histogram.buckets).toHaveLength(11);
    expect(histogram.buckets.filter((bucket) => bucket.total).map((bucket) => [bucket.t - BASE, bucket.total])).toEqual([
      [1000, 1],
      [2000, 1],
      [3000, 1],
      [4000, 1],
      [5000, 1],
    ]);
    expect(histogram.buckets.find((bucket) => bucket.t === BASE + 2000)).toMatchObject({ warn: 1, error: 0 });

    const errors = await getLogHistogram(testEnv, SITE, BASE, BASE + 10_000, { levels: ['error'] });
    expect(errors.buckets.reduce((sum, bucket) => sum + bucket.error, 0)).toBe(2);
    expect(errors.buckets.reduce((sum, bucket) => sum + bucket.total, 0)).toBe(2);
  });

  it('picks bucket sizes that give at most ~60 bars', () => {
    expect(histogramBucketMs(0, 60 * MIN)).toBe(MIN);
    expect(histogramBucketMs(0, DAY)).toBe(30 * MIN);
    expect(histogramBucketMs(0, 7 * DAY)).toBe(3 * 3_600_000);
    expect(histogramBucketMs(0, 90 * DAY)).toBe(DAY * 7);
  });

  it('reports totals and facets across sources', async () => {
    const stats = await getLogStats(testEnv, SITE, BASE, BASE + 10_000);
    expect(stats).toMatchObject({
      logs: 5,
      // sess-a (an OTLP line and a tracker line) and browser-2's session.
      sessions: 2,
      lastSeenAt: BASE + 5000,
      services: [
        { service: 'checkout', logs: 2 },
        { service: 'search', logs: 1 },
      ],
      releases: [{ release: '2.0.0', logs: 2 }],
    });
    expect(stats.levels).toEqual([
      { level: 'error', logs: 2 },
      { level: 'warn', logs: 2 },
      { level: 'debug', logs: 1 },
    ]);
  });

  it('uses each table index through the UNION ALL', async () => {
    const sources = logSources(testEnv, SITE);
    const plan = await sources.db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT COUNT(*) FROM (${sources.logArms.otlp} UNION ALL ${sources.logArms.browser}) l
         WHERE l.created_at >= ?2 AND l.created_at <= ?3`,
      )
      .bind(SITE, BASE, BASE + 10_000)
      .all<{ detail: string }>();
    const details = (plan.results ?? []).map((row) => row.detail).join('\n');
    expect(details).toMatch(/SEARCH r USING (COVERING )?INDEX log_record_created_idx/);
    expect(details).toMatch(/SEARCH e USING INDEX website_event_website_type_created_idx/);
  });
});

describe('live tail', () => {
  const SITE = 'otel-tail-site';

  it('returns exactly the lines stored since the cursor, including late ones', async () => {
    const now = Date.now();
    await seedOtlpLog(SITE, { id: 'tail-a', at: now - 3000, body: 'a' });
    await seedBrowserLog(SITE, { id: 'tail-b', at: now - 2000, message: 'b' });

    const opened = await tailLogs(testEnv, SITE, 0, {}, 100);
    expect(opened.logs.map((row) => row.id)).toEqual(['tail-a', 'tail-b']);

    // A batch exported late: stamped before the lines already shown.
    await seedOtlpLog(SITE, { id: 'tail-late', at: now - 10_000, body: 'late', severity: 'error' });
    await seedOtlpLog(SITE, { id: 'tail-c', at: now - 1000, body: 'c' });
    await seedBrowserLog(SITE, { id: 'tail-d', at: now, message: 'd' });

    const seq = { otlp: 0, browser: 0, ...Object.fromEntries(opened.seq.split('.').map((n, i) => [i ? 'browser' : 'otlp', Number(n)])) };
    const polled = await tailLogs(testEnv, SITE, opened.cursor, {}, 100, seq);
    expect(polled.logs.map((row) => row.id)).toEqual(['tail-late', 'tail-c', 'tail-d']);

    const [otlp, browser] = polled.seq.split('.').map(Number);
    const again = await tailLogs(testEnv, SITE, polled.cursor, {}, 100, { otlp, browser });
    expect(again.logs).toEqual([]);
    expect(again.seq).toBe(polled.seq);

    const errorsOnly = await tailLogs(testEnv, SITE, opened.cursor, { levels: ['error'] }, 100, seq);
    expect(errorsOnly.logs.map((row) => row.id)).toEqual(['tail-late']);
  });
});

describe('OTLP traces', () => {
  const SITE = 'otel-trace-site';
  const TRACE = '0af7651916cd43dd8448eb211c80319c';
  const OTHER = '11111111111111111111111111111111';

  beforeAll(async () => {
    await seedSpan(SITE, { traceId: TRACE, spanId: 'aaaaaaaaaaaaaaa1', name: 'GET /checkout', service: 'web', startMs: BASE, durationMs: 250, sessionId: 'sess-t' });
    await seedSpan(SITE, {
      traceId: TRACE,
      spanId: 'aaaaaaaaaaaaaaa2',
      parentSpanId: 'aaaaaaaaaaaaaaa1',
      name: 'charge card',
      service: 'payments',
      startMs: BASE + 20,
      durationMs: 300,
      status: 'error',
      events: [{ name: 'exception', timeUs: (BASE + 30) * 1000, attributes: { 'exception.message': 'declined' } }],
    });
    await seedSpan(SITE, { traceId: OTHER, spanId: 'bbbbbbbbbbbbbbb1', name: 'GET /health', service: 'web', startMs: BASE + 5000, durationMs: 2 });
    await seedOtlpLog(SITE, { id: 'trace-log', at: BASE + 25, severity: 'error', body: 'card declined', service: 'payments', traceId: TRACE, spanId: 'aaaaaaaaaaaaaaa2' });
  });

  it('summarizes traces from their spans', async () => {
    const traces = await getTraceSummaries(testEnv, SITE, BASE - 1000, BASE + 10_000);
    expect(traces).toEqual([
      expect.objectContaining({ traceId: OTHER, spans: 1, hasError: false, rootName: 'GET /health' }),
      expect.objectContaining({
        traceId: TRACE,
        spans: 2,
        services: 2,
        rootName: 'GET /checkout',
        rootService: 'web',
        startedAt: BASE,
        durationMs: 320,
        maxSpanDurationMs: 300,
        hasError: true,
        sessionId: 'sess-t',
      }),
    ]);
  });

  it('filters traces by any span, keeping whole-trace totals', async () => {
    const byService = await getTraceSummaries(testEnv, SITE, BASE - 1000, BASE + 10_000, { service: 'payments' });
    expect(byService.map((trace) => [trace.traceId, trace.spans])).toEqual([[TRACE, 2]]);
    const errors = await getTraceSummaries(testEnv, SITE, BASE - 1000, BASE + 10_000, { errorsOnly: true });
    expect(errors.map((trace) => trace.traceId)).toEqual([TRACE]);
    const byName = await getTraceSummaries(testEnv, SITE, BASE - 1000, BASE + 10_000, { search: 'health' });
    expect(byName.map((trace) => trace.traceId)).toEqual([OTHER]);
  });

  it('returns the waterfall and the trace logs', async () => {
    const detail = await getTraceDetail(testEnv, SITE, TRACE.toUpperCase());
    expect(detail).toMatchObject({
      traceId: TRACE,
      startedAt: BASE,
      endedAt: BASE + 320,
      durationMs: 320,
      services: ['web', 'payments'],
      sessionId: 'sess-t',
      spans: [
        { spanId: 'aaaaaaaaaaaaaaa1', parentSpanId: null, name: 'GET /checkout', durationUs: 250_000, status: 'unset' },
        {
          spanId: 'aaaaaaaaaaaaaaa2',
          parentSpanId: 'aaaaaaaaaaaaaaa1',
          startUs: (BASE + 20) * 1000,
          status: 'error',
          events: [{ name: 'exception', attributes: { 'exception.message': 'declined' } }],
        },
      ],
      logs: [{ id: 'trace-log', message: 'card declined' }],
    });
    expect(await getTraceDetail(testEnv, SITE, 'ffffffffffffffffffffffffffffffff')).toBeNull();
  });
});

describe('log alerts on OTLP logs', () => {
  it('counts matching lines, attribute filters included, and records the alert', async () => {
    await applyTestMigrations(env.DB);
    const site = '00000000-0000-0000-0000-00000000a1e7';
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, created_at, updated_at) VALUES (?1, 'Alerts', 'a.example', 0, 0)`,
    )
      .bind(site)
      .run();
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      await seedOtlpLog(site, { id: `alert-${i}`, at: now - 1000 * i, severity: 'error', body: 'upstream timeout', attributes: { route: i ? '/pay' : '/cart' } });
    }
    expect(await countLogs(testEnv, site, now - MIN, now, { levels: ['error'], attributes: [{ key: 'route', value: '/pay' }] })).toBe(2);

    await createLogAlertRule(testEnv, site, {
      name: 'Pay timeouts',
      enabled: true,
      threshold: 2,
      windowMinutes: 5,
      level: 'error',
      search: 'timeout',
      attributeKey: 'route',
      attributeValue: '/pay',
      channel: 'record',
    });
    await createLogAlertRule(testEnv, site, {
      name: 'Cart timeouts',
      enabled: true,
      threshold: 2,
      windowMinutes: 5,
      attributeKey: 'route',
      attributeValue: '/cart',
      channel: 'record',
    });
    const triggered = await evaluateLogAlertRules(testEnv, site, now);
    expect(triggered).toEqual([expect.objectContaining({ count: 2, threshold: 2 })]);
  });
});

describe('OTLP retention', () => {
  it('applies a website retention shorter than 30 days', async () => {
    await applyTestMigrations(env.DB);
    const site = 'otel-retention-site';
    const now = Date.now();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO website (website_id, name, retention_days, created_at, updated_at) VALUES (?1, 'R', 7, ?2, ?2)`,
    )
      .bind(site, now)
      .run();
    await seedOtlpLog(site, { id: 'ret-old', at: now - 10 * DAY });
    await seedOtlpLog(site, { id: 'ret-new', at: now - DAY });
    await seedSpan(site, { traceId: TRACE_R, spanId: 'ccccccccccccccc1', name: 'old', startMs: now - 10 * DAY, durationMs: 1 });
    await seedSpan(site, { traceId: TRACE_R, spanId: 'ccccccccccccccc2', name: 'new', startMs: now - DAY, durationMs: 1 });

    // The cron walks sites from a KV cursor; run it until this one has been visited.
    for (let i = 0; i < 20; i++) {
      await runRetentionPurge(testEnv, now);
      const left = await testSiteDb(site).prepare('SELECT COUNT(*) AS n FROM log_record').first<number>('n');
      if (left === 1) break;
    }
    const logs = await testSiteDb(site).prepare('SELECT log_id AS id FROM log_record').all<{ id: string }>();
    expect(logs.results.map((row) => row.id)).toEqual(['ret-new']);
    const spans = await testSiteDb(site).prepare('SELECT name FROM trace_span').all<{ name: string }>();
    expect(spans.results.map((row) => row.name)).toEqual(['new']);
  });

  it('drops anything older than 30 days in the store alarm', async () => {
    const site = 'otel-alarm-site';
    const now = Date.now();
    await seedOtlpLog(site, { id: 'alarm-old', at: now - 31 * DAY });
    await seedOtlpLog(site, { id: 'alarm-new', at: now - 29 * DAY });
    await seedSpan(site, { traceId: TRACE_R, spanId: 'ddddddddddddddd1', name: 'old', startMs: now - 31 * DAY, durationMs: 1 });

    expect(await runDurableObjectAlarm(siteStoreStub(testEnv, site))).toBe(true);
    const logs = await testSiteDb(site).prepare('SELECT log_id AS id FROM log_record').all<{ id: string }>();
    expect(logs.results.map((row) => row.id)).toEqual(['alarm-new']);
    expect(await testSiteDb(site).prepare('SELECT COUNT(*) AS n FROM trace_span').first('n')).toBe(0);
  });
});

const TRACE_R = '22222222222222222222222222222222';

describe('legacy EVENT_STORE=d1', () => {
  it('reads tracker logs from D1 and reports OTLP as unavailable', async () => {
    await applyTestMigrations(env.DB);
    const site = 'otel-d1-site';
    const d1Env = { ...testEnv, EVENT_STORE: 'd1' } as Env;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, created_at, updated_at) VALUES (?1, 'D1', 'd1.example', 0, 0)`,
    )
      .bind(site)
      .run();
    await env.DB.prepare(`INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES ('d1-session', ?1, ?2)`)
      .bind(site, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES ('d1-log', ?1, 'd1-session', 'd1-session', ?2, '/', ?3, 'log')`,
    )
      .bind(site, BASE, EVENT_TYPE.log)
      .run();
    await env.DB.prepare(
      `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, data_type, created_at)
       VALUES ('d1-log-level', ?1, 'd1-log', 'level', 'error', NULL, 1, ?2),
              ('d1-log-message', ?1, 'd1-log', 'message', 'legacy line', NULL, 1, ?2),
              ('d1-log-status', ?1, 'd1-log', 'status', NULL, 503, 2, ?2)`,
    )
      .bind(site, BASE)
      .run();

    expect(logSources(d1Env, site).otlp).toBe(false);
    const rows = await getLogEvents(d1Env, site, BASE - 1000, BASE + 1000, { attributes: [{ key: 'status', value: '503' }] });
    expect(rows).toEqual([
      expect.objectContaining({ id: 'd1-log', source: 'browser', level: 'error', message: 'legacy line', attributes: { level: 'error', message: 'legacy line', status: 503 } }),
    ]);
    const histogram = await getLogHistogram(d1Env, site, BASE - 1000, BASE + 1000);
    expect(histogram.buckets.reduce((sum, bucket) => sum + bucket.error, 0)).toBe(1);
  });
});
