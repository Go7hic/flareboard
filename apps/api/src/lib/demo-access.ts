import { DEMO_TEAM_ID, DEMO_USER_ID, DEMO_WEBSITE_IDS, PUBLIC_DEMO_WEBSITE_ID, ROLES } from '@flareboard/shared';
import type { Env } from '../env';

/**
 * The read-only demo behind "Explore the demo": one shared account (`DEMO_USER_ID`, no
 * password, no email) that is a view-only member of `DEMO_TEAM_ID`. Members of that team can
 * view the demo websites; the websites themselves keep their owner (see `demoWebsiteMembership`
 * in access.ts). The API refuses every change from a demo session (middleware/auth.ts).
 */

/** Demo sessions are short: the cookie, token and session row all end after this. */
export const DEMO_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/** Fixed membership id so ensureDemoAccess stays idempotent. */
const DEMO_TEAM_USER_ID = '00000000-0000-4000-8000-0000000000d2';
const DEMO_TEAM_NAME = 'Flareboard Demo';
/** First free name wins; a self-hosted install may already have a real user called "demo". */
const DEMO_USERNAMES = ['demo', 'flareboard-demo', `demo-${DEMO_USER_ID.slice(-8)}`];

export function isDemoUserId(userId: string | null | undefined): boolean {
  return userId === DEMO_USER_ID;
}

export function isDemoWebsiteId(websiteId: string | null | undefined): boolean {
  return Boolean(websiteId) && (DEMO_WEBSITE_IDS as readonly string[]).includes(websiteId!);
}

/** Demo websites that exist (not deleted), public demo first. */
export async function liveDemoWebsiteIds(env: Env): Promise<string[]> {
  const placeholders = DEMO_WEBSITE_IDS.map((_, index) => `?${index + 1}`).join(', ');
  const rows = await env.DB.prepare(
    `SELECT website_id AS id FROM website WHERE website_id IN (${placeholders}) AND deleted_at IS NULL`,
  )
    .bind(...DEMO_WEBSITE_IDS)
    .all<{ id: string }>();
  const found = new Set((rows.results ?? []).map((row) => row.id));
  return DEMO_WEBSITE_IDS.filter((id) => found.has(id));
}

async function demoUsername(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT username FROM user WHERE username IN (?1, ?2, ?3) AND user_id <> ?4`,
  )
    .bind(...DEMO_USERNAMES, DEMO_USER_ID)
    .all<{ username: string }>();
  const taken = new Set((rows.results ?? []).map((row) => row.username));
  return DEMO_USERNAMES.find((name) => !taken.has(name)) ?? `demo-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Creates (or repairs) the demo account, its team and its view-only membership. Idempotent:
 * safe to call on every demo sign-in. Returns null when no demo website exists, in which case
 * the demo is unavailable.
 */
export async function ensureDemoAccess(env: Env): Promise<{ websiteIds: string[]; websiteId: string } | null> {
  const websiteIds = await liveDemoWebsiteIds(env);
  if (!websiteIds.length) return null;

  const now = Date.now();
  const username = await demoUsername(env);
  await env.DB.batch([
    // No password hash (''): bcrypt never matches it, and handleLogin refuses the account anyway.
    env.DB.prepare(
      `INSERT INTO user (user_id, username, password, role, email, created_at, updated_at)
       VALUES (?1, ?2, '', ?3, NULL, ?4, ?4)
       ON CONFLICT(user_id) DO UPDATE SET
         password = '', role = excluded.role, email = NULL, email_verified_at = NULL, deleted_at = NULL,
         updated_at = excluded.updated_at
       WHERE user.password <> '' OR user.role <> excluded.role OR user.email IS NOT NULL
         OR user.email_verified_at IS NOT NULL OR user.deleted_at IS NOT NULL`,
    ).bind(DEMO_USER_ID, username, ROLES.viewOnly, now),
    // No access code (nobody can join) and no two-factor requirement (demo sessions have none).
    env.DB.prepare(
      `INSERT INTO team (team_id, name, access_code, require_two_factor, created_at, updated_at)
       VALUES (?1, ?2, NULL, 0, ?3, ?3)
       ON CONFLICT(team_id) DO UPDATE SET
         access_code = NULL, require_two_factor = 0, deleted_at = NULL, updated_at = excluded.updated_at
       WHERE team.access_code IS NOT NULL OR team.require_two_factor <> 0 OR team.deleted_at IS NOT NULL`,
    ).bind(DEMO_TEAM_ID, DEMO_TEAM_NAME, now),
    env.DB.prepare(
      `INSERT INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(team_user_id) DO UPDATE SET
         team_id = excluded.team_id, user_id = excluded.user_id, role = excluded.role, updated_at = excluded.updated_at
       WHERE team_user.team_id <> excluded.team_id OR team_user.user_id <> excluded.user_id
         OR team_user.role <> excluded.role`,
    ).bind(DEMO_TEAM_USER_ID, DEMO_TEAM_ID, DEMO_USER_ID, ROLES.teamViewOnly, now),
    // The demo account belongs to the demo team only, and never holds credentials of its own.
    env.DB.prepare(`DELETE FROM team_user WHERE user_id = ?1 AND team_user_id <> ?2`).bind(
      DEMO_USER_ID,
      DEMO_TEAM_USER_ID,
    ),
    env.DB.prepare(`DELETE FROM personal_api_key WHERE user_id = ?1`).bind(DEMO_USER_ID),
    env.DB.prepare(`DELETE FROM user_oauth_identity WHERE user_id = ?1`).bind(DEMO_USER_ID),
  ]);

  const websiteId = websiteIds.includes(PUBLIC_DEMO_WEBSITE_ID) ? PUBLIC_DEMO_WEBSITE_ID : websiteIds[0]!;
  return { websiteIds, websiteId };
}

export const DEMO_READ_ONLY_MESSAGE = 'The demo is read-only';

const DEMO_READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Out of reach for a demo session whatever the method: account credentials and security,
 * billing, administration, and the AI assistant (every question costs money).
 */
const DEMO_BLOCKED_PATHS: readonly RegExp[] = [
  /^\/api\/me\/(api-keys|2fa|sessions|password|delete|audit-log)(\/|$)/,
  /^\/api\/billing\/(checkout|portal)(\/|$)/,
  /^\/api\/admin(\/|$)/,
  /^\/api\/websites\/[^/]+\/assistant(\/|$)/,
  // The project key would let a visitor send events into the demo websites.
  /^\/api\/websites\/[^/]+\/project-key(\/|$)/,
];

/**
 * The only non-GET requests a demo session may make: they compute a result from stored data
 * and neither write nor send anything. Every other non-read is refused, so a new endpoint stays
 * closed to the demo until it is listed here.
 *
 * - insights/preview, insights/funnel-actors: run an unsaved insight query.
 * - warehouse/query, warehouse/query/export: read-only SELECTs (no query history for the demo).
 * - feature-flags/evaluate, evaluate-all: evaluate flags for a test context (no exposure is
 *   recorded for the demo).
 */
const DEMO_READ_ONLY_POSTS: readonly RegExp[] = [
  /^\/api\/insights\/preview$/,
  /^\/api\/insights\/funnel-actors$/,
  /^\/api\/websites\/[^/]+\/warehouse\/query$/,
  /^\/api\/websites\/[^/]+\/warehouse\/query\/export$/,
  /^\/api\/websites\/[^/]+\/feature-flags\/evaluate$/,
  /^\/api\/websites\/[^/]+\/feature-flags\/evaluate-all$/,
];

/** Whether a demo session may make this request (checked in jwtAuth before any handler runs). */
export function demoRequestAllowed(method: string, path: string): boolean {
  if (DEMO_BLOCKED_PATHS.some((pattern) => pattern.test(path))) return false;
  if (DEMO_READ_METHODS.has(method)) return true;
  return method === 'POST' && DEMO_READ_ONLY_POSTS.some((pattern) => pattern.test(path));
}
