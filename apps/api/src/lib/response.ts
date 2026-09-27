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

function isLocalRequest(url: string) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/**
 * The public dev secret lets anyone mint session tokens, so it is only allowed for
 * local development. A deploy that forgot APP_SECRET (e.g. a plain `wrangler deploy`,
 * whose default ENVIRONMENT is "development") fails closed instead.
 */
export function getAppSecret(c: { env: Env; req: { url: string } }) {
  const secret = c.env.APP_SECRET;
  if (secret && secret !== DEV_APP_SECRET) return secret;
  if (c.env.ENVIRONMENT !== 'production' && isLocalRequest(c.req.url)) return DEV_APP_SECRET;
  throw new Error('APP_SECRET must be set to a secure value (only local development may use the dev secret)');
}
