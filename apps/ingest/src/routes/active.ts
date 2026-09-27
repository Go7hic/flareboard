import type { Context } from 'hono';
import type { Env } from '../env';
import { json } from '../lib/response';
import { countActiveVisitors } from '../lib/realtime-kv';

type Ctx = Context<{ Bindings: Env }>;

export async function handleActiveUsers(c: Ctx) {
  const websiteId = c.req.param('websiteId') ?? c.req.query('websiteId');
  if (!websiteId) {
    return json({ users: 0 });
  }
  return json({ users: await countActiveVisitors(c.env, websiteId) });
}
