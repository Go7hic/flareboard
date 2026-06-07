import type { Context } from 'hono';
import type { Env } from '../env';
import { json } from '../lib/response';

type Ctx = Context<{ Bindings: Env }>;

export async function handleActiveUsers(c: Ctx) {
  const websiteId = c.req.param('websiteId') ?? c.req.query('websiteId');
  if (!websiteId) {
    return json({ users: 0 });
  }
  const count = await c.env.CACHE.get(`rt:${websiteId}:visitors`);
  return json({ users: count ? parseInt(count, 10) : 0 });
}
