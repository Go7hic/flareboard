import { checkIpRateLimit as checkDoRateLimit } from '@flareboard/rate-limiter';
import type { Env } from '../env';

const LIMIT = 100;
const WINDOW_SEC = 60;
/**
 * Requests that identify the website by its project key share one budget per key instead of the
 * per-IP one: server SDKs send everything from a handful of IPs. Hosted event quotas still apply.
 */
const PROJECT_KEY_LIMIT_PER_MINUTE = 30_000;

/** Client IP from trusted headers only (never from request body). */
export function getTrustedClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '127.0.0.1'
  );
}

export async function checkRateLimit(
  env: Env,
  websiteId: string,
  ip: string,
): Promise<{ allowed: boolean; remaining: number }> {
  return checkDoRateLimit(env.RATE_LIMITER, `website:${websiteId}`, ip, LIMIT, WINDOW_SEC);
}

export async function checkIpRateLimit(
  env: Env,
  prefix: string,
  ip: string,
  limit = LIMIT,
  windowSec = WINDOW_SEC,
): Promise<{ allowed: boolean; remaining: number }> {
  return checkDoRateLimit(env.RATE_LIMITER, prefix, ip, limit, windowSec);
}

function projectKeyLimit(env: Env): number {
  const configured = Number.parseInt(env.PROJECT_KEY_RATE_LIMIT ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : PROJECT_KEY_LIMIT_PER_MINUTE;
}

/** Per-key budget; `bucket` separates event capture from flag evaluation. */
export async function checkProjectKeyRateLimit(
  env: Env,
  projectKey: string,
  bucket: 'events' | 'flags' = 'events',
): Promise<{ allowed: boolean; remaining: number }> {
  return checkDoRateLimit(env.RATE_LIMITER, `project-key:${bucket}`, projectKey, projectKeyLimit(env), WINDOW_SEC);
}
