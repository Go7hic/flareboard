export const FLAREBOARD_GITHUB = 'https://github.com/Go7hic/flareboard';
export const FLAREBOARD_README = `${FLAREBOARD_GITHUB}#readme`;
export const FLAREBOARD_DEPLOY_DOCS = `${FLAREBOARD_GITHUB}/blob/main/docs/deployment.md`;
export const FLAREBOARD_ENTERPRISE_EMAIL = 'hello@flareboard.dev';

/** Display price for Cloud plan (USD). Stripe is source of truth at checkout. */
export const CLOUD_MONTHLY_USD = 15;
/** Pre-promo list price shown struck through on marketing surfaces. */
export const CLOUD_ORIGINAL_MONTHLY_USD = 20;
export const CLOUD_PROMO_LABEL = 'Limited-time launch pricing';

export type LandingPlan = {
  id: string;
  name: string;
  /** Null = unlimited websites in marketing (Cloud). */
  maxWebsites: number | null;
  maxEventsPerMonth: number;
  /** Session replays (recordings) per month; 0 = no replay. */
  maxReplaysPerMonth: number;
  /** OpenTelemetry log records and spans per month. */
  maxOtelRowsPerMonth: number;
  /** Longest raw-data retention per website, in days. */
  maxRetentionDays: number;
  /** Past an allowance, collection continues up to this multiple of it; 1 = stops at it. */
  usageGraceMultiple: number;
  replayEnabled: boolean;
  emailReportsEnabled: boolean;
  heatmapsEnabled: boolean;
  teamsEnabled: boolean;
  dataPortabilityEnabled: boolean;
  warehouseEnabled: boolean;
  experimentationEnabled: boolean;
  surveysEnabled: boolean;
  monthlyPriceUsd?: number | null;
};

/** Keep in sync with packages/shared/src/billing.ts PLANS. */
export const LANDING_PLANS: LandingPlan[] = [
  {
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
  },
  {
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
    monthlyPriceUsd: CLOUD_MONTHLY_USD,
  },
];

export function formatEventLimit(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
