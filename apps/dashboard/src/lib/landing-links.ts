export const FLAREBOARD_GITHUB = 'https://github.com/Go7hic/flareboard';
export const FLAREBOARD_README = `${FLAREBOARD_GITHUB}#readme`;
export const FLAREBOARD_DEPLOY_DOCS = `${FLAREBOARD_GITHUB}/blob/main/docs/deployment.md`;
export const FLAREBOARD_ENTERPRISE_EMAIL = 'hello@flareboard.dev';

/** Display price for Cloud plan (USD). Stripe is source of truth at checkout. */
export const CLOUD_MONTHLY_USD = 12;
/** Pre-promo list price shown struck through on marketing surfaces. */
export const CLOUD_ORIGINAL_MONTHLY_USD = 20;
export const CLOUD_PROMO_LABEL = 'Limited-time launch pricing';

export type LandingPlan = {
  id: string;
  name: string;
  maxWebsites: number;
  maxEventsPerMonth: number;
  replayEnabled: boolean;
  emailReportsEnabled: boolean;
  heatmapsEnabled: boolean;
  teamsEnabled: boolean;
  monthlyPriceUsd?: number | null;
};

export const LANDING_PLANS: LandingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    maxWebsites: 3,
    maxEventsPerMonth: 100_000,
    replayEnabled: false,
    emailReportsEnabled: false,
    heatmapsEnabled: false,
    teamsEnabled: false,
    monthlyPriceUsd: 0,
  },
  {
    id: 'cloud',
    name: 'Cloud',
    maxWebsites: 10,
    maxEventsPerMonth: 1_000_000,
    replayEnabled: true,
    emailReportsEnabled: true,
    heatmapsEnabled: true,
    teamsEnabled: true,
    monthlyPriceUsd: CLOUD_MONTHLY_USD,
  },
];

export function formatEventLimit(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
