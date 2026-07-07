import type { Context } from 'hono';
import { readSessionCookieFromHeader } from './session-cookie';

export function readBearerToken(c: Context): string | null {
  const header = c.req.header('Authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

export function readAuthToken(c: Context): string | null {
  return readBearerToken(c) ?? readSessionCookieFromHeader(c.req.header('Cookie'));
}
