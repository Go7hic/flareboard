import type { Env } from '../env';

/**
 * Workers KV as a cache that never fails the request using it: a read that throws counts as a
 * miss and a write that throws is skipped, so callers fall back to D1. Workers Free allows 1,000
 * KV writes a day, after which every put throws until the next UTC day.
 */
type CacheEnv = Pick<Env, 'CACHE'>;

const WARN_INTERVAL_MS = 60_000;
let lastWarnAt = 0;

function warn(op: 'get' | 'put', key: string, error: unknown) {
  const now = Date.now();
  if (now - lastWarnAt < WARN_INTERVAL_MS) return;
  lastWarnAt = now;
  console.warn(
    JSON.stringify({
      event: 'kv_cache_unavailable',
      op,
      key: key.split(':')[0],
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

export async function cacheGet(env: CacheEnv, key: string): Promise<string | null> {
  try {
    return await env.CACHE.get(key);
  } catch (error) {
    warn('get', key, error);
    return null;
  }
}

export async function cacheGetJson<T>(env: CacheEnv, key: string, cacheTtl?: number): Promise<T | null> {
  try {
    return await env.CACHE.get<T>(key, cacheTtl ? { type: 'json', cacheTtl } : { type: 'json' });
  } catch (error) {
    warn('get', key, error);
    return null;
  }
}

export async function cachePut(env: CacheEnv, key: string, value: string, options?: KVNamespacePutOptions): Promise<void> {
  try {
    await env.CACHE.put(key, value, options);
  } catch (error) {
    warn('put', key, error);
  }
}
