import type { Env } from '../env';

/** Matches API realtime window (5 min). */
const TTL = 300;

export type RealtimeSessionMeta = {
  urlPath?: string;
  referrerDomain?: string | null;
  country?: string | null;
  updatedAt: number;
};

export async function bumpRealtimeVisitor(
  env: Env,
  websiteId: string,
  sessionId: string,
  meta?: Omit<RealtimeSessionMeta, 'updatedAt'>,
) {
  const sessionKey = `rt:${websiteId}:s:${sessionId}`;
  const existing = await env.CACHE.get(sessionKey);
  let previous: RealtimeSessionMeta | null = null;
  if (existing) {
    try {
      previous = JSON.parse(existing) as RealtimeSessionMeta;
    } catch {
      previous = null;
    }
  }

  const payload: RealtimeSessionMeta = {
    urlPath: meta?.urlPath ?? previous?.urlPath,
    referrerDomain: meta?.referrerDomain ?? previous?.referrerDomain ?? null,
    country: meta?.country ?? previous?.country ?? null,
    updatedAt: Date.now(),
  };

  const exists = existing;
  await env.CACHE.put(sessionKey, JSON.stringify(payload), { expirationTtl: TTL });

  if (exists) return;

  const countKey = `rt:${websiteId}:visitors`;
  const current = await env.CACHE.get(countKey);
  const n = current ? parseInt(current, 10) : 0;
  await env.CACHE.put(countKey, String(n + 1), { expirationTtl: TTL });
}
