import {
  CLOUD_MONTHLY_USD,
  formatEventLimit,
  LANDING_PLANS,
  type LandingPlan,
} from './landing-links';
import { t } from './i18n';

export type CompareRowKind = 'section' | 'feature';

export type ResolvedCompareRow = {
  kind: CompareRowKind;
  labelKey: string;
  free?: string;
  cloud?: string;
  /** True when the Cloud cell differs from Free (tier-gated or higher limits). */
  cloudExclusive?: boolean;
};

type CompareCellSpec =
  | { type: 'included' }
  | { type: 'yesNo'; field: 'replayEnabled' | 'emailReportsEnabled' | 'heatmapsEnabled' | 'teamsEnabled' }
  | { type: 'websites' }
  | { type: 'events' }
  | { type: 'price' }
  | { type: 'text'; freeKey: string; cloudKey: string };

type CompareEntry =
  | { kind: 'section'; labelKey: string }
  | {
      kind: 'feature';
      labelKey: string;
      free: CompareCellSpec;
      cloud: CompareCellSpec;
    };

/** Row definitions for the pricing comparison table. */
export const PRICING_COMPARE_ENTRIES: CompareEntry[] = [
  { kind: 'section', labelKey: 'pricingCompareSectionData' },
  { kind: 'feature', labelKey: 'pricingComparePrice', free: { type: 'price' }, cloud: { type: 'price' } },
  {
    kind: 'feature',
    labelKey: 'pricingCompareWebsites',
    free: { type: 'websites' },
    cloud: { type: 'websites' },
  },
  {
    kind: 'feature',
    labelKey: 'pricingCompareEvents',
    free: { type: 'events' },
    cloud: { type: 'events' },
  },
  { kind: 'feature', labelKey: 'featCsvExportTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  {
    kind: 'feature',
    labelKey: 'featDataImportTitle',
    free: { type: 'included' },
    cloud: { type: 'included' },
  },

  { kind: 'section', labelKey: 'pricingCompareSectionPlatform' },
  { kind: 'feature', labelKey: 'featEdgeIngestTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  { kind: 'feature', labelKey: 'featCfStackTitle', free: { type: 'included' }, cloud: { type: 'included' } },

  { kind: 'section', labelKey: 'pricingCompareSectionAnalytics' },
  {
    kind: 'feature',
    labelKey: 'pricingComparePageviews',
    free: { type: 'included' },
    cloud: { type: 'included' },
  },
  {
    kind: 'feature',
    labelKey: 'featCustomEventsTitle',
    free: { type: 'included' },
    cloud: { type: 'included' },
  },
  {
    kind: 'feature',
    labelKey: 'pricingCompareSessions',
    free: { type: 'included' },
    cloud: { type: 'included' },
  },
  { kind: 'feature', labelKey: 'featRealtimeTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  { kind: 'feature', labelKey: 'featSegmentsTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  {
    kind: 'feature',
    labelKey: 'pricingComparePeriodCompare',
    free: { type: 'included' },
    cloud: { type: 'included' },
  },

  { kind: 'section', labelKey: 'pricingCompareSectionReports' },
  { kind: 'feature', labelKey: 'featFunnelTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  { kind: 'feature', labelKey: 'featRetentionTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  { kind: 'feature', labelKey: 'featAttributionTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  { kind: 'feature', labelKey: 'featWebVitalsTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  { kind: 'feature', labelKey: 'featGoalsTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  { kind: 'feature', labelKey: 'featCohortsTitle', free: { type: 'included' }, cloud: { type: 'included' } },

  { kind: 'section', labelKey: 'pricingCompareSectionSessions' },
  { kind: 'feature', labelKey: 'featHeatmapsTitle', free: { type: 'yesNo', field: 'heatmapsEnabled' }, cloud: { type: 'yesNo', field: 'heatmapsEnabled' } },
  {
    kind: 'feature',
    labelKey: 'pricingCompareReplay',
    free: { type: 'yesNo', field: 'replayEnabled' },
    cloud: { type: 'yesNo', field: 'replayEnabled' },
  },
  {
    kind: 'feature',
    labelKey: 'featSessionTimelineTitle',
    free: { type: 'included' },
    cloud: { type: 'included' },
  },
  {
    kind: 'feature',
    labelKey: 'featDeclarativeEventsTitle',
    free: { type: 'included' },
    cloud: { type: 'included' },
  },

  { kind: 'section', labelKey: 'pricingCompareSectionCollaboration' },
  { kind: 'feature', labelKey: 'featTeamsTitle', free: { type: 'yesNo', field: 'teamsEnabled' }, cloud: { type: 'yesNo', field: 'teamsEnabled' } },
  { kind: 'feature', labelKey: 'featShareLinksTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  { kind: 'feature', labelKey: 'featBoardsTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  { kind: 'feature', labelKey: 'featLinksPixelsTitle', free: { type: 'included' }, cloud: { type: 'included' } },

  { kind: 'section', labelKey: 'pricingCompareSectionOperations' },
  {
    kind: 'feature',
    labelKey: 'pricingCompareEmailReports',
    free: { type: 'yesNo', field: 'emailReportsEnabled' },
    cloud: { type: 'yesNo', field: 'emailReportsEnabled' },
  },
  { kind: 'feature', labelKey: 'featRevenueTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  { kind: 'feature', labelKey: 'featAdminTitle', free: { type: 'included' }, cloud: { type: 'included' } },

  { kind: 'section', labelKey: 'pricingCompareSectionHosting' },
  {
    kind: 'feature',
    labelKey: 'featSelfHostTitle',
    free: { type: 'text', freeKey: 'pricingCompareValueSelfHost', cloudKey: 'pricingCompareValueSelfHost' },
    cloud: { type: 'text', freeKey: 'pricingCompareValueSelfHost', cloudKey: 'pricingCompareValueSelfHost' },
  },
  { kind: 'feature', labelKey: 'featOAuthTitle', free: { type: 'included' }, cloud: { type: 'included' } },
  {
    kind: 'feature',
    labelKey: 'featCookielessTitle',
    free: { type: 'included' },
    cloud: { type: 'included' },
  },
  {
    kind: 'feature',
    labelKey: 'featNoFingerprintTitle',
    free: { type: 'included' },
    cloud: { type: 'included' },
  },

  { kind: 'section', labelKey: 'pricingCompareSectionSupport' },
  {
    kind: 'feature',
    labelKey: 'pricingCompareSupport',
    free: { type: 'text', freeKey: 'pricingCompareValueSupportCommunity', cloudKey: 'pricingCompareValueSupportEmail' },
    cloud: { type: 'text', freeKey: 'pricingCompareValueSupportCommunity', cloudKey: 'pricingCompareValueSupportEmail' },
  },
];

function yesNo(value: boolean): string {
  return value ? t('yes') : t('no');
}

function resolveCell(spec: CompareCellSpec, plan: LandingPlan): string {
  switch (spec.type) {
    case 'included':
      return t('pricingCompareIncluded');
    case 'yesNo':
      return yesNo(plan[spec.field]);
    case 'websites':
      return t('pricingCompareUpToWebsites').replace('{count}', String(plan.maxWebsites));
    case 'events':
      return formatEventLimit(plan.maxEventsPerMonth);
    case 'price':
      return plan.monthlyPriceUsd ? `$${CLOUD_MONTHLY_USD}` : '$0';
    case 'text':
      return t(spec.freeKey);
  }
}

function resolveCellForPlan(spec: CompareCellSpec, plan: LandingPlan, column: 'free' | 'cloud'): string {
  if (spec.type === 'text') {
    return t(column === 'free' ? spec.freeKey : spec.cloudKey);
  }
  return resolveCell(spec, plan);
}

export function buildPricingCompareRows(): ResolvedCompareRow[] {
  const freeLanding = LANDING_PLANS.find((plan) => plan.id === 'free')!;
  const cloudLanding = LANDING_PLANS.find((plan) => plan.id === 'cloud')!;

  return PRICING_COMPARE_ENTRIES.map((entry) => {
    if (entry.kind === 'section') {
      return { kind: 'section', labelKey: entry.labelKey };
    }

    const free = resolveCellForPlan(entry.free, freeLanding, 'free');
    const cloud = resolveCellForPlan(entry.cloud, cloudLanding, 'cloud');

    return {
      kind: 'feature',
      labelKey: entry.labelKey,
      free,
      cloud,
      cloudExclusive: free !== cloud,
    };
  });
}

/** Count of feature rows (excludes section headers). */
export function pricingCompareFeatureRowCount(): number {
  return PRICING_COMPARE_ENTRIES.filter((entry) => entry.kind === 'feature').length;
}
