import { getSalt, getSecret, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { checkIpRateLimit, getTrustedClientIp } from './rate-limit';

export type HitSource = 'link' | 'pixel';

const HIT_LIMIT_PER_IP = 120;
const HIT_WINDOW_SEC = 60;

/**
 * Per-IP cap on recorded hits. It only gates the analytics write, never the
 * visitor-facing redirect or image, so a flood drops the abuser's stats only.
 */
export async function hitAllowed(env: Env, source: HitSource, sourceId: string, req: Request) {
  const rl = await checkIpRateLimit(env, `${source}:${sourceId}`, getTrustedClientIp(req), HIT_LIMIT_PER_IP, HIT_WINDOW_SEC);
  return rl.allowed;
}

export async function recordHit(env: Env, source: HitSource, sourceId: string, req: Request) {
  const createdAt = new Date();
  const ip = getTrustedClientIp(req);
  const userAgent = req.headers.get('user-agent') ?? '';
  // Same monthly-salted hash as website sessions (getSalt defaults to 'month'): counts unique
  // visitors without storing IPs. Keep the Privacy Policy in sync if the rotation changes.
  const visitorId = uuid(sourceId, ip, userAgent, getSalt(createdAt), getSecret(env.APP_SECRET));
  await env.DB.prepare(
    `INSERT INTO link_pixel_hit (hit_id, source_type, source_id, visitor_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(crypto.randomUUID(), source, sourceId, visitorId, createdAt.getTime())
    .run();
}

export async function sourceExists(env: Env, source: HitSource, sourceId: string) {
  const table = source === 'link' ? 'link' : 'pixel';
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM ${table} WHERE ${table}_id = ?1 AND deleted_at IS NULL LIMIT 1`,
  )
    .bind(sourceId)
    .first<{ ok: number }>();
  return Boolean(row);
}
