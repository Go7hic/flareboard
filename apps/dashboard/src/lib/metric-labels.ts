import { t } from './i18n';

const CHANNEL_KEYS = new Set(['direct', 'organic', 'social', 'referral', 'paid', 'email']);

export function formatMetricLabel(type: string, value: string): string {
  if (type === 'channel' && CHANNEL_KEYS.has(value)) {
    return t(`channel_${value}`);
  }
  return value;
}
