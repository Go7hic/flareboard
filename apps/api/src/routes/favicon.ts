import type { Context } from 'hono';
import type { Env } from '../env';
import { faviconHost, getFavicon } from '../lib/favicon';
import { badRequest } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

/** GET /api/favicon?domain=shop.example.com — the site's own favicon (signed-in users only). */
export async function handleFavicon(c: Ctx) {
  const host = faviconHost(c.req.query('domain'));
  if (!host) return badRequest('Invalid domain');
  let ctx: ExecutionContext | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  return getFavicon(host, ctx);
}
