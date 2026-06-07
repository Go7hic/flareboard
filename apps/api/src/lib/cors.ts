import type { Env } from '../env';

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/** Comma-separated extra origins from CORS_ORIGINS (production dashboard URL). */
export function getCorsOrigins(env: Env): string[] {
  const extra = env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];
  return [...new Set([...DEV_ORIGINS, ...extra])];
}

/** Returns the origin when allowed, or null to deny CORS (never reflect a fallback origin). */
export function resolveCorsOrigin(env: Env, requestOrigin: string | undefined): string | null {
  if (!requestOrigin) return null;
  return getCorsOrigins(env).includes(requestOrigin) ? requestOrigin : null;
}
