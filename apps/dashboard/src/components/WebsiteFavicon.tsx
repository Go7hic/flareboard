import { websiteFaviconUrl } from '../lib/website-favicon';

export function WebsiteFavicon({
  domain,
  size = 18,
  className = '',
}: {
  domain?: string | null;
  size?: number;
  className?: string;
}) {
  const src = websiteFaviconUrl(domain);
  if (!src) return null;

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={`website-favicon${className ? ` ${className}` : ''}`}
      loading="lazy"
      decoding="async"
      onError={(event) => {
        event.currentTarget.style.display = 'none';
      }}
    />
  );
}
