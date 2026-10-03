import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../../src/env';
import { getPerformanceReport } from '../../src/lib/advanced-reports';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const testEnv = env as unknown as Env;
const HOUR = 3_600_000;
const DAY_START = Date.UTC(2025, 4, 5);
const AT_10 = DAY_START + 10 * HOUR;
const AT_11 = DAY_START + 11 * HOUR;

// LCP on /a is 1000, 2000, 3000, 4000 (average 2500, p75 3000); /b has one 500 ms load.
const LOADS: Array<[id: string, path: string, at: number, lcp: number, cls: number | null]> = [
  ['perf-a1', '/a', AT_10, 4000, 0.31],
  ['perf-a2', '/a', AT_10 + 60_000, 1000, 0.01],
  ['perf-a3', '/a', AT_10 + 120_000, 3000, 0.2],
  ['perf-a4', '/a', AT_10 + 180_000, 2000, 0.05],
  ['perf-b1', '/b', AT_11, 500, null],
];

describe('performance report', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    const site = testSiteDb(TEST_WEBSITE_ID);
    await site
      .prepare(`INSERT OR IGNORE INTO session (session_id, website_id, browser, country, created_at) VALUES ('perf-s', ?1, 'Chrome', 'DE', ?2)`)
      .bind(TEST_WEBSITE_ID, AT_10)
      .run();
    for (const [id, path, at, lcp, cls] of LOADS) {
      await site
        .prepare(
          `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, lcp, cls)
           VALUES (?1, ?2, 'perf-s', 'perf-s', ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(id, TEST_WEBSITE_ID, at, path, EVENT_TYPE.performance, lcp, cls)
        .run();
    }
  });

  it('reports the 75th percentile (nearest rank), not the average', async () => {
    const report = await getPerformanceReport(testEnv, TEST_WEBSITE_ID, DAY_START, DAY_START + 24 * HOUR - 1);
    expect(report.statistic).toBe('p75');
    expect(report.samples).toBe(5);
    // 500, 1000, 2000, 3000, 4000 → the ⌈0.75·5⌉ = 4th smallest.
    expect(report.lcp).toBe(3000);
    // 0.01, 0.05, 0.2, 0.31 → the 3rd smallest.
    expect(report.cls).toBe(0.2);
    expect(report.inp).toBeNull();
    expect(report.distributions.lcp).toEqual({ good: 3, needsImprovement: 2, poor: 0, total: 5 });
  });

  it('reports p75 per trend bucket and per breakdown row', async () => {
    const report = await getPerformanceReport(testEnv, TEST_WEBSITE_ID, DAY_START, DAY_START + 24 * HOUR - 1);
    expect(report.trends.unit).toBe('hour');
    expect(report.trends.points.map((point) => [point.x, point.lcp, point.samples])).toEqual([
      ['2025-05-05 10:00', 3000, 4],
      ['2025-05-05 11:00', 500, 1],
    ]);
    expect(report.breakdown.url.map((row) => [row.dimension, row.samples, row.lcp, row.cls])).toEqual([
      ['/a', 4, 3000, 0.2],
      ['/b', 1, 500, null],
    ]);
    expect(report.breakdown.browser).toEqual([expect.objectContaining({ dimension: 'Chrome', samples: 5, lcp: 3000 })]);
  });
});
