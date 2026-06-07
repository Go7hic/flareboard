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
