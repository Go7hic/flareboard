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
  const key = `rl:${websiteId}:${ip}`;
  const current = await env.CACHE.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  await env.CACHE.put(key, String(count + 1), { expirationTtl: WINDOW_SEC });
  return { allowed: true, remaining: LIMIT - count - 1 };
}

export async function checkIpRateLimit(
  env: Env,
  prefix: string,
  ip: string,
  limit = LIMIT,
  windowSec = WINDOW_SEC,
): Promise<{ allowed: boolean; remaining: number }> {
  const key = `rl:${prefix}:${ip}`;
  const current = await env.CACHE.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }
  await env.CACHE.put(key, String(count + 1), { expirationTtl: windowSec });
  return { allowed: true, remaining: limit - count - 1 };
}
