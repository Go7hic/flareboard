/**
 * Funnels counted per unit (distinct id, else session) inside a conversion window.
 *
 * strict order: a unit reaches step k when step 0..k events happen in that order with step k no
 * later than `window` after the step-0 event that starts the chain. Each step is computed by one
 * window-function pass: f_k = the latest chain start usable by a step-k event, i.e. the running
 * max of f_{k-1} over the unit's earlier rows (greedy latest start maximises the time left).
 *
 * any order: a unit reaches step k when k+1 distinct steps happen inside one window, starting at
 * any of its matching events.
 *
 * Breakdowns attribute each unit to the value on its first entry event (first touch), top 10 +
 * Other. Time to convert is measured from the funnel entry to each step (strict) or to the last
 * step (any order).
 */
import {
  BREAKDOWN_LIMIT,
  funnelWindowMs,
  type FunnelActorsResult,
  type FunnelResult,
  type FunnelStepResult,
  type InsightEvent,
  type InsightQuery,
} from '@flareboard/shared';
import {
  allRows,
  decodeBreakdownValue,
  eventLabel,
  eventMatcherSql,
  globalFiltersSql,
  NONE_SENTINEL,
  OTHER_SENTINEL,
  sessionJoinSql,
  unitSql,
  type InsightContext,
} from './insight-sql';
import { breakdownValueSql, InsightQueryError, SqlParams } from './property-filters';

type FunnelPlan = {
  steps: InsightEvent[];
  order: 'strict' | 'any';
  countBy: 'person' | 'session';
  windowMs: number;
};

function plan(query: InsightQuery): FunnelPlan {
  return {
    steps: query.funnel?.steps ?? [],
    order: query.funnel?.order ?? 'strict',
    countBy: query.countBy ?? 'person',
    windowMs: funnelWindowMs(query.funnel?.window),
  };
}

/**
 * CTEs ending in `grouped(g, u, r0..rN-1, d1..dN-1)`: one row per unit that entered the funnel,
 * r_k = 1 when it reached step k, d_k = ms from entry to step k.
 */
function unitsCte(ctx: InsightContext, query: InsightQuery, p: FunnelPlan, params: SqlParams) {
  const n = p.steps.length;
  const W = Math.round(p.windowMs);
  const unit = unitSql(p.countBy);
  const matchers = p.steps.map((step) => eventMatcherSql(step, params));
  const global = globalFiltersSql(query.filters, params);
  const breakdown = query.breakdown ? breakdownValueSql(query.breakdown, params) : null;
  const needsSession =
    unit.needsSession || global.needsSession || Boolean(breakdown?.needsSession) || matchers.some((m) => m.needsSession);

  const flags = matchers.map((m, k) => `CASE WHEN ${m.sql} THEN 1 ELSE 0 END AS c${k}`).join(',\n      ');
  const anyStep = matchers.map((m) => `(${m.sql})`).join(' OR ');
  const ks = [...Array(n).keys()];

  const ev = `ev AS (
    SELECT ${unit.sql} AS u, e.created_at AS t, e.event_id AS id,
      ${breakdown ? `COALESCE(${breakdown.sql}, char(1))` : "''"} AS bd,
      ${flags}
    FROM website_event e${sessionJoinSql(needsSession)}
    WHERE e.website_id = ${params.add(ctx.websiteId)}
      AND e.created_at >= ${params.add(ctx.startAt)} AND e.created_at <= ${params.add(ctx.endAt)}
      AND (${anyStep})${global.sql}
  )`;

  let layers: string;
  let units: string;
  if (p.order === 'strict') {
    const layerList = [
      `l0 AS (
        SELECT u, t, id, ${ks.map((k) => `c${k}`).join(', ')},
          CASE WHEN c0 = 1 THEN t END AS f0,
          FIRST_VALUE(bd) OVER (PARTITION BY u ORDER BY c0 DESC, t, id) AS ubd
        FROM ev
      )`,
    ];
    for (let k = 1; k < n; k++) {
      layerList.push(`l${k} AS (
        SELECT *, CASE WHEN c${k} = 1 AND t - MAX(f${k - 1}) OVER w <= ${W} THEN MAX(f${k - 1}) OVER w END AS f${k}
        FROM l${k - 1}
        WINDOW w AS (PARTITION BY u ORDER BY t, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
      )`);
    }
    layers = layerList.join(',\n');
    units = `units AS (
      SELECT u, COALESCE(MAX(ubd), char(1)) AS bd,
        ${ks.map((k) => `MAX(f${k} IS NOT NULL) AS r${k}`).join(', ')}
        ${ks.slice(1).map((k) => `, MIN(t - f${k}) AS d${k}`).join('')}
      FROM l${n - 1}
      GROUP BY u
    )`;
  } else {
    const nexts = ks
      .map((k) => `MIN(CASE WHEN c${k} = 1 THEN t END) OVER wf AS n${k}`)
      .join(',\n          ');
    layers = `l AS (
        SELECT u, t,
          FIRST_VALUE(bd) OVER (PARTITION BY u ORDER BY t, id) AS ubd,
          ${nexts}
        FROM ev
        WINDOW wf AS (PARTITION BY u ORDER BY t, id ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING)
      ),
      sc AS (
        SELECT u, ubd,
          ${ks.map((k) => `(CASE WHEN n${k} - t <= ${W} THEN 1 ELSE 0 END)`).join(' + ')} AS done,
          CASE WHEN ${ks.map((k) => `n${k} - t <= ${W}`).join(' AND ')}
            THEN ${n === 1 ? 'n0' : `MAX(${ks.map((k) => `n${k}`).join(', ')})`} - t END AS dur
        FROM l
      )`;
    units = `units AS (
      SELECT u, COALESCE(MAX(ubd), char(1)) AS bd,
        ${ks.map((k) => `MAX(done >= ${k + 1}) AS r${k}`).join(', ')}
        ${ks.slice(1).map((k) => (k === n - 1 ? `, MIN(dur) AS d${k}` : `, NULL AS d${k}`)).join('')}
      FROM sc
      GROUP BY u
    )`;
  }

  const grouped = breakdown
    ? `top AS (
        SELECT bd FROM units WHERE r0 = 1 GROUP BY bd ORDER BY COUNT(*) DESC, bd LIMIT ${BREAKDOWN_LIMIT}
      ),
      grouped AS (
        SELECT CASE WHEN bd IN (SELECT bd FROM top) THEN bd ELSE char(2) END AS g, units.*
        FROM units WHERE r0 = 1
      )`
    : `grouped AS (SELECT '' AS g, units.* FROM units WHERE r0 = 1)`;

  return `WITH ${ev},\n${layers},\n${units},\n${grouped}`;
}

function validateSteps(p: FunnelPlan) {
  if (p.steps.length > 20) throw new InsightQueryError('At most 20 funnel steps');
}

type StepRow = { g: string | null; k: number; cnt: number; avg_d: number | null; med_d: number | null };

function stepResults(labels: string[], rows: StepRow[]): { steps: FunnelStepResult[]; conversion: number } {
  const byStep = new Map(rows.map((row) => [row.k, row]));
  const first = byStep.get(0)?.cnt ?? 0;
  let previous = first;
  const steps = labels.map((label, index): FunnelStepResult => {
    const row = byStep.get(index);
    const count = row?.cnt ?? 0;
    const rate = index === 0 ? (count > 0 ? 100 : 0) : previous > 0 ? Math.round((count / previous) * 1000) / 10 : 0;
    const result: FunnelStepResult = {
      index,
      label,
      step: label,
      count,
      rate,
      conversionRate: first > 0 ? Math.round((count / first) * 1000) / 10 : 0,
      droppedOff: index === 0 ? 0 : Math.max(previous - count, 0),
      avgTimeToConvertMs: index > 0 && row?.avg_d != null ? Math.round(row.avg_d) : null,
      medianTimeToConvertMs: index > 0 && row?.med_d != null ? Math.round(row.med_d) : null,
    };
    previous = count;
    return result;
  });
  const last = steps[steps.length - 1]?.count ?? 0;
  return { steps, conversion: first > 0 ? Math.round((last / first) * 1000) / 10 : 0 };
}

export async function runFunnel(ctx: InsightContext, query: InsightQuery): Promise<FunnelResult> {
  const p = plan(query);
  validateSteps(p);
  const labels = p.steps.map(eventLabel);
  const empty: FunnelResult = {
    kind: 'funnel',
    order: p.order,
    countBy: p.countBy,
    windowMs: p.windowMs,
    steps: [],
    conversion: 0,
    breakdown: query.breakdown ? [] : null,
    startAt: ctx.startAt,
    endAt: ctx.endAt,
  };
  if (!p.steps.length) return empty;

  const params = new SqlParams();
  const n = p.steps.length;
  const ks = [...Array(n).keys()];
  const long = ks
    .map((k) => `SELECT g, ${k} AS k, r${k} AS r, ${k === 0 ? 'NULL' : `CASE WHEN r${k} = 1 THEN d${k} END`} AS d FROM grouped`)
    .join('\n      UNION ALL ');
  // With a breakdown, rows with g = NULL are the overall funnel.
  const allGroups = query.breakdown ? `long_all AS (SELECT g, k, r, d FROM long UNION ALL SELECT NULL, k, r, d FROM long)` : `long_all AS (SELECT g, k, r, d FROM long)`;
  const sql = `${unitsCte(ctx, query, p, params)},
    long AS (${long}),
    ${allGroups},
    agg AS (SELECT g, k, SUM(r) AS cnt, AVG(d) AS avg_d FROM long_all GROUP BY g, k),
    rk AS (
      SELECT g, k, d, ROW_NUMBER() OVER (PARTITION BY g, k ORDER BY d) AS rn, COUNT(*) OVER (PARTITION BY g, k) AS n
      FROM long_all WHERE d IS NOT NULL
    ),
    med AS (SELECT g, k, AVG(d) AS med_d FROM rk WHERE rn IN ((n + 1) / 2, (n + 2) / 2) GROUP BY g, k)
    SELECT agg.g AS g, agg.k AS k, agg.cnt AS cnt, agg.avg_d AS avg_d, med.med_d AS med_d
    FROM agg LEFT JOIN med ON med.g IS agg.g AND med.k = agg.k`;

  const rows = await allRows<StepRow>(ctx.db, sql, params);

  if (!query.breakdown) {
    return { ...empty, ...stepResults(labels, rows) };
  }

  const overall = stepResults(labels, rows.filter((row) => row.g === null));
  const groups = new Map<string, StepRow[]>();
  for (const row of rows) {
    if (row.g === null) continue;
    const list = groups.get(row.g) ?? [];
    list.push(row);
    groups.set(row.g, list);
  }
  // Largest first, ties by value (not set first), Other last.
  const breakdown = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([g, groupRows]) => {
      const decoded = decodeBreakdownValue(g);
      return { value: decoded.value, isOther: decoded.isOther, ...stepResults(labels, groupRows) };
    })
    .sort((a, b) => Number(a.isOther) - Number(b.isOther) || (b.steps[0]?.count ?? 0) - (a.steps[0]?.count ?? 0));
  return { ...empty, ...overall, breakdown };
}

export const MAX_FUNNEL_ACTORS = 500;

/**
 * Units that converted at `step` (reached it) or dropped off at it (reached the previous step but
 * not this one), optionally within one breakdown group.
 */
export async function runFunnelActors(
  ctx: InsightContext,
  query: InsightQuery,
  options: {
    step: number;
    outcome: 'converted' | 'dropped';
    breakdownValue?: string | null;
    breakdownOther?: boolean;
    limit?: number;
  },
): Promise<FunnelActorsResult> {
  const p = plan(query);
  validateSteps(p);
  const { step, outcome } = options;
  if (!Number.isInteger(step) || step < 0 || step >= p.steps.length) {
    throw new InsightQueryError('Unknown funnel step');
  }
  if (outcome === 'dropped' && step === 0) throw new InsightQueryError('Nobody drops off at the first step');
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), MAX_FUNNEL_ACTORS);

  const params = new SqlParams();
  const cte = unitsCte(ctx, query, p, params);
  const conditions = [outcome === 'converted' ? `r${step} = 1` : `r${step - 1} = 1 AND r${step} = 0`];
  if (query.breakdown && (options.breakdownOther || options.breakdownValue !== undefined)) {
    const g = options.breakdownOther ? OTHER_SENTINEL : (options.breakdownValue ?? NONE_SENTINEL);
    conditions.push(`g = ${params.add(g)}`);
  }
  const rows = await allRows<{ u: string; total: number }>(
    ctx.db,
    `${cte}
    SELECT u, COUNT(*) OVER () AS total FROM grouped
    WHERE ${conditions.join(' AND ')}
    ORDER BY u
    LIMIT ${limit}`,
    params,
  );
  return {
    step,
    outcome,
    countBy: p.countBy,
    total: rows[0]?.total ?? 0,
    actors: rows.map((row) => row.u),
  };
}
