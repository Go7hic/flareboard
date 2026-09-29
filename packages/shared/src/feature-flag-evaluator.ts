import { flagBucketingId, rolloutBucket, variantBucket } from './flag-hash';

/** Any JSON value. Flag payloads are stored and returned verbatim. */
export type FeatureFlagJsonValue =
  | null
  | boolean
  | number
  | string
  | FeatureFlagJsonValue[]
  | { [key: string]: FeatureFlagJsonValue };

export type FeatureFlagVariantConfig = {
  key: string;
  name?: string;
  weight?: number;
  /** Returned with the evaluation when this variant is served. */
  payload?: FeatureFlagJsonValue;
};

export type FeatureFlagRuleOperator =
  | 'equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'not_equals'
  | 'not_contains'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'exists'
  | 'not_exists'
  | 'in_cohort'
  | 'not_in_cohort';

export type FeatureFlagRuleField =
  | 'path'
  | 'url'
  | 'hostname'
  | 'referrer'
  | 'language'
  | 'userAgent'
  | 'distinctId'
  | 'userId'
  | 'environment'
  | 'release'
  /** Group key the caller belongs to for group type `key`. */
  | 'group'
  /** Request / event property `key` supplied by the caller. */
  | 'property'
  /** Person property `key` (stored person properties merged with caller-supplied ones). */
  | 'person'
  /** Property `key` of the caller's group of type `groupType`. */
  | 'group_property'
  /** Membership of cohort `value` (operators `in_cohort` / `not_in_cohort`). */
  | 'cohort';

export type FeatureFlagRule = {
  field: FeatureFlagRuleField;
  operator: FeatureFlagRuleOperator;
  value: string;
  key?: string;
  groupType?: string;
};

/** One release condition group: AND-ed conditions, its own rollout and an optional variant override. */
export type FeatureFlagConditionGroup = {
  conditions: FeatureFlagRule[];
  rollout: number;
  variant?: string | null;
  description?: string;
};

export type FeatureFlagConfigForEvaluation = {
  key: string;
  enabled: boolean;
  /**
   * Condition groups, OR-ed in order. When absent or empty the legacy single-group
   * `targetingRules` + `rollout` pair is used instead (rows written before migration 0045).
   */
  conditionGroups?: FeatureFlagConditionGroup[];
  /** @deprecated legacy single group; read only when `conditionGroups` is empty. */
  rollout?: number;
  /** @deprecated legacy single group; read only when `conditionGroups` is empty. */
  targetingRules?: FeatureFlagRule[];
  variants?: FeatureFlagVariantConfig[];
  /** Payload of a boolean (non-multivariate) flag. */
  payload?: FeatureFlagJsonValue;
  /** Early access features honour the `$feature_enrollment/<key>` person property. */
  earlyAccess?: boolean;
};

export type FeatureFlagEvaluationContext = {
  distinctId?: string;
  userId?: string;
  sessionId?: string;
  visitId?: string;
  anonymousId?: string;
  path?: string;
  url?: string;
  hostname?: string;
  referrer?: string;
  language?: string;
  userAgent?: string;
  environment?: string;
  release?: string;
  /** Group type → group key. */
  groups?: Record<string, unknown>;
  /** Request / event properties. */
  properties?: Record<string, unknown>;
  /** Person properties (stored ones merged with caller-supplied overrides). */
  personProperties?: Record<string, unknown>;
  /** Group type → properties of the caller's group of that type. */
  groupProperties?: Record<string, Record<string, unknown>>;
  /** Cohort id → membership, resolved by the server before evaluation. Unknown cohorts never match. */
  cohorts?: Record<string, boolean>;
};

export type FeatureFlagEvaluationReason =
  | 'missing'
  | 'disabled'
  | 'targeting_mismatch'
  | 'rollout_miss'
  | 'match'
  | 'early_access_enrolled'
  | 'early_access_opted_out';

export type FeatureFlagEvaluationResult = {
  key: string;
  enabled: boolean;
  matched: boolean;
  variant: string | boolean;
  reason: FeatureFlagEvaluationReason;
  /**
   * Index of the condition group that decided the result: the group served on `match`,
   * or the first group whose conditions matched on `rollout_miss`. Null otherwise.
   */
  conditionGroup: number | null;
  /** Payload of the served variant (or of the flag, for boolean flags). Null when off. */
  payload: FeatureFlagJsonValue | null;
};

/** Maximum serialized size of one payload (boolean flag payload or one variant payload). */
export const FEATURE_FLAG_PAYLOAD_MAX_BYTES = 16 * 1024;

/** Person property that stores a person's early access opt-in (`true`) or opt-out (`false`). */
export function featureEnrollmentProperty(flagKey: string) {
  return `$feature_enrollment/${flagKey}`;
}

/** Reads an enrollment property value; anything other than an explicit yes/no is "not set". */
export function parseFeatureEnrollment(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return undefined;
}

/** UTF-8 size of the JSON encoding of `value`, or null when it is not JSON-serializable. */
export function featureFlagPayloadBytes(value: unknown): number | null {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return null;
  try {
    const encoded = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('non-finite number');
      return item;
    });
    if (encoded === undefined) return null;
    return new TextEncoder().encode(encoded).length;
  } catch {
    return null;
  }
}

/** The condition groups a flag is evaluated with (legacy single-group fallback included). */
export function resolveConditionGroups(flag: FeatureFlagConfigForEvaluation): FeatureFlagConditionGroup[] {
  if (Array.isArray(flag.conditionGroups) && flag.conditionGroups.length) return flag.conditionGroups;
  return [
    {
      conditions: Array.isArray(flag.targetingRules) ? flag.targetingRules : [],
      rollout: clampPercent(flag.rollout ?? 100),
    },
  ];
}

export type FeatureFlagTargetingNeeds = {
  /** Stored person properties must be loaded (person conditions or early access). */
  personProperties: boolean;
  /** Group keys are read (group or group property conditions). */
  groups: boolean;
  /** Group types whose stored properties must be loaded. */
  groupTypes: string[];
  /** Cohorts whose membership must be resolved. */
  cohortIds: string[];
};

/** What the server has to look up before it can evaluate these flags. */
export function featureFlagTargetingNeeds(flags: FeatureFlagConfigForEvaluation[]): FeatureFlagTargetingNeeds {
  let personProperties = false;
  let groups = false;
  const groupTypes = new Set<string>();
  const cohortIds = new Set<string>();
  for (const flag of flags) {
    if (flag.earlyAccess) personProperties = true;
    for (const group of resolveConditionGroups(flag)) {
      for (const rule of group.conditions) {
        if (rule.field === 'person') personProperties = true;
        if (rule.field === 'group') groups = true;
        if (rule.field === 'group_property' && rule.groupType) {
          groups = true;
          groupTypes.add(rule.groupType);
        }
        if (rule.field === 'cohort' && rule.value) cohortIds.add(rule.value);
      }
    }
  }
  return { personProperties, groups, groupTypes: [...groupTypes], cohortIds: [...cohortIds] };
}

/**
 * Whether a client that only knows the rollout % and variant weights (the tracker script's
 * local evaluation) would get the same answer as the server. Everything else must be
 * evaluated server-side: conditions, several groups, variant overrides and early access.
 */
export function featureFlagNeedsServerEvaluation(flag: FeatureFlagConfigForEvaluation): boolean {
  if (flag.earlyAccess) return true;
  const groups = resolveConditionGroups(flag);
  if (groups.length !== 1) return true;
  const [group] = groups;
  return group.conditions.length > 0 || Boolean(group.variant);
}

function clampPercent(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 100;
  return Math.max(0, Math.min(100, number));
}

const CONTEXT_FIELDS: ReadonlySet<string> = new Set<FeatureFlagRuleField>([
  'path',
  'url',
  'hostname',
  'referrer',
  'language',
  'userAgent',
  'distinctId',
  'userId',
  'environment',
  'release',
]);

const KEYED_FIELDS: ReadonlySet<string> = new Set<FeatureFlagRuleField>([
  'group',
  'property',
  'person',
  'group_property',
  'cohort',
]);

function readRuleValue(rule: FeatureFlagRule, context: FeatureFlagEvaluationContext): unknown {
  switch (rule.field) {
    case 'group':
      return rule.key ? context.groups?.[rule.key] : undefined;
    case 'property':
      return rule.key ? context.properties?.[rule.key] : undefined;
    case 'person':
      return rule.key ? context.personProperties?.[rule.key] : undefined;
    case 'group_property':
      return rule.key && rule.groupType ? context.groupProperties?.[rule.groupType]?.[rule.key] : undefined;
    default:
      return CONTEXT_FIELDS.has(rule.field) ? context[rule.field as keyof FeatureFlagEvaluationContext] : undefined;
  }
}

function toText(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

function compareNumber(left: unknown, right: string, op: FeatureFlagRuleOperator) {
  if (left == null || (typeof left === 'string' && left.trim() === '')) return false;
  const leftNumber = typeof left === 'number' ? left : Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  if (op === 'greater_than') return leftNumber > rightNumber;
  if (op === 'greater_than_or_equal') return leftNumber >= rightNumber;
  if (op === 'less_than') return leftNumber < rightNumber;
  if (op === 'less_than_or_equal') return leftNumber <= rightNumber;
  return false;
}

export function matchFeatureFlagRule(rule: FeatureFlagRule, context: FeatureFlagEvaluationContext): boolean {
  // Unknown fields fail closed (also for `not_exists`), so a bad row never widens a rollout.
  if (!CONTEXT_FIELDS.has(rule.field) && !KEYED_FIELDS.has(rule.field)) return false;
  if (rule.field === 'cohort') {
    // Membership is resolved by the server; an unknown cohort fails closed either way.
    const member = rule.value ? context.cohorts?.[rule.value] : undefined;
    if (typeof member !== 'boolean') return false;
    if (rule.operator === 'in_cohort') return member;
    if (rule.operator === 'not_in_cohort') return !member;
    return false;
  }

  const value = readRuleValue(rule, context);
  if (rule.operator === 'exists') return value != null && toText(value).trim() !== '';
  if (rule.operator === 'not_exists') return value == null || toText(value).trim() === '';

  if (
    rule.operator === 'greater_than' ||
    rule.operator === 'greater_than_or_equal' ||
    rule.operator === 'less_than' ||
    rule.operator === 'less_than_or_equal'
  ) {
    return compareNumber(value, rule.value, rule.operator);
  }

  const left = toText(value).toLowerCase();
  const right = String(rule.value ?? '').toLowerCase();
  if (rule.operator === 'equals') return left === right;
  if (rule.operator === 'contains') return left.includes(right);
  if (rule.operator === 'starts_with') return left.startsWith(right);
  if (rule.operator === 'ends_with') return left.endsWith(right);
  if (rule.operator === 'not_equals') return left !== right;
  if (rule.operator === 'not_contains') return !left.includes(right);
  // Unknown operators fail closed, matching the embedded tracker script.
  return false;
}

function flagVariants(flag: FeatureFlagConfigForEvaluation) {
  return Array.isArray(flag.variants) ? flag.variants.filter((variant) => variant?.key) : [];
}

/** Weighted variant for this caller; canonical bucketing lives in flag-hash.ts. */
function pickVariant(flag: FeatureFlagConfigForEvaluation, bucketingId: string) {
  const variants = flagVariants(flag);
  if (!variants.length) return 'test';

  const bucket = variantBucket(flag.key, bucketingId);
  let sum = 0;
  let last = 'control';
  for (const variant of variants) {
    last = String(variant.key);
    sum += clampPercent(variant.weight ?? 0);
    if (bucket < sum) return last;
  }
  return sum >= 100 ? last : 'control';
}

function servedVariant(flag: FeatureFlagConfigForEvaluation, group: FeatureFlagConditionGroup | null, bucketingId: string) {
  const override = group?.variant;
  if (override && flagVariants(flag).some((variant) => variant.key === override)) return override;
  return pickVariant(flag, bucketingId);
}

/** Payload served with `variant` (the flag payload for boolean flags). */
export function featureFlagPayloadFor(
  flag: FeatureFlagConfigForEvaluation,
  variant: string | boolean,
): FeatureFlagJsonValue | null {
  const variants = flagVariants(flag);
  if (!variants.length) return flag.payload ?? null;
  const served = variants.find((item) => item.key === variant);
  return served?.payload ?? null;
}

function off(
  key: string,
  reason: FeatureFlagEvaluationReason,
  matched = false,
  conditionGroup: number | null = null,
): FeatureFlagEvaluationResult {
  return { key, enabled: false, matched, variant: 'control', reason, conditionGroup, payload: null };
}

function on(
  flag: FeatureFlagConfigForEvaluation,
  variant: string,
  reason: FeatureFlagEvaluationReason,
  conditionGroup: number | null,
): FeatureFlagEvaluationResult {
  return {
    key: flag.key,
    enabled: true,
    matched: true,
    variant,
    reason,
    conditionGroup,
    payload: featureFlagPayloadFor(flag, variant),
  };
}

/**
 * Evaluates a flag for one caller.
 *
 * 1. Disabled flags are off.
 * 2. Early access features: an explicit enrollment (`$feature_enrollment/<key>` person
 *    property) decides — opted in is on, opted out is off — before any condition group.
 * 3. Condition groups are tried in order. A group serves the flag when all its conditions
 *    match and the caller's rollout bucket (the same bucket for every group, see flag-hash.ts)
 *    is inside the group's rollout. A caller outside one group's rollout can still match a
 *    later group.
 */
export function evaluateFeatureFlag(
  flag: FeatureFlagConfigForEvaluation | null | undefined,
  context: FeatureFlagEvaluationContext = {},
): FeatureFlagEvaluationResult {
  if (!flag) {
    return {
      key: '',
      enabled: false,
      matched: false,
      variant: false,
      reason: 'missing',
      conditionGroup: null,
      payload: null,
    };
  }
  if (!flag.enabled) return off(flag.key, 'disabled');

  const bucketingId = flagBucketingId(context);

  if (flag.earlyAccess) {
    const enrollment = parseFeatureEnrollment(context.personProperties?.[featureEnrollmentProperty(flag.key)]);
    if (enrollment === true) return on(flag, servedVariant(flag, null, bucketingId), 'early_access_enrolled', null);
    if (enrollment === false) return off(flag.key, 'early_access_opted_out');
  }

  const bucket = rolloutBucket(flag.key, bucketingId);
  let firstMatchedGroup: number | null = null;
  const groups = resolveConditionGroups(flag);
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const conditions = Array.isArray(group.conditions) ? group.conditions : [];
    if (!conditions.every((rule) => matchFeatureFlagRule(rule, context))) continue;
    if (firstMatchedGroup === null) firstMatchedGroup = index;
    const rollout = clampPercent(group.rollout ?? 100);
    if (rollout <= 0 || (rollout < 100 && bucket >= rollout)) continue;
    return on(flag, servedVariant(flag, group, bucketingId), 'match', index);
  }

  if (firstMatchedGroup !== null) return off(flag.key, 'rollout_miss', true, firstMatchedGroup);
  return off(flag.key, 'targeting_mismatch');
}
