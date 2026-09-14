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
