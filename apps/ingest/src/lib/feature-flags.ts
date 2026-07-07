import {
  evaluateFeatureFlag,
  type FeatureFlagEvaluationContext,
  type FeatureFlagRule,
  type FeatureFlagVariantConfig,
} from '@flareboard/shared';
import type { Env } from '../env';

type FlagRow = {
  key: string;
  enabled: number;
  rollout: number;
  variants: string | null;
  targetingRules: string | null;
};

export function hasTargetingRules(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

function parseVariants(raw: string | null): FeatureFlagVariantConfig[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof (item as { key?: string }).key === 'string')
      .map((item) => {
        const row = item as { key: string; name?: string; weight?: number };
        return {
          key: row.key,
          name: typeof row.name === 'string' ? row.name : row.key,
          weight: Math.min(100, Math.max(0, Number(row.weight ?? 0))),
        };
      });
  } catch {
    return [];
  }
}

function parseTargetingRules(raw: string | null): FeatureFlagRule[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is FeatureFlagRule =>
        Boolean(
          item &&
            typeof (item as FeatureFlagRule).field === 'string' &&
            typeof (item as FeatureFlagRule).operator === 'string' &&
            typeof (item as FeatureFlagRule).value === 'string',
        ),
    );
  } catch {
    return [];
  }
}

export async function getEnabledFlagByKey(env: Env, websiteId: string, key: string) {
  const row = await env.DB.prepare(
    `SELECT key, enabled, rollout, variants, targeting_rules as targetingRules
     FROM feature_flag
     WHERE website_id = ?1 AND key = ?2 AND enabled = 1
     LIMIT 1`,
  )
    .bind(websiteId, key)
    .first<FlagRow>();
  return row ?? null;
}

export async function getEnabledFlagsByKeys(env: Env, websiteId: string, keys: string[]) {
  if (!keys.length) return [];
  const placeholders = keys.map(() => '?').join(', ');
  const rows = await env.DB.prepare(
    `SELECT key, enabled, rollout, variants, targeting_rules as targetingRules
     FROM feature_flag
     WHERE website_id = ?1 AND enabled = 1 AND key IN (${placeholders})`,
  )
    .bind(websiteId, ...keys)
    .all<FlagRow>();
  return rows.results ?? [];
}

export function evaluateFlagRow(row: FlagRow, context: FeatureFlagEvaluationContext) {
  return evaluateFeatureFlag(
    {
      key: row.key,
      enabled: Boolean(row.enabled),
      rollout: row.rollout,
      variants: parseVariants(row.variants),
      targetingRules: parseTargetingRules(row.targetingRules),
    },
    context,
  );
}
