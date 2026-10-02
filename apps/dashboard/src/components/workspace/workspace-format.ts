/** Small formatting helpers shared by the workspace pages (dashboard, websites, links, boards). */

/** `https://markcut.com/` → `markcut.com` for display; the stored value stays untouched. */
export function displayDomain(domain: string | null | undefined): string {
  if (!domain) return '';
  return domain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Percent change for a delta chip, or undefined when there is no meaningful baseline
 * (no previous value, or a previous value of zero: "+∞%" says nothing).
 */
export function changePercent(current: number, previous: number | null | undefined): number | undefined {
  if (previous == null || !Number.isFinite(previous) || previous === 0 || !Number.isFinite(current)) {
    return undefined;
  }
  return ((current - previous) / previous) * 100;
}

/** First letter of a name for avatar-style tiles (favicons fall back to it). */
export function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  return Array.from(trimmed)[0]!.toUpperCase();
}

/** Ratio as a value for display, guarding against division by zero. */
export function safeRatio(numerator: number, denominator: number): number | undefined {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return undefined;
  return numerator / denominator;
}
