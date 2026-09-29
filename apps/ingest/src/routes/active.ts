import type { Context } from 'hono';
import type { Env } from '../env';
import { json } from '../lib/response';
import { countActiveVisitors } from '../lib/realtime-kv';
import { resolveWebsiteRef } from '../lib/project-keys';

type Ctx = Context<{ Bindings: Env }>;

export async function handleActiveUsers(c: Ctx) {
  const websiteRef = c.req.param('websiteId') ?? c.req.query('websiteId');
  const websiteId = websiteRef ? (await resolveWebsiteRef(c.env, websiteRef))?.websiteId : undefined;
  if (!websiteId) {
    return json({ users: 0 });
  }
  return json({ users: await countActiveVisitors(c.env, websiteId) });
}
