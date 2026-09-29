import { resolveFlagTargetingContext } from '@flareboard/db';
import {
  evaluateFeatureFlag,
  normalizeFeatureFlagConfig,
  type FeatureFlagEvaluationContext,
  type FeatureFlagEvaluationResult,
  type NormalizedFeatureFlagConfig,
} from '@flareboard/shared';
import type { Env } from '../env';
import { siteDb } from './site-db';

/** feature_flag columns needed to evaluate a flag and describe it to the tracker. */
export const FLAG_COLUMNS = `key, enabled, rollout, variants, targeting_rules AS targetingRules,
  condition_groups AS conditionGroups, payload, early_access AS earlyAccess,
  early_access_name AS earlyAccessName, early_access_description AS earlyAccessDescription, name`;

export type FlagRow = {
  key: string;
  name: string;
  enabled: number;
  rollout: number;
  variants: string | null;
  targetingRules: string | null;
  conditionGroups: string | null;
  payload: string | null;
  earlyAccess: number;
  earlyAccessName: string;
  earlyAccessDescription: string;
};

export function flagConfig(row: FlagRow): NormalizedFeatureFlagConfig {
  return normalizeFeatureFlagConfig(row);
}

export async function getEnabledFlags(env: Env, websiteId: string) {
  const rows = await env.DB.prepare(
    `SELECT ${FLAG_COLUMNS}
     FROM feature_flag
     WHERE website_id = ?1 AND enabled = 1
     ORDER BY created_at ASC`,
  )
    .bind(websiteId)
    .all<FlagRow>();
  return rows.results ?? [];
}

/** Filtered in code: a site's flags are few, and D1 caps bound parameters at 100. */
export async function getEnabledFlagsByKeys(env: Env, websiteId: string, keys: string[]) {
  if (!keys.length) return [];
  const wanted = new Set(keys);
  return (await getEnabledFlags(env, websiteId)).filter((row) => wanted.has(row.key));
}

/** Evaluates flags with the person, group and cohort data they target. */
export async function evaluateFlags(
  env: Env,
  websiteId: string,
  flags: NormalizedFeatureFlagConfig[],
  context: FeatureFlagEvaluationContext,
): Promise<FeatureFlagEvaluationResult[]> {
  if (!flags.length) return [];
  const resolved = await resolveFlagTargetingContext(
    { db: env.DB, site: siteDb(env, websiteId), cache: env.CACHE },
    websiteId,
    flags,
    context,
  );
  return flags.map((flag) => evaluateFeatureFlag(flag, resolved));
}

export type EvaluatedFlag = {
  key: string;
  flagId: string;
  /** The flag has variants (its value is a variant key, not true/false). */
  multivariate: boolean;
  evaluation: FeatureFlagEvaluationResult;
  /** JSON payload served with the evaluated variant; PostHog `/decide` + `/flags` return it as a string. */
  payload?: unknown;
};

export async function hasEnabledFlags(env: Env, websiteId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS found FROM feature_flag WHERE website_id = ?1 AND enabled = 1 LIMIT 1`)
    .bind(websiteId)
    .first<{ found: number }>();
  return Boolean(row);
}

/** Every enabled flag of a website evaluated for one context (PostHog `/decide` and `/flags`). */
export async function evaluateAllFlags(
  env: Env,
  websiteId: string,
  context: FeatureFlagEvaluationContext,
  onlyKeys?: string[],
): Promise<EvaluatedFlag[]> {
  const rows = await env.DB.prepare(
    `SELECT flag_id AS flagId, ${FLAG_COLUMNS}
     FROM feature_flag
     WHERE website_id = ?1 AND enabled = 1
     ORDER BY created_at ASC`,
  )
    .bind(websiteId)
    .all<FlagRow & { flagId: string }>();
  const wanted = onlyKeys?.length ? new Set(onlyKeys) : null;
  const selected = (rows.results ?? []).filter((row) => !wanted || wanted.has(row.key));
  const configs = selected.map(flagConfig);
  const evaluations = await evaluateFlags(env, websiteId, configs, context);
  return selected.map((row, index) => {
    const evaluation = evaluations[index]!;
    return {
      key: row.key,
      flagId: row.flagId,
      multivariate: configs[index]!.variants.length > 0,
      evaluation,
      payload: evaluation.enabled && evaluation.payload !== null ? evaluation.payload : undefined,
    };
  });
}
