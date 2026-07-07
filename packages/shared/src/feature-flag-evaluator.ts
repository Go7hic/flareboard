export type FeatureFlagVariantConfig = {
  key: string;
  name?: string;
  weight?: number;
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
  | 'not_exists';

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
  | 'group'
  | 'property';

export type FeatureFlagRule = {
  field: FeatureFlagRuleField;
  operator: FeatureFlagRuleOperator;
  value: string;
  key?: string;
};

export type FeatureFlagConfigForEvaluation = {
  key: string;
  enabled: boolean;
  rollout: number;
  variants?: FeatureFlagVariantConfig[];
  targetingRules?: FeatureFlagRule[];
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
  groups?: Record<string, unknown>;
  properties?: Record<string, unknown>;
};

export type FeatureFlagEvaluationResult = {
  key: string;
  enabled: boolean;
  matched: boolean;
  variant: string | boolean;
  reason: 'missing' | 'disabled' | 'targeting_mismatch' | 'rollout_miss' | 'match';
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0) % 100;
}

function bucketId(context: FeatureFlagEvaluationContext) {
  return (
    context.userId ||
    context.distinctId ||
    context.sessionId ||
    context.visitId ||
    context.anonymousId ||
    context.userAgent ||
    'anonymous'
  );
}

/** Canonical rollout bucket string. Must stay in sync with the embedded tracker script (`hashFlag(key+':'+id)`). */
function rolloutBucketString(flagKey: string, context: FeatureFlagEvaluationContext) {
  return `${flagKey}:${bucketId(context)}`;
}

/** Canonical variant bucket string. Must stay in sync with the embedded tracker script (`hashFlag(key+':variant:'+id)`). */
function variantBucketString(flagKey: string, context: FeatureFlagEvaluationContext) {
  return `${flagKey}:variant:${bucketId(context)}`;
}

function readRuleValue(rule: FeatureFlagRule, context: FeatureFlagEvaluationContext): unknown {
  if (rule.field === 'group') return rule.key ? context.groups?.[rule.key] : undefined;
  if (rule.field === 'property') return rule.key ? context.properties?.[rule.key] : undefined;
  return context[rule.field];
}

function toText(value: unknown) {
  if (value == null) return '';
  return String(value);
}

function compareNumber(left: unknown, right: string, op: FeatureFlagRuleOperator) {
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

function pickVariant(flag: FeatureFlagConfigForEvaluation, context: FeatureFlagEvaluationContext) {
  const variants = Array.isArray(flag.variants) ? flag.variants : [];
  if (!variants.length) return 'test';

  const bucket = stableHash(variantBucketString(flag.key, context));
  let sum = 0;
  let last = 'control';
  for (const variant of variants) {
    if (!variant?.key) continue;
    last = String(variant.key);
    sum += Math.max(0, Math.min(100, Number(variant.weight ?? 0)));
    if (bucket < sum) return last;
  }
  return sum >= 100 ? last : 'control';
}

export function evaluateFeatureFlag(
  flag: FeatureFlagConfigForEvaluation | null | undefined,
  context: FeatureFlagEvaluationContext = {},
): FeatureFlagEvaluationResult {
  if (!flag) {
    return { key: '', enabled: false, matched: false, variant: false, reason: 'missing' };
  }
  if (!flag.enabled) {
    return { key: flag.key, enabled: false, matched: false, variant: 'control', reason: 'disabled' };
  }
  const rules = Array.isArray(flag.targetingRules) ? flag.targetingRules : [];
  if (rules.some((rule) => !matchFeatureFlagRule(rule, context))) {
    return { key: flag.key, enabled: false, matched: false, variant: 'control', reason: 'targeting_mismatch' };
  }
  const rollout = Math.max(0, Math.min(100, Number(flag.rollout ?? 100)));
  if (rollout <= 0) {
    return { key: flag.key, enabled: false, matched: true, variant: 'control', reason: 'rollout_miss' };
  }
  if (rollout < 100 && stableHash(rolloutBucketString(flag.key, context)) >= rollout) {
    return { key: flag.key, enabled: false, matched: true, variant: 'control', reason: 'rollout_miss' };
  }
  return { key: flag.key, enabled: true, matched: true, variant: pickVariant(flag, context), reason: 'match' };
}
