import { describe, expect, it } from 'vitest';
import {
  evaluateFormula,
  funnelWindowMs,
  insightQuerySchema,
  mergeInsightFilters,
  parseFormula,
  parseInsightQuery,
  propertyFilterSchema,
  regexToGlob,
  segmentParamsToFilters,
} from './insight-query';

function globs(pattern: string) {
  const result = regexToGlob(pattern);
  return result.ok ? result.globs : null;
}

describe('regexToGlob', () => {
  it('translates anchors, wildcards and classes', () => {
    expect(globs('^/blog/.*$')).toEqual(['/blog/*']);
    expect(globs('checkout')).toEqual(['*checkout*']);
    expect(globs('^/docs')).toEqual(['/docs*']);
    expect(globs('\\.pdf$')).toEqual(['*.pdf']);
    expect(globs('^/item/\\d\\d$')).toEqual(['/item/[0-9][0-9]']);
    expect(globs('^[a-c]x.+$')).toEqual(['[a-c]x?*']);
    expect(globs('^[^0-9]')).toEqual(['[^0-9]*']);
  });

  it('escapes glob metacharacters that are literal in the regex', () => {
    expect(globs('^a\\*b\\?c\\[$')).toEqual(['a[*]b[?]c[[]']);
  });

  it('splits top-level alternation into several patterns', () => {
    expect(globs('^/pricing$|^/plans$')).toEqual(['/pricing', '/plans']);
  });

  it('keeps ] - and ^ literal inside classes', () => {
    expect(globs('[]x-]')).toEqual(['*[]-x]*']);
    expect(globs('[x^]')).toEqual(['*[x^]*']);
    expect(globs('[\\^]')).toEqual(['*^*']);
  });

  it('rejects syntax GLOB cannot express', () => {
    for (const pattern of ['(a|b)', 'a+', 'ab?', 'a{2}', '\\bword', '(?i)x', '', '|a', 'a$b', '[z-a]']) {
      expect(regexToGlob(pattern).ok, pattern).toBe(false);
    }
  });
});

describe('formulas', () => {
  it('parses and evaluates arithmetic with precedence', () => {
    const parsed = parseFormula('A / B * 100', 2);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.refs).toEqual([0, 1]);
    expect(evaluateFormula(parsed.ast, [5, 20])).toBe(25);

    const nested = parseFormula('(a + b) * -2 - 1.5', 2);
    expect(nested.ok && evaluateFormula(nested.ast, [1, 2])).toBe(-7.5);
  });

  it('returns 0 for division by zero', () => {
    const parsed = parseFormula('A / B', 2);
    expect(parsed.ok && evaluateFormula(parsed.ast, [3, 0])).toBe(0);
  });

  it('rejects unknown series, identifiers and bad syntax', () => {
    expect(parseFormula('A / C', 2)).toMatchObject({ ok: false });
    expect(parseFormula('AB + 1', 2)).toMatchObject({ ok: false });
    expect(parseFormula('A +', 1)).toMatchObject({ ok: false });
    expect(parseFormula('(A', 1)).toMatchObject({ ok: false });
    expect(parseFormula('1 + 2', 1)).toMatchObject({ ok: false });
    expect(parseFormula('alert(1)', 1)).toMatchObject({ ok: false });
  });
});

describe('property filter schema', () => {
  it('accepts every operator with a matching value', () => {
    const valid = [
      { type: 'event', key: 'plan', operator: 'is', value: ['pro', 'team'] },
      { type: 'person', key: 'email', operator: 'contains', value: '@acme' },
      { type: 'event', key: 'amount', operator: 'between', value: [10, 20] },
      { type: 'event', key: 'amount', operator: 'gt', value: '5' },
      { type: 'dimension', key: 'path', operator: 'regex', value: '^/blog/.*' },
      { type: 'person', key: 'plan', operator: 'is_not_set' },
    ];
    for (const filter of valid) expect(propertyFilterSchema.safeParse(filter).success, filter.operator).toBe(true);
  });

  it('rejects missing or mistyped values', () => {
    const invalid = [
      { type: 'event', key: 'plan', operator: 'is', value: [] },
      { type: 'event', key: 'amount', operator: 'gt', value: 'many' },
      { type: 'event', key: 'amount', operator: 'between', value: [20, 10] },
      { type: 'dimension', key: 'nope', operator: 'is', value: 'x' },
      { type: 'dimension', key: 'path', operator: 'gt', value: 1 },
      { type: 'event', key: 'path', operator: 'regex', value: '(a)' },
    ];
    for (const filter of invalid) expect(propertyFilterSchema.safeParse(filter).success, JSON.stringify(filter)).toBe(false);
  });
});

describe('parseInsightQuery', () => {
  it('upgrades legacy trend, funnel and stickiness queries', () => {
    expect(parseInsightQuery('trend', { metric: 'events', event: 'signup', unit: 'week' })).toEqual({
      ok: true,
      query: { version: 2, interval: 'week', series: [{ kind: 'event', event: 'signup', math: 'total' }] },
    });
    expect(parseInsightQuery('trend', { metric: 'visitors' })).toMatchObject({
      ok: true,
      query: { series: [{ kind: 'pageview', math: 'unique_sessions' }] },
    });
    expect(parseInsightQuery('funnel', { events: ['a', 'b'] })).toMatchObject({
      ok: true,
      query: {
        countBy: 'session',
        funnel: { steps: [{ kind: 'event', event: 'a' }, { kind: 'event', event: 'b' }], order: 'strict' },
      },
    });
    expect(parseInsightQuery('stickiness', { actor: 'session' })).toMatchObject({
      ok: true,
      query: { countBy: 'session', series: [{ kind: 'all' }] },
    });
  });

  it('validates v2 queries including formula letters', () => {
    const query = {
      version: 2,
      series: [{ kind: 'event', event: 'a' }, { kind: 'pageview', math: 'unique_users' }],
      formula: 'A / B',
      breakdown: { type: 'person', key: 'plan' },
    };
    const parsed = parseInsightQuery('trend', query);
    expect(parsed.ok).toBe(true);
    expect(parseInsightQuery('trend', { ...query, formula: 'A / C' })).toMatchObject({ ok: false });
    expect(parseInsightQuery('trend', { ...query, series: [{ kind: 'event', math: 'sum' }] })).toMatchObject({
      ok: false,
    });
  });

  it('bounds the funnel conversion window', () => {
    expect(funnelWindowMs({ value: 2, unit: 'hour' })).toBe(7_200_000);
    const tooLong = { version: 2, funnel: { steps: [], window: { value: 91, unit: 'day' } } };
    expect(parseInsightQuery('funnel', tooLong)).toMatchObject({ ok: false });
  });

  it('accepts both shapes on the wire', () => {
    expect(insightQuerySchema.safeParse({ metric: 'events' }).success).toBe(true);
    expect(insightQuerySchema.safeParse({ version: 2, interval: 'day' }).success).toBe(true);
    expect(insightQuerySchema.safeParse({ version: 2, interval: 'year' }).success).toBe(false);
  });
});

describe('filter helpers', () => {
  it('turns segment parameters into dimension filters', () => {
    expect(
      segmentParamsToFilters({
        country: 'US',
        pathContains: '/docs',
        utmSource: 'news',
        properties: [{ type: 'person', key: 'plan', operator: 'is', value: 'pro' }],
      }),
    ).toEqual([
      { type: 'dimension', key: 'country', operator: 'is', value: ['US'] },
      { type: 'dimension', key: 'path', operator: 'contains', value: '/docs' },
      { type: 'dimension', key: 'utm_source', operator: 'is', value: ['news'] },
      { type: 'person', key: 'plan', operator: 'is', value: 'pro' },
    ]);
  });

  it('merges dashboard filters after the insight filters', () => {
    const merged = mergeInsightFilters(
      { version: 2, filters: [{ type: 'event', key: 'a', operator: 'is_set' }] },
      [{ type: 'person', key: 'b', operator: 'is_set' }],
    );
    expect(merged.filters?.map((f) => f.key)).toEqual(['a', 'b']);
  });
});
