/**
 * Trends: up to 5 series with per-series math, an optional breakdown (top 10 + Other),
 * formulas over series and comparison with the previous period. One statement per series
 * and period; every statement is bounded by the date range.
 */
import {
  BREAKDOWN_LIMIT,
  evaluateFormula,
  parseFormula,
  PROPERTY_MATHS,
  type InsightInterval,
  type InsightQuery,
  type InsightSeries,
  type TrendResult,
  type TrendResultSeries,
} from '@flareboard/shared';
import {
  allRows,
  bucketLabels,
  bucketSql,
  decodeBreakdownValue,
  eventLabel,
  eventMatcherSql,
  globalFiltersSql,
  resolveInterval,
  sessionJoinSql,
  unitSql,
  type InsightContext,
} from './insight-sql';
import { breakdownValueSql, InsightQueryError, numericEventPropertySql, SqlParams } from './property-filters';

const SERIES_LETTERS = 'ABCDE';

type SeriesRow = { b: string | null; g: string | null; y: number | null };

function aggregateSql(math: InsightSeries['math']): string {
  switch (math) {
    case 'total':
      return 'COUNT(*)';
    case 'unique_users':
    case 'unique_sessions':
      return 'COUNT(DISTINCT v)';
    case 'sum':
      return 'COALESCE(SUM(v), 0)';
    case 'avg':
      return 'AVG(v)';
    case 'min':
      return 'MIN(v)';
    case 'max':
      return 'MAX(v)';
    case 'median':
      return 'COUNT(v)';
  }
}

function buildSeriesStatement(
  ctx: InsightContext,
  query: InsightQuery,
  series: InsightSeries,
  interval: InsightInterval,
  range: { startAt: number; endAt: number },
) {
  const params = new SqlParams();
  const matcher = eventMatcherSql(series, params);
  const global = globalFiltersSql(query.filters, params);
  const breakdown = query.breakdown ? breakdownValueSql(query.breakdown, params) : null;

  let value = '1';
  let needsSession = matcher.needsSession || global.needsSession || Boolean(breakdown?.needsSession);
  if (series.math === 'unique_users') {
    const unit = unitSql('person');
    value = unit.sql;
    needsSession ||= unit.needsSession;
  } else if (series.math === 'unique_sessions') {
    value = 'e.session_id';
  } else if (PROPERTY_MATHS.includes(series.math)) {
    if (!series.mathProperty) throw new InsightQueryError('Choose a numeric property for this series');
    value = numericEventPropertySql(series.mathProperty, params);
  }

  const bucket = bucketSql(interval, range.startAt, range.endAt, ctx.timezone);
  const base = `base AS (
    SELECT ${bucket} AS b, ${value} AS v, ${breakdown ? `COALESCE(${breakdown.sql}, char(1))` : "''"} AS g
    FROM website_event e${sessionJoinSql(needsSession)}
    WHERE e.website_id = ${params.add(ctx.websiteId)}
      AND e.created_at >= ${params.add(range.startAt)} AND e.created_at <= ${params.add(range.endAt)}
      AND ${matcher.sql}${global.sql}
  )`;

  const agg = aggregateSql(series.math);
  const grouped = breakdown
    ? `, top AS (
        SELECT g FROM base GROUP BY g ORDER BY ${agg} DESC, g LIMIT ${BREAKDOWN_LIMIT}
      ),
      grouped AS (
        SELECT b, CASE WHEN g IN (SELECT g FROM top) THEN g ELSE char(2) END AS g, v FROM base
      )`
    : ', grouped AS (SELECT b, g, v FROM base)';

  let select: string;
  if (series.math === 'median') {
    select = `, ranked AS (
        SELECT b, g, v, ROW_NUMBER() OVER (PARTITION BY b, g ORDER BY v) AS rn, COUNT(*) OVER (PARTITION BY b, g) AS n
        FROM grouped WHERE v IS NOT NULL
      ),
      ranked_total AS (
        SELECT g, v, ROW_NUMBER() OVER (PARTITION BY g ORDER BY v) AS rn, COUNT(*) OVER (PARTITION BY g) AS n
        FROM grouped WHERE v IS NOT NULL
      )
      SELECT b, g, AVG(v) AS y FROM ranked WHERE rn IN ((n + 1) / 2, (n + 2) / 2) GROUP BY b, g
      UNION ALL
      SELECT NULL AS b, g, AVG(v) AS y FROM ranked_total WHERE rn IN ((n + 1) / 2, (n + 2) / 2) GROUP BY g`;
  } else {
    select = `
      SELECT b, g, ${agg} AS y FROM grouped GROUP BY b, g
      UNION ALL
      SELECT NULL AS b, g, ${agg} AS y FROM grouped GROUP BY g`;
  }

  return { sql: `WITH ${base}${grouped}${select}`, params };
}

function roundValue(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.round(value * 10_000) / 10_000;
}

/** Result lines of one series: one per breakdown value (by total, Other last), or one line. */
function seriesResults(
  rows: SeriesRow[],
  labels: string[],
  index: number,
  series: InsightSeries,
  hasBreakdown: boolean,
): TrendResultSeries[] {
  const labelIndex = new Map(labels.map((label, i) => [label, i]));
  const groups = new Map<string, { data: number[]; total: number }>();
  for (const row of rows) {
    const key = row.g ?? '';
    let group = groups.get(key);
    if (!group) {
      group = { data: labels.map(() => 0), total: 0 };
      groups.set(key, group);
    }
    if (row.b === null) group.total = roundValue(row.y);
    else {
      const i = labelIndex.get(row.b);
      if (i !== undefined) group.data[i] = roundValue(row.y);
    }
  }
  // Without a breakdown an empty range still draws a flat line at 0.
  if (!groups.size && !hasBreakdown) groups.set('', { data: labels.map(() => 0), total: 0 });

  const letter = SERIES_LETTERS[index] ?? String(index + 1);
  const label = eventLabel(series);
  // Largest first, ties by value (not set first), Other last.
  const entries = [...groups.entries()].sort(
    ([ka, a], [kb, b]) => Number(ka === '\u0002') - Number(kb === '\u0002') || b.total - a.total || (ka < kb ? -1 : ka > kb ? 1 : 0),
  );
  return entries.map(([key, group]): TrendResultSeries => {
    const base: TrendResultSeries = {
      key: letter,
      seriesIndex: index,
      label,
      math: series.math,
      data: group.data,
      total: group.total,
    };
    if (!hasBreakdown) return base;
    const decoded = decodeBreakdownValue(key);
    return { ...base, breakdownValue: decoded.value, isOther: decoded.isOther };
  });
}

function breakdownKey(result: TrendResultSeries): string {
  if (result.isOther) return '\u0002';
  return result.breakdownValue === undefined ? '' : (result.breakdownValue ?? '\u0001');
}

/** Formula lines: one per breakdown value present in any referenced series. */
function formulaResults(
  formula: string,
  seriesCount: number,
  perSeries: TrendResultSeries[][],
  labels: string[],
): TrendResultSeries[] {
  const parsed = parseFormula(formula, seriesCount);
  if (!parsed.ok) throw new InsightQueryError(`Formula: ${parsed.reason}`);
  const keys: string[] = [];
  const lookup = perSeries.map((results) => new Map(results.map((r) => [breakdownKey(r), r])));
  for (const index of parsed.refs) {
    for (const result of perSeries[index] ?? []) {
      const key = breakdownKey(result);
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys.map((key) => {
    const sample = parsed.refs.map((i) => lookup[i]?.get(key)).find(Boolean);
    const data = labels.map((_, bucket) =>
      roundValue(evaluateFormula(parsed.ast, lookup.map((map) => map.get(key)?.data[bucket] ?? 0))),
    );
    const total = roundValue(evaluateFormula(parsed.ast, lookup.map((map) => map.get(key)?.total ?? 0)));
    const result: TrendResultSeries = { key: 'formula', seriesIndex: null, label: formula, math: null, data, total };
    if (sample?.breakdownValue !== undefined || sample?.isOther) {
      return { ...result, breakdownValue: sample?.breakdownValue ?? null, isOther: Boolean(sample?.isOther) };
    }
    return result;
  });
}

async function runPeriod(
  ctx: InsightContext,
  query: InsightQuery,
  series: InsightSeries[],
  interval: InsightInterval,
  range: { startAt: number; endAt: number },
) {
  const labels = bucketLabels(range.startAt, range.endAt, interval, ctx.timezone);
  const rows = await Promise.all(
    series.map((s) => {
      const statement = buildSeriesStatement(ctx, query, s, interval, range);
      return allRows<SeriesRow>(ctx.db, statement.sql, statement.params);
    }),
  );
  const perSeries = rows.map((r, i) => seriesResults(r, labels, i, series[i]!, Boolean(query.breakdown)));
  const formula = query.formula?.trim() || null;
  const results = formula ? formulaResults(formula, series.length, perSeries, labels) : perSeries.flat();
  return { labels, results, perSeries: perSeries.flat() };
}

export async function runTrends(ctx: InsightContext, query: InsightQuery): Promise<TrendResult> {
  const series: InsightSeries[] = query.series?.length ? query.series : [{ kind: 'pageview', math: 'total' }];
  const interval = resolveInterval(query.interval ?? 'day', ctx.startAt, ctx.endAt, ctx.timezone);
  const span = ctx.endAt - ctx.startAt;
  const previous = { startAt: ctx.startAt - span - 1, endAt: ctx.startAt - 1 };

  const [current, compare] = await Promise.all([
    runPeriod(ctx, query, series, interval, ctx),
    query.compare ? runPeriod(ctx, query, series, interval, previous) : Promise.resolve(null),
  ]);

  const formula = query.formula?.trim() || null;
  // With a formula the series lines are still returned (after the formula lines) for tables.
  const results = formula ? [...current.results, ...current.perSeries] : current.results;
  const first = results[0];
  return {
    kind: 'trend',
    interval,
    labels: current.labels,
    results,
    formula,
    compare: compare
      ? {
          ...previous,
          labels: compare.labels,
          results: formula ? [...compare.results, ...compare.perSeries] : compare.results,
        }
      : null,
    series: first ? current.labels.map((x, i) => ({ x, y: first.data[i] ?? 0 })) : [],
    startAt: ctx.startAt,
    endAt: ctx.endAt,
  };
}
