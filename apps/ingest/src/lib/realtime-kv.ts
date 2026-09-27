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

  // `u` in the key metadata lets the API count active sessions from a key listing
  // alone. (A separate running counter only ever went up and was replaced by this.)
  await env.CACHE.put(sessionKey, JSON.stringify(payload), {
    expirationTtl: TTL,
    metadata: { u: payload.updatedAt },
  });
}

/** Sessions seen in the realtime window, counted from key metadata (first 1000 keys). */
export async function countActiveVisitors(env: Env, websiteId: string, now = Date.now()) {
  const since = now - TTL * 1000;
  const page = await env.CACHE.list<{ u?: number }>({ prefix: `rt:${websiteId}:s:`, limit: 1000 });
  return page.keys.filter((key) => key.metadata?.u === undefined || key.metadata.u >= since).length;
}
