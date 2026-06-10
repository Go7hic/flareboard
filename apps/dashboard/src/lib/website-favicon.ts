/** Strip protocol/path from a stored website domain for favicon lookup. */
export function normalizeWebsiteDomain(domain: string): string {
  return domain.trim().replace(/^https?:\/\//i, '').split('/')[0]?.split(':')[0] ?? '';
}

export function websiteFaviconUrl(domain: string | undefined | null): string | null {
  if (!domain?.trim()) return null;
  const host = normalizeWebsiteDomain(domain);
  if (!host) return null;
  return `https://favicon.so/${encodeURIComponent(host)}`;
}
