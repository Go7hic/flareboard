import { hashApiKey, isPersonalApiKey } from '@flareboard/shared';
import type { Env } from '../env';

/**
 * A backend can sign its /api/send requests with a personal API key (`Authorization: Bearer
 * fb_sk_…`, write scope, from a user who can access the website). Website ids and project keys
 * are public, so only a key proves a request comes from the site's own server; such requests
 * skip the per-IP limit on workflow triggers, which would otherwise hold every event from one
 * server to the limit meant for one visitor. Per-website execution and delivery caps still apply.
 */
export type ServerKeyCheck = 'none' | 'valid' | 'invalid';

export async function checkServerKey(env: Env, req: Request, websiteId: string | undefined): Promise<ServerKeyCheck> {
  const header = req.headers.get('authorization');
  if (!header) return 'none';
  const secret = header.replace(/^Bearer\s+/i, '').trim();
  if (!isPersonalApiKey(secret) || !websiteId) return 'invalid';
  const row = await env.DB.prepare(
    `SELECT k.scopes AS scopes
     FROM personal_api_key k
     JOIN user u ON u.user_id = k.user_id AND u.deleted_at IS NULL
     JOIN website w ON w.website_id = ?2 AND w.deleted_at IS NULL
     WHERE k.key_hash = ?1
       AND (w.user_id = k.user_id
         OR EXISTS (SELECT 1 FROM team_user tu WHERE tu.team_id = w.team_id AND tu.user_id = k.user_id))
     LIMIT 1`,
  )
    .bind(await hashApiKey(secret), websiteId)
    .first<{ scopes: string }>();
  return row && row.scopes.split(',').includes('write') ? 'valid' : 'invalid';
}
