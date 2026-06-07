import { createMiddleware } from 'hono/factory';
import { ROLES, parseSecureToken, type AuthUser } from '@flareboard/shared';
import type { Env } from '../env';
import { forbidden, getAppSecret, unauthorized } from '../lib/response';

export type ApiVariables = {
  user: AuthUser;
};

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

function isPasswordUpdate(path: string, method: string) {
  return method === 'PATCH' && path === '/api/me/password';
}

export const jwtAuth = createMiddleware<{ Bindings: Env; Variables: ApiVariables }>(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return unauthorized();
  }

  const payload = await parseSecureToken(token, getAppSecret(c));
  if (!payload?.userId || !payload?.role) {
    return unauthorized();
  }

  const role = String(payload.role);
  c.set('user', { userId: String(payload.userId), role });

  if (
    MUTATING_METHODS.has(c.req.method) &&
    (role === ROLES.viewOnly || role === ROLES.teamViewOnly) &&
    !isPasswordUpdate(c.req.path, c.req.method)
  ) {
    return forbidden('Read-only access');
  }

  await next();
});
