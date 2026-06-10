export type FeatureItem = {
  titleKey: string;
  bodyKey: string;
};

export type FeatureCategory = {
  id: string;
  titleKey: string;
  items: FeatureItem[];
};

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  {
    id: 'privacy',
    titleKey: 'featuresCatPrivacy',
    items: [
      { titleKey: 'featPrivacyDefaultTitle', bodyKey: 'featPrivacyDefaultBody' },
      { titleKey: 'featCookielessTitle', bodyKey: 'featCookielessBody' },
      { titleKey: 'featDataOwnershipTitle', bodyKey: 'featDataOwnershipBody' },
      { titleKey: 'featNoFingerprintTitle', bodyKey: 'featNoFingerprintBody' },
    ],
  },
  {
    id: 'platform',
    titleKey: 'featuresCatPlatform',
    items: [
      { titleKey: 'featEdgeIngestTitle', bodyKey: 'featEdgeIngestBody' },
      { titleKey: 'featCfStackTitle', bodyKey: 'featCfStackBody' },
      { titleKey: 'featSelfHostTitle', bodyKey: 'featSelfHostBody' },
    ],
  },
  {
    id: 'analytics',
    titleKey: 'featuresCatAnalytics',
    items: [
      { titleKey: 'featWebsiteStatsTitle', bodyKey: 'featWebsiteStatsBody' },
      { titleKey: 'featRealtimeTitle', bodyKey: 'featRealtimeBody' },
      { titleKey: 'featSegmentsTitle', bodyKey: 'featSegmentsBody' },
      { titleKey: 'featCustomEventsTitle', bodyKey: 'featCustomEventsBody' },
      { titleKey: 'featCsvExportTitle', bodyKey: 'featCsvExportBody' },
    ],
  },
  {
    id: 'reports',
    titleKey: 'featuresCatReports',
    items: [
      { titleKey: 'featFunnelTitle', bodyKey: 'featFunnelBody' },
      { titleKey: 'featRetentionTitle', bodyKey: 'featRetentionBody' },
      { titleKey: 'featAttributionTitle', bodyKey: 'featAttributionBody' },
      { titleKey: 'featUtmTitle', bodyKey: 'featUtmBody' },
      { titleKey: 'featBreakdownTitle', bodyKey: 'featBreakdownBody' },
      { titleKey: 'featWebVitalsTitle', bodyKey: 'featWebVitalsBody' },
      { titleKey: 'featGoalsTitle', bodyKey: 'featGoalsBody' },
      { titleKey: 'featCohortsTitle', bodyKey: 'featCohortsBody' },
      { titleKey: 'featJourneysTitle', bodyKey: 'featJourneysBody' },
    ],
  },
  {
    id: 'sessions',
    titleKey: 'featuresCatSessions',
    items: [
      { titleKey: 'featReplayTitle', bodyKey: 'featReplayBody' },
      { titleKey: 'featHeatmapsTitle', bodyKey: 'featHeatmapsBody' },
      { titleKey: 'featSessionTimelineTitle', bodyKey: 'featSessionTimelineBody' },
      { titleKey: 'featDeclarativeEventsTitle', bodyKey: 'featDeclarativeEventsBody' },
    ],
  },
  {
    id: 'collaboration',
    titleKey: 'featuresCatCollaboration',
    items: [
      { titleKey: 'featTeamsTitle', bodyKey: 'featTeamsBody' },
      { titleKey: 'featShareLinksTitle', bodyKey: 'featShareLinksBody' },
      { titleKey: 'featBoardsTitle', bodyKey: 'featBoardsBody' },
      { titleKey: 'featLinksPixelsTitle', bodyKey: 'featLinksPixelsBody' },
    ],
  },
  {
    id: 'operations',
    titleKey: 'featuresCatOperations',
    items: [
      { titleKey: 'featEmailReportsTitle', bodyKey: 'featEmailReportsBody' },
      { titleKey: 'featDataImportTitle', bodyKey: 'featDataImportBody' },
      { titleKey: 'featRevenueTitle', bodyKey: 'featRevenueBody' },
      { titleKey: 'featAdminTitle', bodyKey: 'featAdminBody' },
    ],
  },
  {
    id: 'hosting',
    titleKey: 'featuresCatHosting',
    items: [
      { titleKey: 'featCloudBillingTitle', bodyKey: 'featCloudBillingBody' },
      { titleKey: 'featOAuthTitle', bodyKey: 'featOAuthBody' },
      { titleKey: 'featEnterpriseTitle', bodyKey: 'featEnterpriseBody' },
    ],
  },
];
