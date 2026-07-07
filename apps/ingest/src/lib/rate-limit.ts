import { checkIpRateLimit as checkDoRateLimit } from '@flareboard/rate-limiter';
import type { Env } from '../env';

const LIMIT = 100;
const WINDOW_SEC = 60;

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
