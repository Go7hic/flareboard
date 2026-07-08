import type { Env } from '../env';
import { resolveCorsOrigin } from './cors';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

function refererOrigin(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function requestOrigin(headers: { header(name: string): string | undefined }): string | null {
  const origin = headers.header('Origin');
  if (origin) return origin;
  return refererOrigin(headers.header('Referer'));
}

/** Cookie-authenticated mutating requests must come from an allowed dashboard origin. */
export function csrfOriginAllowed(c: {
  req: { method: string; header(name: string): string | undefined };
  env: Env;
}): boolean {
  if (!MUTATING_METHODS.has(c.req.method)) return true;
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) return true;
  const origin = requestOrigin(c.req);
  if (!origin) return false;
  return resolveCorsOrigin(c.env, origin) !== null;
}
