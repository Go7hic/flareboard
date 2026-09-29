import type {
  FeatureFlagConditionGroup,
  FeatureFlagConfigForEvaluation,
  FeatureFlagJsonValue,
  FeatureFlagRule,
  FeatureFlagRuleField,
  FeatureFlagRuleOperator,
  FeatureFlagVariantConfig,
} from './feature-flag-evaluator';
import { resolveConditionGroups } from './feature-flag-evaluator';

/**
 * A feature_flag row as read from D1, before normalization. JSON columns may arrive as text
 * (raw D1 rows) or already parsed (Drizzle `mode: 'json'` columns).
 */
export type FeatureFlagRowInput = {
  key: string;
  enabled: unknown;
  rollout?: unknown;
  variants?: unknown;
  targetingRules?: unknown;
  conditionGroups?: unknown;
  /** Raw JSON text of the `payload` column (a JSON string payload is stored quoted). */
  payload?: string | null;
  earlyAccess?: unknown;
};

/** A flag ready for evaluation: condition groups resolved (legacy rows included), JSON parsed. */
export type NormalizedFeatureFlagConfig = FeatureFlagConfigForEvaluation & {
  enabled: boolean;
  conditionGroups: FeatureFlagConditionGroup[];
  variants: FeatureFlagVariantConfig[];
  payload: FeatureFlagJsonValue | null;
  earlyAccess: boolean;
};

function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function clampPercent(value: unknown, fallback = 100) {
  const number = Number(value);
  if (value == null || !Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Parses the raw `payload` column; JSON `null`, empty or malformed text mean "no payload". */
export function parsePayloadColumn(raw: string | null | undefined): FeatureFlagJsonValue | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return payloadValue(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Serializes a payload for the `payload` column (null clears it). */
export function serializePayloadColumn(payload: FeatureFlagJsonValue | null | undefined): string | null {
  return payload === undefined || payload === null ? null : JSON.stringify(payload);
}

function payloadValue(value: unknown): FeatureFlagJsonValue | null {
  return value === undefined || value === null ? null : (value as FeatureFlagJsonValue);
}

export function normalizeFeatureFlagVariants(raw: unknown): FeatureFlagVariantConfig[] {
  const parsed = parseJsonColumn(raw);
  if (!Array.isArray(parsed)) return [];
  const variants: FeatureFlagVariantConfig[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const key = text(row.key);
    if (!key) continue;
    const variant: FeatureFlagVariantConfig = {
      key,
      name: typeof row.name === 'string' && row.name.trim() ? row.name : key,
      weight: clampPercent(row.weight, 0),
    };
    const payload = payloadValue(row.payload);
    if (payload !== null) variant.payload = payload;
    variants.push(variant);
  }
  return variants;
}

export function normalizeFeatureFlagRules(raw: unknown): FeatureFlagRule[] {
  const parsed = parseJsonColumn(raw);
  if (!Array.isArray(parsed)) return [];
  const rules: FeatureFlagRule[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.field !== 'string' || typeof row.operator !== 'string') continue;
    const rule: FeatureFlagRule = {
      field: row.field as FeatureFlagRuleField,
      operator: row.operator as FeatureFlagRuleOperator,
      value: typeof row.value === 'string' ? row.value : row.value == null ? '' : String(row.value),
    };
    if (typeof row.key === 'string' && row.key) rule.key = row.key;
    if (typeof row.groupType === 'string' && row.groupType) rule.groupType = row.groupType;
    rules.push(rule);
  }
  return rules;
}

export function normalizeFeatureFlagConditionGroups(raw: unknown): FeatureFlagConditionGroup[] {
  const parsed = parseJsonColumn(raw);
  if (!Array.isArray(parsed)) return [];
  const groups: FeatureFlagConditionGroup[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const group: FeatureFlagConditionGroup = {
      conditions: normalizeFeatureFlagRules(row.conditions),
      rollout: clampPercent(row.rollout),
    };
    const variant = text(row.variant);
    if (variant) group.variant = variant;
    if (typeof row.description === 'string' && row.description.trim()) group.description = row.description.trim();
    groups.push(group);
  }
  return groups;
}

/**
 * Normalizes a stored flag for evaluation. Rows without condition groups (written before
 * migration 0045, or by older code during a deploy) fall back to their legacy
 * `targeting_rules` + `rollout` columns as a single group.
 */
export function normalizeFeatureFlagConfig(row: FeatureFlagRowInput): NormalizedFeatureFlagConfig {
  const base = {
    key: row.key,
    enabled: row.enabled === true || row.enabled === 1 || row.enabled === '1',
    variants: normalizeFeatureFlagVariants(row.variants),
    payload: parsePayloadColumn(row.payload),
    earlyAccess: row.earlyAccess === true || row.earlyAccess === 1 || row.earlyAccess === '1',
  };
  const conditionGroups = resolveConditionGroups({
    key: row.key,
    enabled: base.enabled,
    conditionGroups: normalizeFeatureFlagConditionGroups(row.conditionGroups),
    targetingRules: normalizeFeatureFlagRules(row.targetingRules),
    rollout: clampPercent(row.rollout),
  });
  return { ...base, conditionGroups };
}

/**
 * Values mirrored into the deprecated `rollout` / `targeting_rules` columns so readers that
 * predate condition groups (and a code rollback) see the first group.
 */
export function legacyFeatureFlagColumns(groups: FeatureFlagConditionGroup[]) {
  const [first] = groups;
  return { rollout: first ? first.rollout : 100, targetingRules: first ? first.conditions : [] };
}
