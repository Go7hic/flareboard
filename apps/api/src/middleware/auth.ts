import type { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { PERSONAL_KEY_PREFIX, ROLES, isPersonalApiKey, parseSecureToken, type AuthUser } from '@flareboard/shared';
import type { Env } from '../env';
import { getTokenVersion } from '../lib/auth-token';
import { readAuthToken, readBearerToken } from '../lib/auth-credentials';
import { csrfOriginAllowed } from '../lib/csrf';
import { authenticatePersonalApiKey, touchPersonalApiKey } from '../lib/personal-api-keys';
import { forbidden, getAppSecret, unauthorized } from '../lib/response';

export type ApiVariables = {
  user: AuthUser;
};

type AuthContext = Context<{ Bindings: Env; Variables: ApiVariables }>;

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);
const READ_METHODS = new Set(['GET', 'HEAD']);

function isPasswordUpdate(path: string, method: string) {
  return method === 'PATCH' && path === '/api/me/password';
}

/**
 * Credential and account management needs a signed-in session: a leaked personal API key must
 * not be able to mint more keys, change the password or delete the account.
 */
function sessionOnlyPath(path: string) {
  return (
    path === '/api/me/api-keys' ||
    path.startsWith('/api/me/api-keys/') ||
    path === '/api/me/password' ||
    path === '/api/me/delete'
  );
}

/** `Authorization: Bearer fb_sk_…`: acts as the key's user, limited by the key's scopes. */
async function personalApiKeyAuth(c: AuthContext, next: Next, secret: string) {
  if (!isPersonalApiKey(secret)) return unauthorized({ message: 'Invalid API key' });
  const key = await authenticatePersonalApiKey(c.env, secret);
  if (!key) return unauthorized({ message: 'Invalid API key' });

  if (sessionOnlyPath(c.req.path)) {
    return forbidden('Personal API keys cannot manage API keys, the password or the account');
  }
  const needed = READ_METHODS.has(c.req.method) ? 'read' : 'write';
  if (!key.scopes.includes(needed)) {
    return forbidden(`This API key does not have the ${needed} scope`);
  }

  c.set('user', { userId: key.userId, role: key.role });
  if (MUTATING_METHODS.has(c.req.method) && (key.role === ROLES.viewOnly || key.role === ROLES.teamViewOnly)) {
    return forbidden('Read-only access');
  }

  const touch = touchPersonalApiKey(c.env, key).catch((error) =>
    console.error(JSON.stringify({ event: 'api_key_touch_failed', error: String(error) })),
  );
  try {
    c.executionCtx.waitUntil(touch);
  } catch {
    await touch;
  }

  await next();
}

export const jwtAuth = createMiddleware<{ Bindings: Env; Variables: ApiVariables }>(async (c, next) => {
  const bearer = readBearerToken(c);
  if (bearer?.startsWith(PERSONAL_KEY_PREFIX)) {
    return personalApiKeyAuth(c, next, bearer);
  }

  const token = readAuthToken(c);
  if (!token) {
    return unauthorized();
  }

  const payload = await parseSecureToken(token, getAppSecret(c));
  if (!payload?.userId || !payload?.role) {
    return unauthorized();
  }

  const userId = String(payload.userId);
  const tokenVersion = typeof payload.tv === 'number' ? payload.tv : 0;
  if ((await getTokenVersion(c.env, userId)) !== tokenVersion) {
    return unauthorized();
  }

  const role = String(payload.role);
  c.set('user', { userId, role });

  if (!csrfOriginAllowed(c)) {
    return forbidden('Invalid origin');
  }

  if (
    MUTATING_METHODS.has(c.req.method) &&
    (role === ROLES.viewOnly || role === ROLES.teamViewOnly) &&
    !isPasswordUpdate(c.req.path, c.req.method)
  ) {
    return forbidden('Read-only access');
  }

  await next();
});
