import { WebsiteFavicon } from './WebsiteFavicon';

export function WebsiteNameLabel({
  name,
  domain,
  className = '',
  faviconSize = 18,
}: {
  name: string;
  domain?: string | null;
  className?: string;
  faviconSize?: number;
}) {
  return (
    <span className={`website-name-label${className ? ` ${className}` : ''}`}>
      <WebsiteFavicon domain={domain} size={faviconSize} className="website-name-label-favicon" />
      <span className="website-name-label-text">{name}</span>
    </span>
  );
}
