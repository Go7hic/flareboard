import { formatEventLimit, LANDING_PLANS, usageGracePercent, type LandingPlan } from './landing-links';
import { formatPercent, formatRetentionPeriod } from './format';
import { t } from './i18n';

export type CompareRowKind = 'section' | 'feature';

export type ResolvedCompareCell = {
  planId: LandingPlan['id'];
  value: string;
  /** True when this plan's value differs from the plan before it (what upgrading adds). */
  upgraded: boolean;
};

export type ResolvedCompareRow =
  | { kind: 'section'; labelKey: string }
  | { kind: 'feature'; labelKey: string; cells: ResolvedCompareCell[] };

type CompareCellSpec =
  | { type: 'included' }
  | {
      type: 'yesNo';
      field:
        | 'replayEnabled'
        | 'emailReportsEnabled'
        | 'heatmapsEnabled'
        | 'teamsEnabled'
        | 'dataPortabilityEnabled'
        | 'warehouseEnabled'
        | 'experimentationEnabled'
        | 'surveysEnabled';
    }
  | { type: 'websites' }
  | { type: 'events' }
  | { type: 'replays' }
  | { type: 'otel' }
  | { type: 'retention' }
  | { type: 'overage' }
  | { type: 'price' }
  /** Fixed copy: one text for Free, another for every paid plan. */
  | { type: 'text'; freeKey: string; paidKey: string };

/** One row of the table; `cell` is resolved against each plan's column. */
type CompareEntry =
  | { kind: 'section'; labelKey: string }
  | { kind: 'feature'; labelKey: string; cell: CompareCellSpec };

/** Row definitions for the pricing comparison table. */
export const PRICING_COMPARE_ENTRIES: CompareEntry[] = [
  { kind: 'section', labelKey: 'pricingCompareSectionData' },
  { kind: 'feature', labelKey: 'pricingComparePrice', cell: { type: 'price' } },
  { kind: 'feature', labelKey: 'pricingCompareWebsites', cell: { type: 'websites' } },
  { kind: 'feature', labelKey: 'pricingCompareEvents', cell: { type: 'events' } },
  { kind: 'feature', labelKey: 'pricingCompareReplays', cell: { type: 'replays' } },
  { kind: 'feature', labelKey: 'pricingCompareOtel', cell: { type: 'otel' } },
  { kind: 'feature', labelKey: 'pricingCompareOverage', cell: { type: 'overage' } },
  { kind: 'feature', labelKey: 'pricingCompareRetention', cell: { type: 'retention' } },
  { kind: 'feature', labelKey: 'featCsvExportTitle', cell: { type: 'yesNo', field: 'dataPortabilityEnabled' } },
  {
    kind: 'feature',
    labelKey: 'featDataImportTitle',
    cell: { type: 'yesNo', field: 'dataPortabilityEnabled' },
  },

  { kind: 'section', labelKey: 'pricingCompareSectionPlatform' },
  { kind: 'feature', labelKey: 'featEdgeIngestTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featCfStackTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featPosthogSdkTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featApiKeysTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featPrivacyDefaultTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featDataOwnershipTitle', cell: { type: 'included' } },

  { kind: 'section', labelKey: 'pricingCompareSectionAnalytics' },
  { kind: 'feature', labelKey: 'featWebsiteStatsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featCustomEventsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'pricingCompareSessions', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featRealtimeTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featSegmentsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'people', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'groups', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'stickiness', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'pricingComparePeriodCompare', cell: { type: 'included' } },

  { kind: 'section', labelKey: 'pricingCompareSectionReports' },
  { kind: 'feature', labelKey: 'featFunnelTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featRetentionTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featAttributionTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featUtmTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featBreakdownTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featWebVitalsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featGoalsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featCohortsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featJourneysTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featInsightsTitle', cell: { type: 'included' } },

  { kind: 'section', labelKey: 'pricingCompareSectionProduct' },
  {
    kind: 'feature',
    labelKey: 'featFeatureFlagsTitle',
    cell: { type: 'yesNo', field: 'experimentationEnabled' },
  },
  {
    kind: 'feature',
    labelKey: 'featExperimentsTitle',
    cell: { type: 'yesNo', field: 'experimentationEnabled' },
  },
  { kind: 'feature', labelKey: 'featSurveysTitle', cell: { type: 'yesNo', field: 'surveysEnabled' } },
  { kind: 'feature', labelKey: 'featActionsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featErrorsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featLogsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featAiObservabilityTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featAnnotationsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featWorkflowsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featMcpTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featWarehouseTitle', cell: { type: 'yesNo', field: 'warehouseEnabled' } },

  { kind: 'section', labelKey: 'pricingCompareSectionSessions' },
  { kind: 'feature', labelKey: 'featHeatmapsTitle', cell: { type: 'yesNo', field: 'heatmapsEnabled' } },
  { kind: 'feature', labelKey: 'featReplayTitle', cell: { type: 'yesNo', field: 'replayEnabled' } },
  { kind: 'feature', labelKey: 'featSessionTimelineTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featDeclarativeEventsTitle', cell: { type: 'included' } },

  { kind: 'section', labelKey: 'pricingCompareSectionCollaboration' },
  { kind: 'feature', labelKey: 'featTeamsTitle', cell: { type: 'yesNo', field: 'teamsEnabled' } },
  { kind: 'feature', labelKey: 'featShareLinksTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featBoardsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featLinksPixelsTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featNotebooksTitle', cell: { type: 'included' } },

  { kind: 'section', labelKey: 'pricingCompareSectionOperations' },
  {
    kind: 'feature',
    labelKey: 'pricingCompareEmailReports',
    cell: { type: 'yesNo', field: 'emailReportsEnabled' },
  },
  { kind: 'feature', labelKey: 'featRevenueTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'auditLog', cell: { type: 'included' } },
  {
    kind: 'feature',
    labelKey: 'featAdminTitle',
    cell: { type: 'text', freeKey: 'pricingCompareValueAdminRole', paidKey: 'pricingCompareValueAdminRole' },
  },

  { kind: 'section', labelKey: 'pricingCompareSectionHosting' },
  {
    kind: 'feature',
    labelKey: 'featSelfHostTitle',
    cell: { type: 'text', freeKey: 'pricingCompareValueSelfHost', paidKey: 'pricingCompareValueSelfHost' },
  },
  {
    kind: 'feature',
    labelKey: 'featCloudBillingTitle',
    cell: { type: 'text', freeKey: 'pricingCompareValueNoSubscription', paidKey: 'pricingCompareValueStripeSubscription' },
  },
  { kind: 'feature', labelKey: 'featOAuthTitle', cell: { type: 'included' } },
  {
    kind: 'feature',
    labelKey: 'featEnterpriseTitle',
    cell: { type: 'text', freeKey: 'pricingCompareValueNoncommercial', paidKey: 'pricingCompareValueCommercialSeparate' },
  },
  { kind: 'feature', labelKey: 'featCookielessTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featNoFingerprintTitle', cell: { type: 'included' } },
  { kind: 'feature', labelKey: 'featSecurityTitle', cell: { type: 'included' } },

  { kind: 'section', labelKey: 'pricingCompareSectionSupport' },
  {
    kind: 'feature',
    labelKey: 'pricingCompareSupport',
    cell: { type: 'text', freeKey: 'pricingCompareValueSupportCommunity', paidKey: 'pricingCompareValueSupportEmail' },
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
      return plan.maxWebsites == null
        ? t('pricingCompareUnlimited')
        : t('pricingCompareUpToWebsites').replace('{count}', String(plan.maxWebsites));
    case 'events':
      return formatEventLimit(plan.maxEventsPerMonth);
    case 'replays':
      return plan.replayEnabled && plan.maxReplaysPerMonth > 0 ? formatEventLimit(plan.maxReplaysPerMonth) : t('no');
    case 'otel':
      return formatEventLimit(plan.maxOtelRowsPerMonth);
    case 'retention':
      return t('pricingCompareUpToDuration').replace('{duration}', formatRetentionPeriod(plan.maxRetentionDays));
    case 'overage': {
      const percent = usageGracePercent(plan);
      return percent > 0
        ? t('pricingCompareValueGrace').replace('{percent}', formatPercent(percent))
        : t('pricingCompareValueStopsAtAllowance');
    }
    case 'price':
      return `$${plan.monthlyPriceUsd ?? 0}`;
    case 'text':
      return t(plan.id === 'free' ? spec.freeKey : spec.paidKey);
  }
}

/** Rows for the comparison table, one cell per plan (columns cheapest first). */
export function buildPricingCompareRows(plans: readonly LandingPlan[] = LANDING_PLANS): ResolvedCompareRow[] {
  return PRICING_COMPARE_ENTRIES.map((entry) => {
    if (entry.kind === 'section') return entry;
    const values = plans.map((plan) => resolveCell(entry.cell, plan));
    return {
      kind: 'feature',
      labelKey: entry.labelKey,
      cells: plans.map((plan, i) => ({
        planId: plan.id,
        value: values[i],
        upgraded: i > 0 && values[i] !== values[i - 1],
      })),
    };
  });
}
