import type { Context } from 'hono';
import { geoFromCf } from '@flareboard/shared';
import type { Env } from '../env';

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function badRequest(message: string) {
  return json({ message }, 400);
}

export function unauthorized(body: Record<string, unknown> = {}) {
  return json(body, 401);
}

export function forbidden() {
  return json({ message: 'Forbidden' }, 403);
}

export function notFound(message = 'Not found') {
  return json({ message }, 404);
}

export function serverError(error?: unknown) {
  console.error('Server error', error);
  return json({ message: 'Server error' }, 500);
}

export const DEV_APP_SECRET = 'flareboard-dev-secret';

export function getSecret(c: Context<{ Bindings: Env }>) {
  const secret = c.env.APP_SECRET;
  if (c.env.ENVIRONMENT === 'production') {
    if (!secret || secret === DEV_APP_SECRET) {
      throw new Error('APP_SECRET must be set to a secure value in production');
    }
    return secret;
  }
  return secret || DEV_APP_SECRET;
}

export function getClientInfo(c: Context<{ Bindings: Env }>, payload: { ip?: string; userAgent?: string; browser?: string; os?: string; device?: string }) {
  const ip = payload.ip ?? c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';
  const userAgent = payload.userAgent ?? c.req.header('user-agent') ?? '';
  const geo = geoFromCf((c.req.raw as Request & { cf?: unknown }).cf);
  return {
    ip,
    userAgent,
    browser: payload.browser ?? parseBrowser(userAgent),
    os: payload.os ?? parseOs(userAgent),
    device: payload.device ?? parseDevice(userAgent),
    ...geo,
  };
}

function parseBrowser(ua: string): string {
  if (/chrome/i.test(ua) && !/edge/i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  if (/edge/i.test(ua)) return 'Edge';
  return 'Unknown';
}

function parseOs(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os/i.test(ua)) return 'macOS';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad/i.test(ua)) return 'iOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

function parseDevice(ua: string): string {
  if (/mobile/i.test(ua)) return 'mobile';
  if (/tablet/i.test(ua)) return 'tablet';
  return 'desktop';
}

export function safeDecodeURIComponent(value?: string) {
  if (!value) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function safeDecodeURI(value?: string) {
  if (!value) return value;
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}
