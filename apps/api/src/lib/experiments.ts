import { EVENT_TYPE, isPropertyMetricType, type ExperimentMetric, type ExperimentMetricType } from '@flareboard/shared';
import {
  DEFAULT_ALPHA,
  DEFAULT_POWER,
  bayesianMeanComparison,
  bayesianProportionComparison,
  betaCredibleInterval,
  checkSampleRatio,
  expectedVariantShares,
  meanInterval,
  meanSampleFromSums,
  minimumDetectableEffectForMean,
  minimumDetectableEffectForProportion,
  normalCredibleInterval,
  requiredSampleSizeForMean,
  requiredSampleSizeForProportion,
  twoProportionZTest,
  welchTTest,
  wilsonInterval,
  type ExperimentAllocation,
  type Interval,
  type SampleRatioCheck,
} from '@flareboard/shared/experiment-stats';
import type { Env } from '../env';
import { siteDb } from './site-db';

/**
 * Experiment analysis.
 *
 * Unit of analysis: the session's distinct id when it has one, else the session id. A unit is
 * exposed at its first `$feature_flag_called` event for the experiment's flag inside the
 * window and belongs to that exposure's variant. Units exposed to more than one variant are
 * excluded (and counted). Metric events count when the same unit fires them at or after its
 * first exposure and before the window end. Everything is aggregated in SQL, so the Worker
 * only ever holds one row per (day, variant) plus a handful of recent samples.
 */

export const CONTROL_VARIANT = 'control';
/** Before these floors a "significant" result is too fragile to act on. */
export const MIN_UNITS_PER_VARIANT = 30;
export const MIN_TOTAL_CONVERSIONS = 10;
const RECENT_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Flag responses that mean "not in the experiment" rather than an arm. */
const NON_ARM_RESPONSES = ['', 'false'];

export type ExperimentAnalysisInput = {
  flagKey: string;
  startAt: number;
  endAt: number;
  primaryMetric: ExperimentMetric;
  secondaryMetrics: ExperimentMetric[];
  /** Expected traffic split. Null skips the sample ratio mismatch check. */
  allocation: ExperimentAllocation | null;
  /** Relative minimum detectable effect as a fraction (0.1 = 10%). */
  minimumDetectableEffect: number;
  /** True once the experiment has ended (no time-remaining estimate). */
  ended?: boolean;
  now?: number;
};

export type ExperimentVariantExposure = {
  variant: string;
  baseline: boolean;
  units: number;
  /** Share of analyzed (non-excluded) units. */
  share: number;
  /** Configured share among the arms of the SRM check; null when unknown. */
  expectedShare: number | null;
};

export type ExperimentComparison = {
  /** Relative lift vs control; null when the control value is 0. */
  lift: number | null;
  difference: number;
  frequentist: {
    pValue: number | null;
    significant: boolean;
    liftInterval: Interval | null;
    differenceInterval: Interval | null;
  };
  bayesian: {
    probabilityToBeatControl: number | null;
    liftInterval: Interval | null;
  };
};

export type ExperimentMetricVariantResult = {
  variant: string;
  baseline: boolean;
  /** Units contributing a value: every exposed unit, or for property_mean the units with a value. */
  sampleSize: number;
  /** Conversion rate (fraction) or mean per unit; null without units. */
  value: number | null;
  /** Converted units, or the sum of the per-unit values. */
  total: number;
  standardDeviation: number | null;
  confidenceInterval: Interval | null;
  credibleInterval: Interval | null;
  comparison: ExperimentComparison | null;
};

export type ExperimentMetricResult = {
  role: 'primary' | 'secondary';
  metric: ExperimentMetric;
  variants: ExperimentMetricVariantResult[];
};

export type ExperimentGuidance = {
  metricType: ExperimentMetricType;
  /** Control conversion rate or mean. */
  baseline: number | null;
  /** Target relative effect (fraction). */
  minimumDetectableEffect: number;
  requiredUnitsPerVariant: number | null;
  /** Smallest arm's sample for the primary metric. */
  currentUnitsPerVariant: number;
  /** Relative effect detectable with the current sample. */
  detectableEffect: number | null;
  estimatedDaysRemaining: number | null;
  alpha: number;
  power: number;
};

export type ExperimentDiagnosticCode =
  | 'no_exposures'
  | 'missing_control'
  | 'sample_ratio_mismatch'
  | 'low_sample'
  | 'significant_variant'
  | 'variant_worse'
  | 'no_significant_winner';

export type ExperimentDiagnostic = {
  code: ExperimentDiagnosticCode;
  level: 'info' | 'warning' | 'success' | 'error';
};

export type ExperimentDecision = 'no_data' | 'fix_setup' | 'keep_collecting' | 'ship_variant' | 'keep_control';

export type ExperimentResultSummary = {
  totalUnits: number;
  /** Units exposed to more than one variant, left out of every metric. */
  excludedUnits: number;
  controlVariant: string | null;
  /** Arm with the best primary metric value. */
  leaderVariant: string | null;
  leaderLift: number | null;
  /** Arm that beats control with frequentist significance (the ship candidate). */
  significantVariant: string | null;
  /** Arm with the highest posterior probability to beat control. */
  bayesianLeader: string | null;
  bayesianLeaderProbability: number | null;
  minimumSampleReached: boolean;
  plannedSampleReached: boolean;
  decision: ExperimentDecision;
  diagnostics: ExperimentDiagnostic[];
};

export type ExperimentRecentExposure = {
  id: string;
  sessionId: string;
  variant: string;
  urlPath: string | null;
  exposedAt: number;
  converted: boolean;
  convertedAt: number | null;
};

export type ExperimentTrendRow = {
  date: string;
  variant: string;
  /** Units first exposed that day. */
  units: number;
  /** Primary metric for that day's cohort. */
  value: number | null;
};

export type ExperimentResults = {
  window: { startAt: number; endAt: number };
  variants: ExperimentVariantExposure[];
  srm: SampleRatioCheck | null;
  metrics: ExperimentMetricResult[];
  guidance: ExperimentGuidance | null;
  summary: ExperimentResultSummary;
  recent: ExperimentRecentExposure[];
  trend: ExperimentTrendRow[];
};

// ---------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------

type AnalysisQuery = { sql: string; params: unknown[] };

/**
 * One statement computes everything. Exposures and metric events are unioned per unit and
 * a window function finds each unit's first exposure, so no join on the computed unit id is
 * needed (SQLite cannot index it). Both scans are bounded by the window and use the
 * (website_id, event_type, created_at) and (website_id, created_at, event_name) indexes.
 * Result rows: one per (day, variant) with per-metric count/sum/sum-of-squares, a NULL
 * variant for excluded units, and up to RECENT_LIMIT 'recent' rows.
 */
export function buildExperimentAnalysisQuery(
  websiteId: string,
  input: Pick<ExperimentAnalysisInput, 'flagKey' | 'startAt' | 'endAt'>,
  metrics: ExperimentMetric[],
): AnalysisQuery {
  const params: unknown[] = [websiteId, input.flagKey, input.startAt, input.endAt, EVENT_TYPE.customEvent];
  const bind = (value: unknown) => {
    params.push(value);
    return `?${params.length}`;
  };
  const nonArm = NON_ARM_RESPONSES.map((value) => bind(value)).join(', ');

  const eventParams = new Map<string, string>();
  for (const metric of metrics) {
    if (!eventParams.has(metric.event)) eventParams.set(metric.event, bind(metric.event));
  }
  const propertyColumns = new Map<string, { column: string; eventParam: string; propertyParam: string }>();
  for (const metric of metrics) {
    if (!isPropertyMetricType(metric.type) || !metric.property) continue;
    const key = `${metric.event}\u0000${metric.property}`;
    if (propertyColumns.has(key)) continue;
    propertyColumns.set(key, {
      column: `p${propertyColumns.size}`,
      eventParam: eventParams.get(metric.event)!,
      propertyParam: bind(metric.property),
    });
  }
  const properties = [...propertyColumns.values()];
  const propertyNulls = properties.map((property) => `, NULL AS ${property.column}`).join('');
  const propertyNames = properties.map((property) => `, ${property.column}`).join('');
  const propertyLookups = properties
    .map(
      (property) =>
        `,
         CASE WHEN e.event_name = ${property.eventParam} THEN (
           SELECT d.number_value FROM event_data d
           WHERE d.website_event_id = e.event_id AND d.data_key = ${property.propertyParam}
             AND d.number_value IS NOT NULL
           LIMIT 1
         ) END AS ${property.column}`,
    )
    .join('');

  const unitValue = (metric: ExperimentMetric) => {
    const event = eventParams.get(metric.event)!;
    const matches = `kind = 2 AND event_name = ${event}`;
    if (metric.type === 'conversion') return `MAX(CASE WHEN ${matches} THEN 1 ELSE 0 END)`;
    if (metric.type === 'count') return `SUM(CASE WHEN ${matches} THEN 1 ELSE 0 END)`;
    const column = propertyColumns.get(`${metric.event}\u0000${metric.property}`)!.column;
    return metric.type === 'property_sum' ? `TOTAL(${column})` : `AVG(${column})`;
  };
  const unitValues = metrics.map((metric, index) => `,\n         ${unitValue(metric)} AS x${index}`).join('');
  const aggregates = metrics
    .map((_, index) => `, COUNT(x${index}) AS n${index}, TOTAL(x${index}) AS s${index}, TOTAL(x${index} * x${index}) AS q${index}`)
    .join('');
  const aggregateNulls = metrics.map(() => ', NULL, NULL, NULL').join('');
  const primaryEvent = eventParams.get(metrics[0]!.event)!;

  const sql = `WITH exposure AS (
       SELECT COALESCE(NULLIF(s.distinct_id, ''), e.session_id) AS unit,
              e.created_at AS ts,
              r.string_value AS variant,
              e.event_id AS event_id,
              e.session_id AS session_id,
              e.url_path AS url_path
       FROM website_event e
       INNER JOIN event_data f
         ON f.website_event_id = e.event_id
        AND f.data_key = '$feature_flag'
        AND f.string_value = ?2
       INNER JOIN event_data r
         ON r.website_event_id = e.event_id
        AND r.data_key = '$feature_flag_response'
       LEFT JOIN session s ON s.session_id = e.session_id
       WHERE e.website_id = ?1
         AND e.event_type = ?5
         AND e.event_name = '$feature_flag_called'
         AND e.created_at >= ?3
         AND e.created_at <= ?4
         AND r.string_value IS NOT NULL
         AND r.string_value NOT IN (${nonArm})
     ),
     goal AS (
       SELECT COALESCE(NULLIF(s.distinct_id, ''), e.session_id) AS unit,
              e.created_at AS ts,
              e.event_name AS event_name${propertyLookups}
       FROM website_event e
       LEFT JOIN session s ON s.session_id = e.session_id
       WHERE e.website_id = ?1
         AND e.created_at >= ?3
         AND e.created_at <= ?4
         AND e.event_name IN (${[...eventParams.values()].join(', ')})
     ),
     events AS (
       SELECT unit, ts, 1 AS kind, variant, NULL AS event_name, event_id, session_id, url_path${propertyNulls}
       FROM exposure
       UNION ALL
       SELECT unit, ts, 2 AS kind, NULL, event_name, NULL, NULL, NULL${propertyNames}
       FROM goal
     ),
     tagged AS (
       SELECT events.*,
              FIRST_VALUE(kind) OVER w AS first_kind,
              FIRST_VALUE(ts) OVER w AS first_ts,
              FIRST_VALUE(event_id) OVER w AS first_event_id,
              FIRST_VALUE(session_id) OVER w AS first_session_id,
              FIRST_VALUE(url_path) OVER w AS first_url_path
       FROM events
       WINDOW w AS (PARTITION BY unit ORDER BY kind, ts, event_id)
     ),
     per_unit AS MATERIALIZED (
       SELECT unit,
              MIN(first_ts) AS first_ts,
              MIN(first_event_id) AS event_id,
              MIN(first_session_id) AS session_id,
              MIN(first_url_path) AS url_path,
              COUNT(DISTINCT CASE WHEN kind = 1 THEN variant END) AS variant_count,
              MIN(CASE WHEN kind = 1 THEN variant END) AS variant,
              MIN(CASE WHEN kind = 2 AND event_name = ${primaryEvent} THEN ts END) AS converted_at${unitValues}
       FROM tagged
       WHERE first_kind = 1 AND (kind = 1 OR ts >= first_ts)
       GROUP BY unit
     )
     SELECT 'variant' AS row_type,
            date(first_ts / 1000, 'unixepoch') AS day,
            CASE WHEN variant_count = 1 THEN variant END AS variant,
            COUNT(*) AS units${aggregates},
            NULL AS event_id, NULL AS session_id, NULL AS url_path, NULL AS exposed_at, NULL AS converted_at
     FROM per_unit
     GROUP BY day, CASE WHEN variant_count = 1 THEN variant END
     UNION ALL
     SELECT * FROM (
       SELECT 'recent', NULL, variant, NULL${aggregateNulls},
              event_id, session_id, url_path, first_ts, converted_at
       FROM per_unit
       WHERE variant_count = 1
       ORDER BY first_ts DESC, event_id DESC
       LIMIT ${RECENT_LIMIT}
     )`;
  return { sql, params };
}

type AnalysisRow = Record<string, unknown> & {
  row_type: 'variant' | 'recent';
  day: string | null;
  variant: string | null;
  units: number | null;
  event_id: string | null;
  session_id: string | null;
  url_path: string | null;
  exposed_at: number | null;
  converted_at: number | null;
};

type VariantTotals = { units: number; n: number[]; s: number[]; q: number[] };

// ---------------------------------------------------------------------------------------------
// Statistics per metric
// ---------------------------------------------------------------------------------------------

function emptyTotals(metricCount: number): VariantTotals {
  return {
    units: 0,
    n: Array.from({ length: metricCount }, () => 0),
    s: Array.from({ length: metricCount }, () => 0),
    q: Array.from({ length: metricCount }, () => 0),
  };
}

function orderVariants(variants: Iterable<string>, allocation: ExperimentAllocation | null): string[] {
  const configured = (allocation?.variants ?? []).map((variant) => String(variant.key));
  const rank = (variant: string) => {
    if (variant === CONTROL_VARIANT) return -2;
    const index = configured.indexOf(variant);
    if (index >= 0) return index;
    return variant === 'test' ? configured.length : configured.length + 1;
  };
  return [...new Set(variants)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function emptyComparison(difference: number, lift: number | null): ExperimentComparison {
  return {
    lift,
    difference,
    frequentist: { pValue: null, significant: false, liftInterval: null, differenceInterval: null },
    bayesian: { probabilityToBeatControl: null, liftInterval: null },
  };
}

function analyzeMetric(
  metric: ExperimentMetric,
  index: number,
  arms: string[],
  totals: Map<string, VariantTotals>,
  metricCount: number,
): ExperimentMetricVariantResult[] {
  const get = (variant: string) => totals.get(variant) ?? emptyTotals(metricCount);
  const hasControl = arms.includes(CONTROL_VARIANT);
  const control = get(CONTROL_VARIANT);

  if (metric.type === 'conversion') {
    const controlSample = { n: control.n[index]!, successes: control.s[index]! };
    return arms.map((variant) => {
      const row = get(variant);
      const sample = { n: row.n[index]!, successes: row.s[index]! };
      const value = sample.n > 0 ? sample.successes / sample.n : null;
      const baseline = variant === CONTROL_VARIANT;
      let comparison: ExperimentComparison | null = null;
      if (!baseline && hasControl) {
        const controlRate = controlSample.n > 0 ? controlSample.successes / controlSample.n : 0;
        const difference = (value ?? 0) - controlRate;
        if (sample.n > 0 && controlSample.n > 0) {
          const frequentist = twoProportionZTest(controlSample, sample);
          const bayesian = bayesianProportionComparison(controlSample, sample);
          comparison = {
            lift: frequentist.lift,
            difference,
            frequentist: {
              pValue: frequentist.pValue,
              significant: frequentist.significant,
              liftInterval: frequentist.liftInterval,
              differenceInterval: frequentist.differenceInterval,
            },
            bayesian: {
              probabilityToBeatControl: bayesian.probabilityToBeatControl,
              liftInterval: bayesian.liftInterval,
            },
          };
        } else {
          comparison = emptyComparison(difference, null);
        }
      }
      return {
        variant,
        baseline,
        sampleSize: sample.n,
        value,
        total: sample.successes,
        standardDeviation: value == null ? null : Math.sqrt(value * (1 - value)),
        confidenceInterval: wilsonInterval(sample.successes, sample.n),
        credibleInterval: sample.n > 0 ? betaCredibleInterval(sample) : null,
        comparison,
      };
    });
  }

  const controlSample = meanSampleFromSums(control.n[index]!, control.s[index]!, control.q[index]!);
  return arms.map((variant) => {
    const row = get(variant);
    const sample = meanSampleFromSums(row.n[index]!, row.s[index]!, row.q[index]!);
    const baseline = variant === CONTROL_VARIANT;
    let comparison: ExperimentComparison | null = null;
    if (!baseline && hasControl) {
      const difference = sample.mean - controlSample.mean;
      const lift = controlSample.mean > 0 ? sample.mean / controlSample.mean - 1 : null;
      const frequentist = welchTTest(controlSample, sample);
      const bayesian = bayesianMeanComparison(controlSample, sample);
      comparison =
        sample.n > 0 && controlSample.n > 0
          ? {
              lift,
              difference,
              frequentist: {
                pValue: frequentist.pValue,
                significant: frequentist.significant,
                liftInterval: frequentist.liftInterval,
                differenceInterval: frequentist.differenceInterval,
              },
              bayesian: {
                probabilityToBeatControl: bayesian?.probabilityToBeatControl ?? null,
                liftInterval: bayesian?.liftInterval ?? null,
              },
            }
          : emptyComparison(difference, null);
    }
    return {
      variant,
      baseline,
      sampleSize: sample.n,
      value: sample.n > 0 ? sample.mean : null,
      total: row.s[index]!,
      standardDeviation: sample.n > 1 ? Math.sqrt(sample.variance) : null,
      confidenceInterval: meanInterval(sample),
      credibleInterval: normalCredibleInterval(sample),
      comparison,
    };
  });
}

function buildGuidance(
  metric: ExperimentMetric,
  primary: ExperimentMetricVariantResult[],
  totals: Map<string, VariantTotals>,
  input: ExperimentAnalysisInput,
  now: number,
): ExperimentGuidance | null {
  if (!primary.length) return null;
  const control = primary.find((row) => row.baseline) ?? null;
  const currentUnitsPerVariant = Math.min(...primary.map((row) => row.sampleSize));
  let baseline: number | null = null;
  let requiredUnitsPerVariant: number | null = null;
  let detectableEffect: number | null = null;
  const mde = input.minimumDetectableEffect;
  if (control && control.value != null) {
    baseline = control.value;
    if (metric.type === 'conversion') {
      requiredUnitsPerVariant = requiredSampleSizeForProportion(baseline, mde);
      detectableEffect = minimumDetectableEffectForProportion(baseline, currentUnitsPerVariant);
    } else {
      const controlTotals = totals.get(CONTROL_VARIANT)!;
      const sample = meanSampleFromSums(controlTotals.n[0]!, controlTotals.s[0]!, controlTotals.q[0]!);
      requiredUnitsPerVariant = requiredSampleSizeForMean(sample.mean, sample.variance, mde);
      detectableEffect = minimumDetectableEffectForMean(sample.mean, sample.variance, currentUnitsPerVariant);
    }
  }

  let estimatedDaysRemaining: number | null = null;
  if (requiredUnitsPerVariant != null) {
    if (currentUnitsPerVariant >= requiredUnitsPerVariant) {
      estimatedDaysRemaining = 0;
    } else if (!input.ended) {
      const elapsedDays = (Math.min(now, input.endAt) - input.startAt) / DAY_MS;
      if (elapsedDays > 0) {
        let days = 0;
        for (const row of primary) {
          const perDay = row.sampleSize / elapsedDays;
          if (!(perDay > 0)) {
            days = Number.POSITIVE_INFINITY;
            break;
          }
          days = Math.max(days, (requiredUnitsPerVariant - row.sampleSize) / perDay);
        }
        estimatedDaysRemaining = Number.isFinite(days) ? Math.ceil(days) : null;
      }
    }
  }

  return {
    metricType: metric.type,
    baseline,
    minimumDetectableEffect: mde,
    requiredUnitsPerVariant,
    currentUnitsPerVariant,
    detectableEffect,
    estimatedDaysRemaining,
    alpha: DEFAULT_ALPHA,
    power: DEFAULT_POWER,
  };
}

function buildSummary(
  primaryMetric: ExperimentMetric,
  primary: ExperimentMetricVariantResult[],
  guidance: ExperimentGuidance | null,
  srm: SampleRatioCheck | null,
  units: { total: number; excluded: number; control: number; controlExpected: boolean },
): ExperimentResultSummary {
  const totalUnits = units.total;
  const challengers = primary.filter((row) => !row.baseline);
  const minimumSampleReached =
    primary.length >= 2 &&
    primary.every((row) => row.sampleSize >= MIN_UNITS_PER_VARIANT) &&
    (primaryMetric.type !== 'conversion' ||
      primary.reduce((sum, row) => sum + row.total, 0) >= MIN_TOTAL_CONVERSIONS);
  const plannedSampleReached =
    guidance?.requiredUnitsPerVariant != null &&
    primary.length >= 2 &&
    primary.every((row) => row.sampleSize >= guidance.requiredUnitsPerVariant!);

  const effect = (row: ExperimentMetricVariantResult) => row.comparison?.lift ?? row.comparison?.difference ?? 0;
  const winners = challengers
    .filter((row) => row.comparison?.frequentist.significant && (row.comparison.difference ?? 0) > 0)
    .sort((a, b) => effect(b) - effect(a));
  const losers = challengers.filter(
    (row) => row.comparison?.frequentist.significant && (row.comparison.difference ?? 0) < 0,
  );
  const leader =
    primary
      .filter((row) => row.value != null)
      .sort((a, b) => b.value! - a.value! || b.sampleSize - a.sampleSize)[0] ?? null;
  const bayesianLeader =
    challengers
      .filter((row) => row.comparison?.bayesian.probabilityToBeatControl != null)
      .sort(
        (a, b) => b.comparison!.bayesian.probabilityToBeatControl! - a.comparison!.bayesian.probabilityToBeatControl!,
      )[0] ?? null;

  // A control arm that the flag should serve but has no units yet is still arriving.
  const missingControl = totalUnits > 0 && units.control === 0 && !units.controlExpected;
  const srmMismatch = srm?.status === 'mismatch';
  const decision: ExperimentDecision = (() => {
    if (!totalUnits) return 'no_data';
    if (missingControl || srmMismatch) return 'fix_setup';
    if (minimumSampleReached && winners.length) return 'ship_variant';
    if (minimumSampleReached && (plannedSampleReached || (challengers.length && losers.length === challengers.length))) {
      return 'keep_control';
    }
    return 'keep_collecting';
  })();

  const diagnostics: ExperimentDiagnostic[] = [];
  if (!totalUnits) diagnostics.push({ code: 'no_exposures', level: 'info' });
  if (missingControl) diagnostics.push({ code: 'missing_control', level: 'warning' });
  if (srmMismatch) diagnostics.push({ code: 'sample_ratio_mismatch', level: 'error' });
  if (totalUnits && !minimumSampleReached) diagnostics.push({ code: 'low_sample', level: 'info' });
  if (decision === 'ship_variant') diagnostics.push({ code: 'significant_variant', level: 'success' });
  if (minimumSampleReached && losers.length) diagnostics.push({ code: 'variant_worse', level: 'warning' });
  if (minimumSampleReached && !winners.length && !srmMismatch && !missingControl) {
    diagnostics.push({ code: 'no_significant_winner', level: 'info' });
  }

  return {
    totalUnits,
    excludedUnits: units.excluded,
    controlVariant: units.control > 0 ? CONTROL_VARIANT : null,
    leaderVariant: leader?.variant ?? null,
    leaderLift: leader?.comparison?.lift ?? null,
    significantVariant: decision === 'ship_variant' ? winners[0]!.variant : null,
    bayesianLeader: bayesianLeader?.variant ?? null,
    bayesianLeaderProbability: bayesianLeader?.comparison?.bayesian.probabilityToBeatControl ?? null,
    minimumSampleReached,
    plannedSampleReached,
    decision,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export async function getExperimentResults(
  env: Env,
  websiteId: string,
  input: ExperimentAnalysisInput,
): Promise<ExperimentResults> {
  const now = input.now ?? Date.now();
  const metrics = [input.primaryMetric, ...input.secondaryMetrics];
  const query = buildExperimentAnalysisQuery(websiteId, input, metrics);
  const { results } = await siteDb(env, websiteId)
    .prepare(query.sql)
    .bind(...query.params)
    .all<AnalysisRow>();
  const rows = results ?? [];

  const totals = new Map<string, VariantTotals>();
  const trendByKey = new Map<string, { date: string; variant: string; units: number; n: number; s: number }>();
  const recent: ExperimentRecentExposure[] = [];
  let excludedUnits = 0;
  for (const row of rows) {
    if (row.row_type === 'recent') {
      recent.push({
        id: String(row.event_id),
        sessionId: String(row.session_id),
        variant: String(row.variant),
        urlPath: row.url_path,
        exposedAt: Number(row.exposed_at),
        converted: row.converted_at != null,
        convertedAt: row.converted_at == null ? null : Number(row.converted_at),
      });
      continue;
    }
    const units = Number(row.units ?? 0);
    if (row.variant == null) {
      excludedUnits += units;
      continue;
    }
    const current = totals.get(row.variant) ?? emptyTotals(metrics.length);
    current.units += units;
    metrics.forEach((_, index) => {
      current.n[index]! += Number(row[`n${index}`] ?? 0);
      current.s[index]! += Number(row[`s${index}`] ?? 0);
      current.q[index]! += Number(row[`q${index}`] ?? 0);
    });
    totals.set(row.variant, current);
    const date = row.day ?? '';
    trendByKey.set(`${date}\u0000${row.variant}`, {
      date,
      variant: row.variant,
      units,
      n: Number(row.n0 ?? 0),
      s: Number(row.s0 ?? 0),
    });
  }

  const expected = input.allocation ? expectedVariantShares(input.allocation).shares : {};
  const arms = orderVariants([...totals.keys(), ...Object.keys(expected)], input.allocation);
  const totalUnits = [...totals.values()].reduce((sum, row) => sum + row.units, 0);
  const observed = Object.fromEntries(arms.map((variant) => [variant, totals.get(variant)?.units ?? 0]));
  const srm = input.allocation && totalUnits > 0 ? checkSampleRatio(observed, input.allocation) : null;

  const metricResults: ExperimentMetricResult[] = metrics.map((metric, index) => ({
    role: index === 0 ? 'primary' : 'secondary',
    metric,
    variants: analyzeMetric(metric, index, arms, totals, metrics.length),
  }));
  const primary = metricResults[0]!.variants;
  const guidance = totalUnits > 0 ? buildGuidance(input.primaryMetric, primary, totals, input, now) : null;
  const summary = buildSummary(input.primaryMetric, primary, guidance, srm, {
    total: totalUnits,
    excluded: excludedUnits,
    control: totals.get(CONTROL_VARIANT)?.units ?? 0,
    controlExpected: (expected[CONTROL_VARIANT] ?? 0) > 0,
  });

  const rank = new Map(arms.map((variant, index) => [variant, index]));
  return {
    window: { startAt: input.startAt, endAt: input.endAt },
    variants: arms.map((variant) => {
      const units = totals.get(variant)?.units ?? 0;
      return {
        variant,
        baseline: variant === CONTROL_VARIANT,
        units,
        share: totalUnits ? units / totalUnits : 0,
        expectedShare: srm && variant in srm.expectedShares ? srm.expectedShares[variant]! : null,
      };
    }),
    srm,
    metrics: metricResults,
    guidance,
    summary,
    recent: recent.sort((a, b) => b.exposedAt - a.exposedAt || b.id.localeCompare(a.id)),
    trend: [...trendByKey.values()]
      .sort((a, b) => a.date.localeCompare(b.date) || (rank.get(a.variant) ?? 0) - (rank.get(b.variant) ?? 0))
      .map((row) => ({
        date: row.date,
        variant: row.variant,
        units: row.units,
        value: row.n > 0 ? row.s / row.n : null,
      })),
  };
}
