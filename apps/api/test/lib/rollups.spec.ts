import { describe, expect, it, vi } from 'vitest';
import {
  rollupDailyRangeEligible,
  rollupHourlySeriesEligible,
  rolling24hRange,
  utcCalendarDaysRange,
} from '@flareboard/shared';
import {
  getAggregateMetricsFromRollups,
  getPageviewsFromRollups,
  getWebsiteMetricsSeriesFromRollups,
  getWebsiteStatsFromRollups,
  rollupRangeEligible,
} from '../../src/lib/rollups';
import type { Env } from '../../src/env';

function mockEnv(statements: Array<{ sql: string; result: unknown }>): Env {
  const find = (sql: string) => statements.find((s) => sql.includes(s.sql))?.result;
  const db = {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            first: async () => find(sql),
            all: async () => ({ results: find(sql) }),
            run: async () => ({}),
          };
        },
      };
    },
  };
  return { DB: db } as unknown as Env;
}

function captureEnv() {
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            queries.push({ sql, args });
            return {
              first: async () => ({ count: 0 }),
              all: async () => ({ results: [] as unknown[] }),
              run: async () => ({}),
            };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, queries };
}

describe('rollup eligibility', () => {
  it('calendar presets are daily-rollups eligible', () => {
    const { startAt, endAt } = utcCalendarDaysRange(30);
    expect(rollupRangeEligible(startAt, endAt)).toBe(true);
    expect(rollupDailyRangeEligible(startAt, endAt)).toBe(true);
  });

  it('rolling 24h is hourly-series eligible only', () => {
    const { startAt, endAt } = rolling24hRange();
    expect(rollupDailyRangeEligible(startAt, endAt)).toBe(false);
    expect(rollupHourlySeriesEligible(startAt, endAt)).toBe(true);
  });
});

describe('getWebsiteStatsFromRollups', () => {
  it('returns null for rolling windows', async () => {
    const { startAt, endAt } = rolling24hRange();
    const result = await getWebsiteStatsFromRollups(mockEnv([]), 'site-1', startAt, endAt);
    expect(result).toBeNull();
  });

  it('returns stats when rollup days are complete', async () => {
    const { startAt, endAt } = utcCalendarDaysRange(2);
    const days = ['2026-07-06', '2026-07-07'];
    const env = mockEnv([
      { sql: 'COUNT(*) as count FROM rollup_stats_daily', result: { count: 2 } },
      {
        sql: 'FROM rollup_stats_daily',
        result: { pageviews: 10, visitors: 4, visits: 5, bounces: 1, totaltime_sec: 100 },
      },
    ]);
    const result = await getWebsiteStatsFromRollups(env, 'site-1', startAt, endAt);
    expect(result?.pageviews.value).toBe(10);
    expect(days.length).toBeGreaterThan(0);
  });
});

describe('getPageviewsFromRollups', () => {
  it('uses hourly rollups for rolling 24h', async () => {
    const { startAt, endAt } = rolling24hRange(Date.parse('2026-07-07T12:00:00.000Z'));
    const env = mockEnv([
      {
        sql: 'FROM rollup_pageview_series',
        result: [{ bucket: '2026-07-07 11:00', pageviews: 3 }],
      },
    ]);
    const result = await getPageviewsFromRollups(env, 'site-1', startAt, endAt, 'hour');
    expect(result?.pageviews).toEqual([{ x: '2026-07-07 11:00', y: 3 }]);
  });
});

describe('getWebsiteMetricsSeriesFromRollups', () => {
  it('returns combined pageview and visitor series for UTC calendar days', async () => {
    const { startAt, endAt } = utcCalendarDaysRange(2, Date.parse('2026-07-07T12:00:00.000Z'));
    const env = mockEnv([
      { sql: 'COUNT(*) as count FROM rollup_stats_daily', result: { count: 2 } },
      {
        sql: 'FROM rollup_pageview_series',
        result: [
          { bucket: '2026-07-06', pageviews: 5 },
          { bucket: '2026-07-07', pageviews: 8 },
        ],
      },
      {
        sql: 'FROM rollup_session_day',
        result: [
          { x: '2026-07-06', y: 2 },
          { x: '2026-07-07', y: 3 },
        ],
      },
    ]);
    const result = await getWebsiteMetricsSeriesFromRollups(env, 'site-1', startAt, endAt, 'day');
    expect(result?.pageviews).toHaveLength(2);
    expect(result?.visitors).toEqual([
      { x: '2026-07-06', y: 2 },
      { x: '2026-07-07', y: 3 },
    ]);
  });
});

describe('getAggregateMetricsFromRollups', () => {
  it('uses sequential D1 placeholders for multi-site hourly queries', async () => {
    const { startAt, endAt } = rolling24hRange(Date.parse('2026-07-07T12:00:00.000Z'));
    const { env, queries } = captureEnv();
    await getAggregateMetricsFromRollups(env, ['site-a', 'site-b'], startAt, endAt, 'hour');
    expect(queries).toHaveLength(2);
    for (const { sql, args } of queries) {
      expect(sql).toContain('website_id IN (?1, ?2) AND unit = ?3 AND bucket >= ?4 AND bucket <= ?5');
      expect(sql).not.toMatch(/IN \(\?\)[^?]*\?1/);
      expect(args).toEqual(['site-a', 'site-b', 'hour', expect.any(String), expect.any(String)]);
    }
  });
});
