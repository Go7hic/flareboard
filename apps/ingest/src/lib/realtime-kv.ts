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
  const payload: RealtimeSessionMeta = {
    urlPath: meta?.urlPath,
    referrerDomain: meta?.referrerDomain ?? null,
    country: meta?.country ?? null,
    updatedAt: Date.now(),
  };

  const exists = await env.CACHE.get(sessionKey);
  await env.CACHE.put(sessionKey, JSON.stringify(payload), { expirationTtl: TTL });

  if (exists) return;

  const countKey = `rt:${websiteId}:visitors`;
  const current = await env.CACHE.get(countKey);
  const n = current ? parseInt(current, 10) : 0;
  await env.CACHE.put(countKey, String(n + 1), { expirationTtl: TTL });
}
