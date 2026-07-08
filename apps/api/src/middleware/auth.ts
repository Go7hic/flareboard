import { createMiddleware } from 'hono/factory';
import { ROLES, parseSecureToken, type AuthUser } from '@flareboard/shared';
import type { Env } from '../env';
import { getTokenVersion } from '../lib/auth-token';
import { readAuthToken } from '../lib/auth-credentials';
import { csrfOriginAllowed } from '../lib/csrf';
import { forbidden, getAppSecret, unauthorized } from '../lib/response';

export type ApiVariables = {
  user: AuthUser;
};

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

function isPasswordUpdate(path: string, method: string) {
  return method === 'PATCH' && path === '/api/me/password';
}

export const jwtAuth = createMiddleware<{ Bindings: Env; Variables: ApiVariables }>(async (c, next) => {
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
