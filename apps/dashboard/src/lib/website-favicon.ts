import { resolveApiUrl } from './api-url';

/** Strip protocol/path from a stored website domain for favicon lookup. */
export function normalizeWebsiteDomain(domain: string): string {
  return domain.trim().replace(/^https?:\/\//i, '').split('/')[0]?.split(':')[0] ?? '';
}

/**
 * The site's own favicon through the API (`/api/favicon`, fetched from the site and cached), so
 * website domains never go to a third-party icon service. Null for hosts it would refuse anyway.
 */
export function websiteFaviconUrl(domain: string | undefined | null): string | null {
  if (!domain?.trim()) return null;
  const host = normalizeWebsiteDomain(domain).toLowerCase();
  if (!host || !host.includes('.') || /^[\d.]+$/.test(host)) return null;
  return `${resolveApiUrl()}/api/favicon?domain=${encodeURIComponent(host)}`;
}
