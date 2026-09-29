import { env } from 'cloudflare:workers';
import type { Env } from '../../src/env';
import { siteDb } from '../../src/lib/site-db';

/**
 * Handle for seeding and asserting a website's analytics tables (person, session_replay, …) in
 * tests: the website's store under `EVENT_STORE=do`, D1 otherwise. Never use `env.DB` for them.
 */
export function testSiteDb(websiteId: string): D1Database {
  return siteDb(env as unknown as Env, websiteId);
}
