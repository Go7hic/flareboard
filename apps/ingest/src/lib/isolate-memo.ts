/**
 * Per-isolate copies of small lookups the ingest hot path makes for every event (website owner,
 * quota state, website existence, action version). Each KV read is billed, and one isolate serves
 * many requests, so a short in-memory TTL in front of KV removes most of those reads. Values may
 * lag their source by up to the TTL.
 */
const MAX_ENTRIES = 5000;
const entries = new Map<string, { expires: number; value: unknown }>();

export async function isolateMemo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  const value = await load();
  if (entries.size >= MAX_ENTRIES) entries.clear();
  entries.set(key, { expires: now + ttlMs, value });
  return value;
}

/** Test hook: drop the in-isolate copies so changed data is read again. */
export function forgetIsolateMemo(prefix?: string) {
  if (!prefix) return entries.clear();
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
}
