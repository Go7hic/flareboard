import type { Env } from '../env';

export const DEV_APP_SECRET = 'flareboard-dev-secret';

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

export function notFound(message = 'Not found') {
  return json({ message }, 404);
}

export function forbidden(message = 'Forbidden') {
  return json({ message }, 403);
}

export function getAppSecret(c: { env: Env }) {
  const secret = c.env.APP_SECRET;
  if (c.env.ENVIRONMENT === 'production') {
    if (!secret || secret === DEV_APP_SECRET) {
      throw new Error('APP_SECRET must be set to a secure value in production');
    }
    return secret;
  }
  return secret || DEV_APP_SECRET;
}
