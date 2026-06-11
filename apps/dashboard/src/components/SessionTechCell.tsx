import type { ReactNode } from 'react';
import {
  browserIconSlug,
  deviceIconKind,
  formatDeviceLabel,
  osIconSlug,
  usesCustomOsIcon,
  type DeviceIconKind,
} from '../lib/session-display';
import { t } from '../lib/i18n';

function BrandIcon({ slug }: { slug: string }) {
  return (
    <img
      className="session-tech-icon session-tech-icon-brand"
      src={`https://cdn.simpleicons.org/${slug}/64708a`}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
    />
  );
}

function WindowsGlyph() {
  return (
    <svg className="session-tech-icon" width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M0 0h11.377v11.372H0Zm12.623 0H24v11.372H12.623ZM0 12.623h11.377V24H0Zm12.623 0H24V24H12.623" />
    </svg>
  );
}

function DeviceGlyph({ kind }: { kind: DeviceIconKind }) {
  if (kind === 'mobile') {
    return (
      <svg className="session-tech-icon" width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="7" y="3" width="10" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="17" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'tablet') {
    return (
      <svg className="session-tech-icon" width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="18" r="1" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="session-tech-icon" width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 19h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type SessionTechCellProps =
  | { kind: 'browser'; value: string | null }
  | { kind: 'os'; value: string | null }
  | { kind: 'device'; value: string | null };

export function SessionTechCell(props: SessionTechCellProps) {
  const { kind, value } = props;
  const label =
    kind === 'device'
      ? formatDeviceLabel(value)
      : value?.trim() || t('unknown');

  let icon: ReactNode = null;
  if (kind === 'browser') {
    const slug = browserIconSlug(value);
    icon = slug ? <BrandIcon slug={slug} /> : null;
  } else if (kind === 'os') {
    if (usesCustomOsIcon(value)) {
      icon = <WindowsGlyph />;
    } else {
      const slug = osIconSlug(value);
      icon = slug ? <BrandIcon slug={slug} /> : null;
    }
  } else {
    icon = <DeviceGlyph kind={deviceIconKind(value)} />;
  }

  return (
    <span className="session-tech-cell">
      {icon}
      <span className="session-tech-label">{label}</span>
    </span>
  );
}
