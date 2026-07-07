import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';

export type ExperimentVariantResult = {
  variant: string;
  exposures: number;
  conversions: number;
  conversionRate: number;
  lift: number | null;
  baseline: boolean;
  confidenceIntervalLow: number;
  confidenceIntervalHigh: number;
  pValue: number | null;
  confidence: number | null;
  significant: boolean;
};

export type ExperimentDiagnosticCode =
  | 'no_exposures'
  | 'missing_control'
  | 'low_sample'
  | 'traffic_imbalanced'
  | 'significant_variant'
  | 'no_significant_winner';

export type ExperimentDiagnostic = {
  code: ExperimentDiagnosticCode;
  level: 'info' | 'warning' | 'success';
};

export type ExperimentResultSummary = {
  totalExposures: number;
  totalConversions: number;
  conversionRate: number;
  /** True when the exposure sample hit the query cap and results are partial. */
  truncated?: boolean;
  controlVariant: string | null;
  controlConversionRate: number | null;
  leaderVariant: string | null;
  leaderConversionRate: number | null;
  leaderLift: number | null;
  significantVariant: string | null;
  maxConfidence: number | null;
  trafficImbalanced: boolean;
  sampleReady: boolean;
  sampleSize: {
    minimumExposuresPerVariant: number;
    minimumConversions: number;
    currentMinExposures: number;
    remainingExposures: number;
    remainingConversions: number;
    ready: boolean;
  };
  decision: 'no_data' | 'fix_setup' | 'keep_collecting' | 'ship_variant' | 'keep_control';
  recommendation: 'no_data' | 'collect_more_data' | 'variant_leading' | 'control_leading' | 'no_control';
  conclusion: {
    status: 'no_data' | 'setup_issue' | 'collecting' | 'winner' | 'keep_control';
    variant: string | null;
    action: ExperimentResultSummary['decision'];
    confidence: number | null;
  };
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
  exposures: number;
  conversions: number;
  conversionRate: number;
};

function buildSummary(variants: ExperimentVariantResult[]): ExperimentResultSummary {
  const minimumExposuresPerVariant = 30;
  const minimumConversions = 10;
  const totalExposures = variants.reduce((sum, row) => sum + row.exposures, 0);
  const totalConversions = variants.reduce((sum, row) => sum + row.conversions, 0);
  const conversionRate = totalExposures
    ? Math.round((totalConversions / totalExposures) * 10000) / 100
    : 0;
  const control = variants.find((row) => row.baseline) ?? null;
  const nonControl = variants.filter((row) => !row.baseline);
  const leader = variants.reduce<ExperimentVariantResult | null>((best, row) => {
    if (!best) return row;
    if (row.conversionRate > best.conversionRate) return row;
    if (row.conversionRate === best.conversionRate && row.exposures > best.exposures) return row;
    return best;
  }, null);
  const significantLeader = nonControl
    .filter((row) => row.significant)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || b.conversionRate - a.conversionRate)[0] ?? null;
  const maxConfidence = nonControl.reduce<number | null>((best, row) => {
    if (row.confidence == null) return best;
    return best == null ? row.confidence : Math.max(best, row.confidence);
  }, null);
  const expectedShare = variants.length ? 100 / variants.length : 0;
  const trafficImbalanced =
    variants.length >= 2 &&
    variants.some((row) => {
      const share = totalExposures ? (row.exposures / totalExposures) * 100 : 0;
      return Math.abs(share - expectedShare) > Math.max(20, expectedShare * 0.5);
    });
  const sampleReady =
    variants.length >= 2 &&
    variants.every((row) => row.exposures >= minimumExposuresPerVariant) &&
    totalConversions >= minimumConversions;
  const sampleSize = {
    minimumExposuresPerVariant,
    minimumConversions,
    currentMinExposures: variants.length ? Math.min(...variants.map((row) => row.exposures)) : 0,
    remainingExposures: variants.reduce(
      (sum, row) => sum + Math.max(0, minimumExposuresPerVariant - row.exposures),
      0,
    ),
    remainingConversions: Math.max(0, minimumConversions - totalConversions),
    ready: sampleReady,
  };
  const recommendation = (() => {
    if (!variants.length) return 'no_data';
    if (!control) return 'no_control';
    if (!sampleReady) return 'collect_more_data';
    return leader?.baseline ? 'control_leading' : 'variant_leading';
  })();
  const decision = (() => {
    if (!variants.length) return 'no_data';
    if (!control) return 'fix_setup';
    if (significantLeader) return 'ship_variant';
    if (sampleReady && leader?.baseline) return 'keep_control';
    return 'keep_collecting';
  })();
  const diagnostics: ExperimentDiagnostic[] = (() => {
    if (!variants.length) return [{ code: 'no_exposures', level: 'info' }];
    if (!control) return [{ code: 'missing_control', level: 'warning' }];
    const items: ExperimentDiagnostic[] = [];
    if (!sampleReady) items.push({ code: 'low_sample', level: 'info' });
    if (trafficImbalanced) items.push({ code: 'traffic_imbalanced', level: 'warning' });
    if (significantLeader) items.push({ code: 'significant_variant', level: 'success' });
    if (sampleReady && !significantLeader) items.push({ code: 'no_significant_winner', level: 'info' });
    return items;
  })();
  const conclusion: ExperimentResultSummary['conclusion'] = (() => {
    if (!variants.length) return { status: 'no_data', variant: null, action: decision, confidence: null };
    if (!control) return { status: 'setup_issue', variant: null, action: decision, confidence: null };
    if (significantLeader) {
      return {
        status: 'winner',
        variant: significantLeader.variant,
        action: decision,
        confidence: significantLeader.confidence,
      };
    }
    if (sampleReady && leader?.baseline) {
      return { status: 'keep_control', variant: leader.variant, action: decision, confidence: maxConfidence };
    }
    return { status: 'collecting', variant: leader?.variant ?? null, action: decision, confidence: maxConfidence };
  })();

  return {
    totalExposures,
    totalConversions,
    conversionRate,
    controlVariant: control?.variant ?? null,
    controlConversionRate: control?.conversionRate ?? null,
    leaderVariant: leader?.variant ?? null,
    leaderConversionRate: leader?.conversionRate ?? null,
    leaderLift: leader?.lift ?? null,
    significantVariant: significantLeader?.variant ?? null,
    maxConfidence,
    trafficImbalanced,
    sampleReady,
    sampleSize,
    decision,
    recommendation,
    conclusion,
    diagnostics,
  };
}

const EXPOSURE_SAMPLE_LIMIT = 500;
// D1 caps bound parameters per statement at 100; leave headroom for the
// five named parameters.
const SESSION_IN_CHUNK_SIZE = 90;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function twoProportionPValue(
  conversions: number,
  exposures: number,
  controlConversions: number,
  controlExposures: number,
) {
  if (!exposures || !controlExposures) return null;
  const p1 = conversions / exposures;
  const p2 = controlConversions / controlExposures;
  const pooled = (conversions + controlConversions) / (exposures + controlExposures);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / exposures + 1 / controlExposures));
  if (!standardError) return null;
  const z = (p1 - p2) / standardError;
  return round2(2 * (1 - normalCdf(Math.abs(z))) * 100);
}

function wilsonInterval(conversions: number, exposures: number) {
  if (!exposures) return { low: 0, high: 0 };
  const z = 1.96;
  const p = conversions / exposures;
  const denominator = 1 + (z * z) / exposures;
  const center = p + (z * z) / (2 * exposures);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * exposures)) / exposures);
  return {
    low: round2(Math.max(0, ((center - margin) / denominator) * 100)),
    high: round2(Math.min(100, ((center + margin) / denominator) * 100)),
  };
}

export async function getExperimentResults(
  env: Env,
  websiteId: string,
  flagKey: string,
  goalEvent: string,
  startAt: number,
  endAt: number,
): Promise<{
  summary: ExperimentResultSummary;
  variants: ExperimentVariantResult[];
  recent: ExperimentRecentExposure[];
  trend: ExperimentTrendRow[];
}> {
  const exposureRows = await env.DB.prepare(
    `SELECT
       MIN(e.event_id) as id,
       e.session_id as sessionId,
       response.string_value as variant,
       MIN(e.url_path) as urlPath,
       MIN(e.created_at) as exposedAt
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     INNER JOIN event_data response
       ON response.website_event_id = e.event_id
      AND response.data_key = '$feature_flag_response'
     WHERE e.website_id = ?1
       AND e.event_type = ?5
       AND e.event_name = '$feature_flag_called'
       AND e.created_at >= ?3
       AND e.created_at <= ?4
     GROUP BY e.session_id, response.string_value
     LIMIT ${EXPOSURE_SAMPLE_LIMIT}`,
  )
    .bind(websiteId, flagKey, startAt, endAt, EVENT_TYPE.customEvent)
    .all<{ id: string; sessionId: string; variant: string; urlPath: string | null; exposedAt: number }>();

  const exposures = exposureRows.results ?? [];
  const truncated = exposures.length >= EXPOSURE_SAMPLE_LIMIT;
  const conversionRows: Array<{ sessionId: string; variant: string; convertedAt: number }> = [];
  // D1 limits bound parameters per statement, so the session list is chunked.
  const sessionIds = [...new Set(exposures.map((row) => row.sessionId))];
  for (let offset = 0; offset < sessionIds.length; offset += SESSION_IN_CHUNK_SIZE) {
    const chunk = sessionIds.slice(offset, offset + SESSION_IN_CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await env.DB.prepare(
      `SELECT e.session_id as sessionId,
              variant.string_value as variant,
              MIN(e.created_at) as convertedAt
       FROM website_event e
       INNER JOIN event_data variant
         ON variant.website_event_id = e.event_id
        AND variant.data_key = ?2
       WHERE e.website_id = ?1
         AND e.event_name = ?3
         AND e.created_at >= ?4
         AND e.created_at <= ?5
         AND e.session_id IN (${placeholders})
       GROUP BY e.session_id, variant.string_value`,
    )
      .bind(websiteId, `$feature/${flagKey}`, goalEvent, startAt, endAt, ...chunk)
      .all<{ sessionId: string; variant: string; convertedAt: number }>();
    conversionRows.push(...(result.results ?? []));
  }

  const conversionBySessionVariant = new Map<string, number>();
  for (const row of conversionRows) {
    conversionBySessionVariant.set(`${row.sessionId}:${row.variant}`, row.convertedAt);
  }

  const byVariant = new Map<string, { exposures: number; conversions: number }>();
  const trendByDay = new Map<string, { date: string; variant: string; exposures: number; conversions: number }>();
  const recent: ExperimentRecentExposure[] = [];
  for (const row of exposures) {
    const current = byVariant.get(row.variant) ?? { exposures: 0, conversions: 0 };
    current.exposures += 1;
    byVariant.set(row.variant, current);
  }

  for (const row of exposures) {
    const convertedAt = conversionBySessionVariant.get(`${row.sessionId}:${row.variant}`);
    const conversion =
      convertedAt != null && convertedAt >= row.exposedAt ? { convertedAt } : null;
    if (conversion) {
      const current = byVariant.get(row.variant);
      if (current) current.conversions += 1;
    }
    const date = new Date(row.exposedAt).toISOString().slice(0, 10);
    const trendKey = `${date}:${row.variant}`;
    const trendRow = trendByDay.get(trendKey) ?? {
      date,
      variant: row.variant,
      exposures: 0,
      conversions: 0,
    };
    trendRow.exposures += 1;
    if (conversion) trendRow.conversions += 1;
    trendByDay.set(trendKey, trendRow);
    recent.push({
      id: row.id,
      sessionId: row.sessionId,
      variant: row.variant,
      urlPath: row.urlPath,
      exposedAt: row.exposedAt,
      converted: Boolean(conversion),
      convertedAt: conversion?.convertedAt ?? null,
    });
  }

  const order = (variant: string) => (variant === 'control' ? 0 : variant === 'test' ? 1 : 2);
  const variants = [...byVariant.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([variant, value]) => ({
      variant,
      exposures: value.exposures,
      conversions: value.conversions,
      conversionRate: value.exposures ? Math.round((value.conversions / value.exposures) * 10000) / 100 : 0,
    }));
  const controlRate = variants.find((row) => row.variant === 'control')?.conversionRate ?? null;

  const control = variants.find((row) => row.variant === 'control') ?? null;
  const results = variants.map((row) => {
    const interval = wilsonInterval(row.conversions, row.exposures);
    const pValue =
      row.variant === 'control' || !control
        ? null
        : twoProportionPValue(row.conversions, row.exposures, control.conversions, control.exposures);
    const confidence = pValue == null ? null : round2(100 - pValue);
    return {
      ...row,
      lift:
        row.variant === 'control' || !controlRate
          ? null
          : Math.round(((row.conversionRate - controlRate) / controlRate) * 10000) / 100,
      baseline: row.variant === 'control',
      confidenceIntervalLow: interval.low,
      confidenceIntervalHigh: interval.high,
      pValue,
      confidence,
      significant: confidence != null && confidence >= 95,
    };
  });

  return {
    summary: { ...buildSummary(results), truncated },
    variants: results,
    recent: recent.sort((a, b) => b.exposedAt - a.exposedAt || b.id.localeCompare(a.id)).slice(0, 20),
    trend: [...trendByDay.values()]
      .sort((a, b) => a.date.localeCompare(b.date) || order(a.variant) - order(b.variant) || a.variant.localeCompare(b.variant))
      .map((row) => ({
        ...row,
        conversionRate: row.exposures ? Math.round((row.conversions / row.exposures) * 10000) / 100 : 0,
      })),
  };
}
