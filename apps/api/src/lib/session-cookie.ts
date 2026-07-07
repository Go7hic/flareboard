import { deleteCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Env } from '../env';

export const SESSION_COOKIE = 'flareboard_session';
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

function sessionCookieOptions(env: Env) {
  const production = env.ENVIRONMENT === 'production';
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? ('None' as const) : ('Lax' as const),
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  };
}

export function setSessionCookie(c: Context<{ Bindings: Env }>, token: string) {
  setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(c.env));
}

export function clearSessionCookie(c: Context<{ Bindings: Env }>) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export function readSessionCookieFromHeader(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const prefix = `${SESSION_COOKIE}=`;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

export function readSessionCookie(c: Context<{ Bindings: Env }>): string | null {
  return readSessionCookieFromHeader(c.req.header('Cookie'));
}
