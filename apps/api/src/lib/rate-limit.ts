import { checkIpRateLimit as checkDoRateLimit } from '@flareboard/rate-limiter';
import type { Env } from '../env';

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_SEC = 60;

/** Client IP from trusted headers only (never from request body). */
export function getTrustedClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '127.0.0.1'
  );
}

export async function checkIpRateLimit(
  env: Env,
  prefix: string,
  ip: string,
  limit = DEFAULT_LIMIT,
  windowSec = DEFAULT_WINDOW_SEC,
): Promise<{ allowed: boolean; remaining: number }> {
  return checkDoRateLimit(env.RATE_LIMITER, prefix, ip, limit, windowSec);
}
