import { env } from 'cloudflare:workers';
import type { Env } from '../../src/env';
import { siteDb } from '../../src/lib/site-db';

/**
 * Handle for seeding and asserting a website's analytics tables (website_event, event_data,
 * session, …) in tests. Always use this instead of `env.DB` for SITE_TABLES so tests keep
 * working when those tables move into per-website Durable Objects.
 */
export function testSiteDb(websiteId: string): D1Database {
  return siteDb(env as unknown as Env, websiteId);
}
