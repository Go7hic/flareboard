export type ComparePillar = {
  id: string;
  titleKey: string;
  bodyKey: string;
};

export type CompareCompetitor = {
  id: string;
  titleKey: string;
  bulletKeys: [string, string, string, string, string];
  /** Optional in-page anchor for expanded notes (future). */
  detailAnchor?: string;
};

export const COMPARE_PILLARS: ComparePillar[] = [
  { id: 'privacy', titleKey: 'comparePillarPrivacyTitle', bodyKey: 'comparePillarPrivacyBody' },
  { id: 'edge', titleKey: 'comparePillarEdgeTitle', bodyKey: 'comparePillarEdgeBody' },
  { id: 'simple', titleKey: 'comparePillarSimpleTitle', bodyKey: 'comparePillarSimpleBody' },
  { id: 'features', titleKey: 'comparePillarFeaturesTitle', bodyKey: 'comparePillarFeaturesBody' },
];

export const COMPARE_COMPETITORS: CompareCompetitor[] = [
  {
    id: 'google-analytics',
    titleKey: 'compareVsGaTitle',
    bulletKeys: [
      'compareVsGaB1',
      'compareVsGaB2',
      'compareVsGaB3',
      'compareVsGaB4',
      'compareVsGaB5',
    ],
    detailAnchor: 'google-analytics',
  },
  {
    id: 'umami',
    titleKey: 'compareVsUmamiTitle',
    bulletKeys: [
      'compareVsUmamiB1',
      'compareVsUmamiB2',
      'compareVsUmamiB3',
      'compareVsUmamiB4',
      'compareVsUmamiB5',
    ],
    detailAnchor: 'umami',
  },
  {
    id: 'plausible',
    titleKey: 'compareVsPlausibleTitle',
    bulletKeys: [
      'compareVsPlausibleB1',
      'compareVsPlausibleB2',
      'compareVsPlausibleB3',
      'compareVsPlausibleB4',
      'compareVsPlausibleB5',
    ],
    detailAnchor: 'plausible',
  },
  {
    id: 'cloudflare-web-analytics',
    titleKey: 'compareVsCfWebAnalyticsTitle',
    bulletKeys: [
      'compareVsCfWebAnalyticsB1',
      'compareVsCfWebAnalyticsB2',
      'compareVsCfWebAnalyticsB3',
      'compareVsCfWebAnalyticsB4',
      'compareVsCfWebAnalyticsB5',
    ],
    detailAnchor: 'cloudflare-web-analytics',
  },
  {
    id: 'matomo',
    titleKey: 'compareVsMatomoTitle',
    bulletKeys: [
      'compareVsMatomoB1',
      'compareVsMatomoB2',
      'compareVsMatomoB3',
      'compareVsMatomoB4',
      'compareVsMatomoB5',
    ],
    detailAnchor: 'matomo',
  },
  {
    id: 'posthog',
    titleKey: 'compareVsPosthogTitle',
    bulletKeys: [
      'compareVsPosthogB1',
      'compareVsPosthogB2',
      'compareVsPosthogB3',
      'compareVsPosthogB4',
      'compareVsPosthogB5',
    ],
    detailAnchor: 'posthog',
  },
];
