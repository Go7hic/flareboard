/**
 * Resolves the API worker origin baked into or inferred for the dashboard bundle.
 *
 * - `VITE_API_URL` at build time wins (required for non-standard host layouts).
 * - Dev: empty string → Vite proxies `/api` to the local API worker.
 * - Production: `https://api.<dashboard-host>` when env is unset (e.g. flareboard.dev → api.flareboard.dev).
 */
export function resolveApiUrl(): string {
  const fromEnv = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;

  if (import.meta.env.DEV) return '';

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return '';
    const base = hostname.replace(/^www\./, '');
    if (base.startsWith('api.')) return `${protocol}//${hostname}`;
    return `${protocol}//api.${base}`;
  }

  return '';
}

export function apiUrlConfigError(): string {
  return (
    'API URL is not configured. Set VITE_API_URL in your deployment environment ' +
    '(e.g. https://api.flareboard.dev) and redeploy the dashboard.'
  );
}

export function apiReturnedHtmlError(): string {
  return (
    'API returned HTML instead of JSON. Requests are hitting the dashboard app, not the API server. ' +
    'Set VITE_API_URL to your API origin (e.g. https://api.flareboard.dev) in your deployment environment and redeploy.'
  );
}
