import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { deviceIconKind, formatDeviceLabel } from '../lib/session-display';
import { t } from '../lib/i18n';

/**
 * Device + browser + OS in one table cell: a thin device glyph, the browser, the OS muted
 * ("Chrome · Windows"). Local icons only: the brand logos used to come from a third-party
 * CDN, which blocked cross-origin loads and leaked a request per row.
 */
export function SessionTechCell({
  browser,
  os,
  device,
}: {
  browser: string | null;
  os: string | null;
  device: string | null;
}) {
  const kind = deviceIconKind(device);
  const Icon = kind === 'mobile' ? Smartphone : kind === 'tablet' ? Tablet : Monitor;
  const browserLabel = browser?.trim() || t('unknown');
  const osLabel = os?.trim();
  const deviceLabel = formatDeviceLabel(device);
  return (
    <span className="session-tech-cell" title={[deviceLabel, browserLabel, osLabel].filter(Boolean).join(' · ')}>
      <Icon className="session-tech-icon" size={15} strokeWidth={2} aria-label={deviceLabel} />
      <span className="session-tech-label">{browserLabel}</span>
      {osLabel ? <span className="session-tech-os">{osLabel}</span> : null}
    </span>
  );
}
