import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  FunnelResult,
  InsightQuery,
  LifecycleResult,
  PropertyFilter,
  RetentionResult,
  StickinessResult,
  TrendResult,
} from '@flareboard/shared';
import { runInsightFunnelActors, runInsightQuery } from '../../src/lib/insights';
import { InsightQueryError } from '../../src/lib/property-filters';
import { cohortMemberSubquery } from '../../src/lib/cohorts';
import { getFunnelReport } from '../../src/lib/advanced-reports';
import { DAY, DAY0, FIXTURE_SITE, MIN, RANGE, seedInsightFixture, T0 } from '../helpers/insight-fixture';

const UTC = { timezone: 'UTC' };

async function trend(query: Omit<InsightQuery, 'version'>, range = RANGE, timezone = 'UTC') {
  return (await runInsightQuery(env, FIXTURE_SITE, 'trend', { version: 2, ...query }, range.startAt, range.endAt, {
    timezone,
  })) as TrendResult;
}

/** Total signups matching one filter. */
async function signupsWhere(filter: PropertyFilter) {
  const result = await trend({ series: [{ kind: 'event', event: 'signup', math: 'total', filters: [filter] }] });
  return result.results[0]!.total;
}

async function funnel(query: Omit<InsightQuery, 'version'>) {
  return (await runInsightQuery(env, FIXTURE_SITE, 'funnel', { version: 2, ...query }, RANGE.startAt, RANGE.endAt, UTC)) as FunnelResult;
}

const SIGNUP_PURCHASE = [
  { kind: 'event' as const, event: 'signup' },
  { kind: 'event' as const, event: 'purchase' },
];

describe('insight engines', () => {
  beforeAll(seedInsightFixture);

  describe('property filters', () => {
    it('supports every operator on event properties', async () => {
      const cases: Array<[PropertyFilter, number]> = [
        [{ type: 'event', key: 'source', operator: 'is', value: ['ads'] }, 3],
        [{ type: 'event', key: 'source', operator: 'is', value: ['ads', 'organic'] }, 4],
        [{ type: 'event', key: 'source', operator: 'is_not', value: ['ads'] }, 3],
        [{ type: 'event', key: 'source', operator: 'contains', value: 'ads' }, 4],
        [{ type: 'event', key: 'source', operator: 'not_contains', value: 'ads' }, 2],
        [{ type: 'event', key: 'source', operator: 'regex', value: '^ads$' }, 3],
        [{ type: 'event', key: 'source', operator: 'regex', value: '^Ads_\\d$' }, 1],
        [{ type: 'event', key: 'source', operator: 'not_regex', value: '^ads$' }, 3],
        [{ type: 'event', key: 'amount', operator: 'is_set' }, 2],
        [{ type: 'event', key: 'amount', operator: 'is_not_set' }, 4],
        [{ type: 'event', key: 'amount', operator: 'is', value: '20' }, 1],
        [{ type: 'event', key: 'amount', operator: 'gt', value: 15 }, 1],
        [{ type: 'event', key: 'amount', operator: 'lt', value: 15 }, 1],
        [{ type: 'event', key: 'amount', operator: 'between', value: [10, 20] }, 2],
      ];
      for (const [filter, expected] of cases) {
        expect(await signupsWhere(filter), `${filter.operator} ${JSON.stringify(filter.value)}`).toBe(expected);
      }
    });

    it('supports person properties through the distinct id', async () => {
      const cases: Array<[PropertyFilter, number]> = [
        [{ type: 'person', key: 'plan', operator: 'is', value: 'pro' }, 3],
        [{ type: 'person', key: 'plan', operator: 'is_not', value: 'pro' }, 3],
        [{ type: 'person', key: 'seats', operator: 'gt', value: 4 }, 3],
        [{ type: 'person', key: 'seats', operator: 'between', value: [1, 5] }, 3],
        [{ type: 'person', key: 'seats', operator: 'is', value: 12 }, 1],
        [{ type: 'person', key: 'beta', operator: 'is', value: true }, 2],
        [{ type: 'person', key: 'email', operator: 'is_not_set' }, 3],
        [{ type: 'person', key: 'email', operator: 'contains', value: '@acme' }, 2],
        [{ type: 'person', key: 'email', operator: 'regex', value: '@example\\.com$' }, 1],
      ];
      for (const [filter, expected] of cases) {
        expect(await signupsWhere(filter), `${filter.key} ${filter.operator}`).toBe(expected);
      }
    });

    it('supports dimension filters and escapes LIKE wildcards', async () => {
      const pageviews = async (filter: PropertyFilter) =>
        (await trend({ series: [{ kind: 'pageview', math: 'total', filters: [filter] }] })).results[0]!.total;
      expect(await pageviews({ type: 'dimension', key: 'path', operator: 'regex', value: '^/blog/.*' })).toBe(1);
      expect(await pageviews({ type: 'dimension', key: 'country', operator: 'is', value: ['US'] })).toBe(4);
      expect(await pageviews({ type: 'dimension', key: 'path', operator: 'contains', value: '%' })).toBe(0);
      expect(await pageviews({ type: 'dimension', key: 'path', operator: 'is_not', value: ['/pricing'] })).toBe(2);
    });

    it('rejects queries that would exceed the bound-parameter limit', async () => {
      const many = Array.from({ length: 10 }, (_, i) => ({
        type: 'event' as const,
        key: `k${i}`,
        operator: 'is' as const,
        value: Array.from({ length: 10 }, (_, j) => String(i * 100 + j)),
      }));
      await expect(trend({ series: [{ kind: 'event', event: 'signup', math: 'total' }], filters: many })).rejects.toBeInstanceOf(
        InsightQueryError,
      );
    });
  });

  describe('trends', () => {
    it('fills every bucket and supports each math', async () => {
      const result = await trend({
        interval: 'day',
        series: [
          { kind: 'event', event: 'signup', math: 'total' },
          { kind: 'event', event: 'signup', math: 'unique_users' },
          { kind: 'event', event: 'signup', math: 'unique_sessions' },
          { kind: 'event', event: 'purchase', math: 'sum', mathProperty: 'amount' },
          { kind: 'event', event: 'purchase', math: 'median', mathProperty: 'amount' },
        ],
      });
      expect(result.labels).toEqual(['2026-02-02', '2026-02-03', '2026-02-04']);
      expect(result.results.map((r) => [r.key, r.data, r.total])).toEqual([
        ['A', [4, 2, 0], 6],
        ['B', [4, 2, 0], 5],
        ['C', [4, 2, 0], 6],
        ['D', [150, 0, 30], 180],
        ['E', [75, 0, 30], 50],
      ]);
      // Legacy { x, y } points of the first series.
      expect(result.series[0]).toEqual({ x: '2026-02-02', y: 4 });

      const stats = await trend({
        series: (['avg', 'min', 'max'] as const).map((math) => ({ kind: 'event' as const, event: 'purchase', math, mathProperty: 'amount' })),
      });
      expect(stats.results.map((r) => r.total)).toEqual([60, 30, 100]);
    });

    it('counts pageviews filtered by URL', async () => {
      const result = await trend({ series: [{ kind: 'pageview', math: 'total', url: { match: 'exact', value: '/pricing' } }] });
      expect(result.results[0]!.data).toEqual([1, 1, 0]);
    });

    it('breaks down by event property, person property and dimension', async () => {
      const bySource = await trend({
        series: [{ kind: 'event', event: 'signup', math: 'total' }],
        breakdown: { type: 'event', key: 'source' },
      });
      expect(bySource.results.map((r) => [r.breakdownValue, r.total])).toEqual([
        ['ads', 3],
        [null, 1],
        ['Ads_2', 1],
        ['organic', 1],
      ]);

      const byPlan = await trend({
        series: [{ kind: 'event', event: 'signup', math: 'unique_users' }],
        breakdown: { type: 'person', key: 'plan' },
      });
      expect(Object.fromEntries(byPlan.results.map((r) => [String(r.breakdownValue), r.total]))).toEqual({
        pro: 2,
        free: 1,
        team: 1,
        null: 1,
      });

      const byCountry = await trend({
        series: [{ kind: 'event', event: 'signup', math: 'total' }],
        breakdown: { type: 'dimension', key: 'country' },
      });
      expect(byCountry.results.map((r) => [r.breakdownValue, r.total])).toEqual([
        ['US', 4],
        ['DE', 1],
        ['FR', 1],
      ]);
    });

    it('keeps the top 10 breakdown values and folds the rest into Other', async () => {
      const result = await trend({
        series: [{ kind: 'event', event: 'tick', math: 'total' }],
        breakdown: { type: 'event', key: 'k' },
      });
      expect(result.results).toHaveLength(11);
      expect(result.results[0]).toMatchObject({ breakdownValue: 'v1', total: 3 });
      expect(result.results.at(-1)).toMatchObject({ isOther: true, breakdownValue: null, total: 2 });
    });

    it('evaluates formulas per bucket and on totals', async () => {
      const result = await trend({
        series: [
          { kind: 'event', event: 'signup', math: 'total' },
          { kind: 'event', event: 'purchase', math: 'total' },
        ],
        formula: 'A / B * 100',
      });
      expect(result.results[0]).toMatchObject({ key: 'formula', data: [200, 0, 0], total: 200 });
      // The underlying series follow the formula line.
      expect(result.results.slice(1).map((r) => r.key)).toEqual(['A', 'B']);
    });

    it('compares with the previous period', async () => {
      const result = await trend({ series: [{ kind: 'event', event: 'signup', math: 'total' }], compare: true });
      expect(result.compare).toMatchObject({ endAt: RANGE.startAt - 1 });
      expect(result.compare!.labels).toEqual(['2026-01-30', '2026-01-31', '2026-02-01']);
      expect(result.compare!.results[0]!.data).toEqual([0, 0, 1]);
    });

    it('buckets hours, weeks and months in the site timezone', async () => {
      // 10:00 UTC is 19:00 in Tokyo; alice's purchase at 10:30 UTC is 19:30.
      const tokyo = await trend(
        { interval: 'hour', series: [{ kind: 'event', event: 'purchase', math: 'total' }] },
        { startAt: T0 - 2 * 60 * MIN, endAt: T0 + 60 * MIN - 1 },
        'Asia/Tokyo',
      );
      expect(tokyo.labels).toEqual(['2026-02-02 17:00', '2026-02-02 18:00', '2026-02-02 19:00']);
      expect(tokyo.results[0]!.data).toEqual([0, 0, 2]);

      const weekly = await trend({ interval: 'week', series: [{ kind: 'event', event: 'signup', math: 'total' }] });
      expect(weekly.labels).toEqual(['2026-02-01']);
      expect(weekly.results[0]!.data).toEqual([6]);

      const monthly = await trend(
        { interval: 'month', series: [{ kind: 'event', event: 'signup', math: 'total' }] },
        { startAt: DAY0 - 5 * DAY, endAt: RANGE.endAt },
      );
      expect(monthly.labels).toEqual(['2026-01', '2026-02']);
      // Dave's day -1 signup is on Feb 1.
      expect(monthly.results[0]!.data).toEqual([0, 7]);
    });
  });

  describe('funnels', () => {
    it('counts people in strict order within the conversion window', async () => {
      const hour = await funnel({ funnel: { steps: SIGNUP_PURCHASE, window: { value: 1, unit: 'hour' } } });
      expect(hour.steps.map((s) => s.count)).toEqual([5, 1]);
      expect(hour.steps[1]).toMatchObject({ avgTimeToConvertMs: 20 * MIN, medianTimeToConvertMs: 20 * MIN, droppedOff: 4 });

      const week = await funnel({ funnel: { steps: SIGNUP_PURCHASE, window: { value: 7, unit: 'day' } } });
      expect(week.steps.map((s) => s.count)).toEqual([5, 2]);
      expect(week.steps[1]!.avgTimeToConvertMs).toBe((20 * MIN + 2 * DAY) / 2);
      expect(week.conversion).toBe(40);
    });

    it('supports any order', async () => {
      const hour = await funnel({ funnel: { steps: SIGNUP_PURCHASE, order: 'any', window: { value: 1, unit: 'hour' } } });
      expect(hour.steps.map((s) => s.count)).toEqual([5, 2]);
      const week = await funnel({ funnel: { steps: SIGNUP_PURCHASE, order: 'any', window: { value: 7, unit: 'day' } } });
      expect(week.steps.map((s) => s.count)).toEqual([5, 3]);
    });

    it('counts sessions when asked', async () => {
      const result = await funnel({ countBy: 'session', funnel: { steps: SIGNUP_PURCHASE, window: { value: 7, unit: 'day' } } });
      expect(result.steps.map((s) => s.count)).toEqual([6, 1]);
    });

    it('matches pageview steps by URL', async () => {
      const contains = await funnel({
        funnel: { steps: [{ kind: 'pageview', url: { match: 'contains', value: 'pric' } }, { kind: 'event', event: 'signup' }] },
      });
      expect(contains.steps.map((s) => s.count)).toEqual([1, 1]);
      const regex = await funnel({
        funnel: { steps: [{ kind: 'pageview', url: { match: 'regex', value: '^/blog/.*' } }, { kind: 'event', event: 'signup' }] },
      });
      expect(regex.steps.map((s) => s.count)).toEqual([1, 1]);
    });

    it('breaks down by the entry event property', async () => {
      const result = await funnel({
        breakdown: { type: 'event', key: 'source' },
        funnel: { steps: SIGNUP_PURCHASE, window: { value: 7, unit: 'day' } },
      });
      expect(result.steps.map((s) => s.count)).toEqual([5, 2]);
      expect(result.breakdown!.map((b) => [b.value, b.steps.map((s) => s.count)])).toEqual([
        ['ads', [2, 1]],
        [null, [1, 0]],
        ['Ads_2', [1, 0]],
        ['organic', [1, 1]],
      ]);
    });

    it('lists converted and dropped-off units per step', async () => {
      const query = { version: 2, funnel: { steps: SIGNUP_PURCHASE, window: { value: 7, unit: 'day' } } };
      const converted = await runInsightFunnelActors(env, FIXTURE_SITE, query, RANGE.startAt, RANGE.endAt, { step: 1, outcome: 'converted' }, UTC);
      expect(converted).toMatchObject({ total: 2, actors: ['alice', 'bob'] });
      const dropped = await runInsightFunnelActors(env, FIXTURE_SITE, query, RANGE.startAt, RANGE.endAt, { step: 1, outcome: 'dropped' }, UTC);
      expect(dropped).toMatchObject({ total: 3, actors: ['carol', 'dave', 'fx-x1'] });
    });

    it('keeps the legacy report shape and per-session default', async () => {
      const report = await getFunnelReport(env, FIXTURE_SITE, RANGE.startAt, RANGE.endAt, ['signup', 'purchase']);
      expect(report.steps.map((s) => [s.step, s.count])).toEqual([
        ['signup', 6],
        ['purchase', 1],
      ]);
      const filtered = await getFunnelReport(env, FIXTURE_SITE, RANGE.startAt, RANGE.endAt, ['signup'], {
        properties: [{ type: 'person', key: 'plan', operator: 'is', value: 'pro' }],
      });
      expect(filtered.steps[0]!.count).toBe(3);
    });
  });

  it('computes retention with custom start and return events', async () => {
    const result = (await runInsightQuery(
      env,
      FIXTURE_SITE,
      'retention',
      {
        version: 2,
        retention: {
          startEvent: { kind: 'event', event: 'signup' },
          returnEvent: { kind: 'event', event: 'purchase' },
          period: 'day',
          periods: 4,
        },
      },
      RANGE.startAt,
      DAY0 + 4 * DAY - 1,
      UTC,
    )) as RetentionResult;
    expect(result.cohorts).toEqual([
      { cohort: '2026-02-02', size: 4, values: [4, 0, 1, 0] },
      { cohort: '2026-02-03', size: 1, values: [1, 0, 0] },
      { cohort: '2026-02-04', size: 0, values: [0, 0] },
      { cohort: '2026-02-05', size: 0, values: [0] },
    ]);
  });

  it('classifies lifecycle states per interval', async () => {
    const result = (await runInsightQuery(
      env,
      FIXTURE_SITE,
      'lifecycle',
      { version: 2, interval: 'day', series: [{ kind: 'event', event: 'signup', math: 'total' }] },
      RANGE.startAt,
      RANGE.endAt,
      UTC,
    )) as LifecycleResult;
    expect(result).toMatchObject({
      labels: ['2026-02-02', '2026-02-03', '2026-02-04'],
      new: [3, 0, 0],
      returning: [0, 1, 0],
      resurrecting: [1, 1, 0],
      dormant: [-1, -3, -2],
    });
  });

  it('computes stickiness per person with filters', async () => {
    const result = (await runInsightQuery(
      env,
      FIXTURE_SITE,
      'stickiness',
      { version: 2, series: [{ kind: 'event', event: 'signup', math: 'total' }] },
      RANGE.startAt,
      RANGE.endAt,
      UTC,
    )) as StickinessResult;
    expect(result.distribution.map((d) => [d.activeDays, d.actors])).toEqual([
      [1, 4],
      [2, 1],
    ]);
    const pro = (await runInsightQuery(
      env,
      FIXTURE_SITE,
      'stickiness',
      {
        version: 2,
        series: [{ kind: 'event', event: 'signup', math: 'total' }],
        filters: [{ type: 'person', key: 'plan', operator: 'is', value: 'pro' }],
      },
      RANGE.startAt,
      RANGE.endAt,
      UTC,
    )) as StickinessResult;
    expect(pro.totalActors).toBe(2);
  });

  it('applies property filters to cohort conditions', async () => {
    const members = await cohortMemberSubquery(env, {
      cohortId: 'fx-cohort',
      websiteId: FIXTURE_SITE,
      name: 'Pro signups',
      definition: {
        conditions: [
          {
            field: 'event_name',
            operator: 'equals',
            value: 'signup',
            filters: [{ type: 'person', key: 'plan', operator: 'is', value: 'pro' }],
          },
          { field: 'any_event', operator: 'equals', value: '', filters: [{ type: 'event', key: 'source', operator: 'is', value: 'ads' }] },
        ],
      },
    });
    // fx-a1, fx-a2 (alice) and fx-c1 (carol) have pro signups with source = ads.
    expect(members?.totalMembers).toBe(3);
  });

  it('upgrades legacy saved queries on read', async () => {
    const result = (await runInsightQuery(
      env,
      FIXTURE_SITE,
      'trend',
      { metric: 'events', event: 'purchase', unit: 'day' },
      RANGE.startAt,
      RANGE.endAt,
      UTC,
    )) as TrendResult;
    expect(result.results[0]!.data).toEqual([2, 0, 1]);
  });
});
