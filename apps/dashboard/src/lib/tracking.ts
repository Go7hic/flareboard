/**
 * Optional self-hosted analytics (dogfooding). Set at build time only:
 * VITE_INGEST_URL + VITE_TRACKING_WEBSITE_ID. Omit both for forks / local dev without tracking.
 */
export function initFlareboardTracking(): void {
  const websiteId = import.meta.env.VITE_TRACKING_WEBSITE_ID?.trim();
  const ingestUrl = import.meta.env.VITE_INGEST_URL?.trim().replace(/\/$/, '');
  if (!websiteId || !ingestUrl) return;

  const existing = document.querySelector('script[data-flareboard-tracking]');
  if (existing) return;

  const script = document.createElement('script');
  script.defer = true;
  script.src = `${ingestUrl}/script.js`;
  script.setAttribute('data-website-id', websiteId);
  script.setAttribute('data-flareboard-tracking', '1');
  document.head.appendChild(script);
}

/**
 * A product event on flareboard.dev itself (sign-up funnel, sign-in). Only pass coarse labels and
 * status codes, never an email address, password or other personal data: the Privacy Policy says so.
 */
export function trackProductEvent(event: string, data?: Record<string, string | number>): void {
  window.flareboard?.track(event, data);
}

/** The error's machine-readable code, else its HTTP status, for a `*_failed` event. */
export function failureReason(err: unknown): string {
  if (err && typeof err === 'object') {
    const { data, status } = err as { data?: Record<string, unknown>; status?: unknown };
    if (typeof data?.code === 'string') return data.code;
    if (typeof status === 'number') return String(status);
  }
  return 'network';
}
