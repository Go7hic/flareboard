/** Hosted plan definitions (limits apply when HOSTED_MODE is enabled). */
export const PLAN_IDS = ['free', 'cloud'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Legacy plan ids stored before the single paid tier — treated as Cloud. */
const LEGACY_PAID_PLAN_IDS = new Set(['hobby', 'pro']);

/**
 * Unpublished abuse cap when a plan does not advertise a website limit.
 * Cloud marketing is unlimited websites; this stops runaway site creation.
 */
export const WEBSITE_SAFETY_CAP = 100;

export type PlanDefinition = {
  id: PlanId;
  name: string;
  /** Null = unlimited in marketing; enforcement still uses WEBSITE_SAFETY_CAP. */
  maxWebsites: number | null;
  maxEventsPerMonth: number;
  /** Session replays (recorded visits) per month. */
  maxReplaysPerMonth: number;
  /** OpenTelemetry log records and spans per month, counted apart from product events. */
  maxOtelRowsPerMonth: number;
  /** Longest raw-data retention a website on this plan keeps (also the default when unset). */
  maxRetentionDays: number;
  /**
   * Past a monthly allowance, collection continues up to this multiple of it (with emails at
   * 80 %, 100 % and the stop), then stops until the next month. 1 = stop at the allowance.
   */
  usageGraceMultiple: number;
  replayEnabled: boolean;
  emailReportsEnabled: boolean;
  heatmapsEnabled: boolean;
  teamsEnabled: boolean;
  dataPortabilityEnabled: boolean;
  warehouseEnabled: boolean;
  experimentationEnabled: boolean;
  surveysEnabled: boolean;
  /** Display price on marketing / billing UI (USD). Null = free. */
  monthlyPriceUsd: number | null;
  /** Env var name for Stripe Price ID (hosted checkout). */
  stripePriceEnvKey: string | null;
};

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    maxWebsites: 1,
    maxEventsPerMonth: 100_000,
    maxReplaysPerMonth: 0,
    maxOtelRowsPerMonth: 1_000_000,
    maxRetentionDays: 365,
    usageGraceMultiple: 1,
    replayEnabled: false,
    emailReportsEnabled: false,
    heatmapsEnabled: false,
    teamsEnabled: false,
    dataPortabilityEnabled: false,
    warehouseEnabled: false,
    experimentationEnabled: false,
    surveysEnabled: false,
    monthlyPriceUsd: 0,
    stripePriceEnvKey: null,
  },
  cloud: {
    id: 'cloud',
    name: 'Cloud',
    maxWebsites: null,
    maxEventsPerMonth: 1_000_000,
    maxReplaysPerMonth: 5_000,
    maxOtelRowsPerMonth: 10_000_000,
    maxRetentionDays: 1095,
    usageGraceMultiple: 2,
    replayEnabled: true,
    emailReportsEnabled: true,
    heatmapsEnabled: true,
    teamsEnabled: true,
    dataPortabilityEnabled: true,
    warehouseEnabled: true,
    experimentationEnabled: true,
    surveysEnabled: true,
    monthlyPriceUsd: 15,
    stripePriceEnvKey: 'STRIPE_PRICE_CLOUD',
  },
};

export function normalizePlanId(planId: string | null | undefined): PlanId {
  if (planId && planId in PLANS) return planId as PlanId;
  if (planId && LEGACY_PAID_PLAN_IDS.has(planId)) return 'cloud';
  return 'free';
}

export function getPlan(planId: string | null | undefined): PlanDefinition {
  return PLANS[normalizePlanId(planId)];
}

export function isUnlimitedWebsites(plan: Pick<PlanDefinition, 'maxWebsites'>): boolean {
  return plan.maxWebsites == null;
}

/** Website cap used at create time. Public plans with null still hit the safety cap. */
export function websiteLimitForEnforcement(plan: Pick<PlanDefinition, 'maxWebsites'>): number {
  return plan.maxWebsites ?? WEBSITE_SAFETY_CAP;
}

/** Monthly allowances, by the usage_monthly column that counts them. */
export const USAGE_METRICS = ['events', 'replays', 'otel'] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];
export type UsageCounts = Record<UsageMetric, number>;

export function includedUsage(plan: PlanDefinition, metric: UsageMetric): number {
  if (metric === 'events') return plan.maxEventsPerMonth;
  if (metric === 'replays') return plan.maxReplaysPerMonth;
  return plan.maxOtelRowsPerMonth;
}

/** Where collection of a metric stops for the month: the allowance times the plan's grace. */
export function usageCeiling(plan: PlanDefinition, metric: UsageMetric): number {
  return Math.floor(includedUsage(plan, metric) * plan.usageGraceMultiple);
}

/** Retention a website actually keeps: its own setting, capped by (and defaulting to) the plan's. */
export function effectiveRetentionDays(plan: Pick<PlanDefinition, 'maxRetentionDays'>, retentionDays: number | null | undefined): number {
  return retentionDays && retentionDays > 0 ? Math.min(retentionDays, plan.maxRetentionDays) : plan.maxRetentionDays;
}

export function currentMonthKey(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function planForPublic(plan: PlanDefinition) {
  return {
    id: plan.id,
    name: plan.name,
    maxWebsites: plan.maxWebsites,
    maxEventsPerMonth: plan.maxEventsPerMonth,
    maxReplaysPerMonth: plan.maxReplaysPerMonth,
    maxOtelRowsPerMonth: plan.maxOtelRowsPerMonth,
    maxRetentionDays: plan.maxRetentionDays,
    usageGraceMultiple: plan.usageGraceMultiple,
    replayEnabled: plan.replayEnabled,
    emailReportsEnabled: plan.emailReportsEnabled,
    heatmapsEnabled: plan.heatmapsEnabled,
    teamsEnabled: plan.teamsEnabled,
    dataPortabilityEnabled: plan.dataPortabilityEnabled,
    warehouseEnabled: plan.warehouseEnabled,
    experimentationEnabled: plan.experimentationEnabled,
    surveysEnabled: plan.surveysEnabled,
    monthlyPriceUsd: plan.monthlyPriceUsd,
  };
}
