import type { Env } from '../env';

const CACHE_PREFIX = 'api-cache:';
/** Cloudflare KV requires expiration_ttl >= 60. */
const MIN_KV_TTL_SEC = 60;

export async function cachedRead<T>(
  env: Env,
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cacheKey = `${CACHE_PREFIX}${key}`;
  const hit = await env.CACHE.get(cacheKey);
  if (hit) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      /* fall through */
    }
  }

  const value = await loader();
  const ttl = Math.max(MIN_KV_TTL_SEC, ttlSeconds);
  await env.CACHE.put(cacheKey, JSON.stringify(value), { expirationTtl: ttl });
  return value;
}
