import { t } from './i18n';

export const METRIC_TABS = [
  'path',
  'entry',
  'exit',
  'referrer',
  'channel',
  'country',
  'region',
  'city',
  'browser',
  'os',
  'device',
  'language',
] as const;

export type MetricTab = (typeof METRIC_TABS)[number];

export type MetricGroup = {
  labelKey: string;
  items: readonly MetricTab[];
};

export const METRIC_GROUPS: MetricGroup[] = [
  {
    labelKey: 'overviewCardPages',
    items: ['path', 'entry', 'exit'],
  },
  {
    labelKey: 'overviewCardSources',
    items: ['referrer', 'channel'],
  },
  {
    labelKey: 'overviewCardLocation',
    items: ['country', 'region', 'city'],
  },
  {
    labelKey: 'overviewCardEnvironment',
    items: ['browser', 'os', 'device', 'language'],
  },
];

export function isMetricTab(value: string): value is MetricTab {
  return (METRIC_TABS as readonly string[]).includes(value);
}

export function metricTabLabel(tab: MetricTab): string {
  if (tab === 'region') return t('topRegion');
  if (tab === 'city') return t('topCity');
  if (tab === 'country') return t('topCountry');
  if (tab === 'entry') return t('overviewTabEntry');
  if (tab === 'exit') return t('overviewTabExit');
  if (tab === 'channel') return t('overviewTabChannel');
  if (tab === 'referrer') return t('segmentField_referrer');
  if (tab === 'path') return t('segmentField_path');
  if (tab === 'browser') return t('browser');
  if (tab === 'os') return t('os');
  if (tab === 'device') return t('device');
  if (tab === 'language') return t('languageLabel');
  return tab;
}

export function metricTabTableTitle(tab: MetricTab): string {
  return metricTabLabel(tab);
}
