import { useState, type ReactNode } from 'react';
import { websiteFaviconUrl } from '../../lib/website-favicon';
import { cn } from '../../lib/utils';
import { displayDomain, initialOf } from './workspace-format';

/**
 * Favicon tile that shows the site's initial until the favicon has actually loaded: a slow,
 * blocked or empty favicon never leaves a blank square, so every row keeps the same shape.
 */
export function SiteAvatar({
  name,
  domain,
  size = 'md',
  className,
}: {
  name: string;
  domain?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const src = websiteFaviconUrl(domain);
  const px = size === 'sm' ? 14 : size === 'lg' ? 20 : 16;
  return (
    <span className={cn('ws-site-avatar', `ws-site-avatar--${size}`, className)} aria-hidden>
      {/* Keyed by src so a new domain starts from the initial again. */}
      <FaviconImage key={src ?? 'none'} src={src} size={px} initial={initialOf(name)} />
    </span>
  );
}

function FaviconImage({ src, size, initial }: { src: string | null; size: number; initial: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      {loaded ? null : <span className="ws-site-avatar-letter">{initial}</span>}
      {src && !failed ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className={cn('ws-site-avatar-img', loaded && 'is-loaded')}
          onLoad={(event) => {
            // Some favicon services answer unknown hosts with a 1×1 placeholder.
            if (event.currentTarget.naturalWidth > 1) setLoaded(true);
            else setFailed(true);
          }}
          onError={() => setFailed(true)}
        />
      ) : null}
    </>
  );
}

/** Avatar + name with the domain underneath (tables, lists, cards). */
export function SiteIdentity({
  name,
  domain,
  size = 'md',
  title,
  className,
}: {
  name: ReactNode;
  domain?: string | null;
  size?: 'sm' | 'md' | 'lg';
  /** Plain name for the avatar letter when `name` is a node. */
  title?: string;
  className?: string;
}) {
  const plainName = title ?? (typeof name === 'string' ? name : '');
  const shownDomain = displayDomain(domain);
  return (
    <span className={cn('ws-site-identity', className)}>
      <SiteAvatar name={plainName} domain={domain} size={size} />
      <span className="ws-site-identity-copy">
        <span className="ws-site-identity-name">{name}</span>
        {shownDomain ? <span className="ws-site-identity-domain">{shownDomain}</span> : null}
      </span>
    </span>
  );
}
