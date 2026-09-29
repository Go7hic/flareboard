import type { LockoutBody, LockoutResult, RateLimitResult } from './types';

export type RateLimiterNamespace = DurableObjectNamespace;

export async function consumeRateLimit(
  namespace: RateLimiterNamespace,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const id = namespace.idFromName(bucket);
  const stub = namespace.get(id);
  const response = await stub.fetch('https://rate-limiter/consume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit, windowSec }),
  });

  if (!response.ok) {
    throw new Error(`Rate limiter failed: ${response.status}`);
  }

  return response.json() as Promise<RateLimitResult>;
}

export async function checkIpRateLimit(
  namespace: RateLimiterNamespace,
  prefix: string,
  subject: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  return consumeRateLimit(namespace, `${prefix}:${subject}`, limit, windowSec);
}

/** Failure lockout with backoff for one subject (see RateLimiter.lockout). */
export async function lockoutRequest(
  namespace: RateLimiterNamespace,
  bucket: string,
  body: LockoutBody,
): Promise<LockoutResult> {
  const stub = namespace.get(namespace.idFromName(bucket));
  const response = await stub.fetch('https://rate-limiter/lockout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Lockout failed: ${response.status}`);
  }
  return response.json() as Promise<LockoutResult>;
}
