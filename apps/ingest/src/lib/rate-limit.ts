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

function rateLimitKey(prefix: string, ip: string): string {
  const slice = Math.floor(Date.now() / 1000 / WINDOW_SEC);
  return `rl:${prefix}:${ip}:${slice}`;
}

/**
 * Sliding-window rate limit via KV. Uses time-sliced keys to avoid hot-key write limits.
 * When `deferWrite` is provided, the increment is written asynchronously (e.g. waitUntil).
 * For high-volume self-hosted deployments, prefer Cloudflare Workers Rate Limiting binding.
 */
export async function checkRateLimit(
  env: Env,
  websiteId: string,
  ip: string,
  deferWrite?: (fn: () => Promise<void>) => void,
): Promise<{ allowed: boolean; remaining: number }> {
  const key = rateLimitKey(websiteId, ip);
  const current = await env.CACHE.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  const next = count + 1;
  const write = () => env.CACHE.put(key, String(next), { expirationTtl: WINDOW_SEC + 10 });
  if (deferWrite) {
    deferWrite(write);
  } else {
    await write();
  }
  return { allowed: true, remaining: LIMIT - next };
}

export async function checkIpRateLimit(
  env: Env,
  prefix: string,
  ip: string,
  limit = LIMIT,
  windowSec = WINDOW_SEC,
  deferWrite?: (fn: () => Promise<void>) => void,
): Promise<{ allowed: boolean; remaining: number }> {
  const slice = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${prefix}:${ip}:${slice}`;
  const current = await env.CACHE.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }
  const next = count + 1;
  const write = () => env.CACHE.put(key, String(next), { expirationTtl: windowSec + 10 });
  if (deferWrite) {
    deferWrite(write);
  } else {
    await write();
  }
  return { allowed: true, remaining: limit - next };
}
