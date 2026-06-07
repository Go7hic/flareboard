import logoMarkUrl from '../assets/logo-mark.png';

type BrandLogoProps = {
  /** Show "Flareboard" wordmark beside the mark */
  showWordmark?: boolean;
  /** Icon size in px (square) */
  size?: number;
  className?: string;
};

/**
 * Flareboard logo: bundled PNG mark + optional CSS wordmark (theme-aware text).
 */
export function BrandLogo({ showWordmark = true, size = 26, className = '' }: BrandLogoProps) {
  const px = `${size}px`;

  return (
    <span
      className={`brand-logo${className ? ` ${className}` : ''}`}
      style={{ ['--brand-logo-size' as string]: px }}
    >
      <img
        src={logoMarkUrl}
        alt={showWordmark ? '' : 'Flareboard'}
        aria-hidden={showWordmark ? true : undefined}
        width={size}
        height={size}
        className="brand-logo-icon"
        style={{ width: px, height: px, maxWidth: px, maxHeight: px }}
      />
      {showWordmark ? <span className="brand-logo-wordmark">Flareboard</span> : null}
    </span>
  );
}
