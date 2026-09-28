import { resolveFlagTargetingContext } from '@flareboard/db';
import {
  evaluateFeatureFlag,
  normalizeFeatureFlagConfig,
  type FeatureFlagEvaluationContext,
  type FeatureFlagEvaluationResult,
  type NormalizedFeatureFlagConfig,
} from '@flareboard/shared';
import type { Env } from '../env';

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

/**
 * Handle for the website's analytics tables (person, session, session_data, …). Mirrors
 * `siteDb` in apps/api/src/lib/site-db.ts: today the shared D1 database; the storage migration
 * swaps it for the website's Durable Object.
 */
export function siteTables(env: Env, websiteId: string): D1Database {
  void websiteId;
  return env.DB;
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
    { db: env.DB, site: siteTables(env, websiteId), cache: env.CACHE },
    websiteId,
    flags,
    context,
  );
  return flags.map((flag) => evaluateFeatureFlag(flag, resolved));
}
