import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSecureToken,
  DEMO_DOCS_WEBSITE_ID,
  DEMO_TEAM_ID,
  DEMO_USER_ID,
  EVENT_TYPE,
  generatePersonalApiKey,
  hashApiKey,
  PUBLIC_DEMO_WEBSITE_ID,
  ROLES,
} from '@flareboard/shared';
import { runDataDeletion } from '../../src/lib/data-deletion';
import { demoRequestAllowed } from '../../src/lib/demo-access';
import { fetchWorker } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';
import { CHROME_MAC, login, sessionTokenFrom, testIp } from '../helpers/auth';

const ORIGIN = 'http://localhost:5173';
const OWNER_ID = 'demo-spec-owner';
const OTHER_ID = 'demo-spec-other';
const OTHER_SITE = 'demo-spec-other-site';
const FLAG_ID = 'demo-spec-flag';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const RANGE = `startAt=${NOW - 7 * DAY}&endAt=${NOW + DAY}`;
const READ_ONLY = 'The demo is read-only';

async function startDemo(init: { ip?: string; cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'cf-connecting-ip': init.ip ?? testIp(),
    'User-Agent': CHROME_MAC,
  };
  if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN;
  if (init.cookie) headers.Cookie = `flareboard_session=${encodeURIComponent(init.cookie)}`;
  const response = await fetchWorker('/api/demo/session', { method: 'POST', headers, body: '{}' });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { response, body: body ?? {}, token: sessionTokenFrom(response) };
}

/** A request from the dashboard with the demo session cookie. */
async function asDemo(token: string, path: string, init: { method?: string; body?: unknown } = {}) {
  const response = await fetchWorker(path, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `flareboard_session=${encodeURIComponent(token)}`,
      Origin: ORIGIN,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await response.json().catch(() => null)) as Record<string, any> | null;
  return { status: response.status, body: body ?? {}, response };
}

async function seedSites() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
     VALUES (?1, 'demo-spec-owner', 'hash', ?3, ?4, ?4), (?2, 'demo-spec-other', 'hash', ?3, ?4, ?4)`,
  )
    .bind(OWNER_ID, OTHER_ID, ROLES.user, NOW)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
     VALUES (?1, 'Demo Store', 'demo-store.example.com', ?4, ?5, ?5),
            (?2, 'Demo Docs', 'docs.example.com', ?4, ?5, ?5),
            (?3, 'Someone else', 'other.example.com', ?6, ?5, ?5)`,
  )
    .bind(PUBLIC_DEMO_WEBSITE_ID, DEMO_DOCS_WEBSITE_ID, OTHER_SITE, OWNER_ID, NOW, OTHER_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO feature_flag (flag_id, website_id, key, name, created_at, updated_at)
     VALUES (?1, ?2, 'new-checkout', 'New checkout', ?3, ?3)`,
  )
    .bind(FLAG_ID, PUBLIC_DEMO_WEBSITE_ID, NOW)
    .run();
  const site = testSiteDb(PUBLIC_DEMO_WEBSITE_ID);
  await site
    .prepare(
      `INSERT OR REPLACE INTO session (session_id, website_id, browser, os, device, country, created_at)
       VALUES ('demo-spec-session', ?1, 'Chrome', 'macOS', 'desktop', 'US', ?2)`,
    )
    .bind(PUBLIC_DEMO_WEBSITE_ID, NOW - 1000)
    .run();
  await site
    .prepare(
      `INSERT OR REPLACE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name, hostname)
       VALUES ('demo-spec-pageview', ?1, 'demo-spec-session', 'demo-spec-visit', ?2, '/pricing', ?3, NULL, 'demo-store.example.com'),
              ('demo-spec-signup', ?1, 'demo-spec-session', 'demo-spec-visit', ?2, '/pricing', ?4, 'signup', 'demo-store.example.com')`,
    )
    .bind(PUBLIC_DEMO_WEBSITE_ID, NOW - 500, EVENT_TYPE.pageView, EVENT_TYPE.customEvent)
    .run();
}

describe('POST /api/demo/session without demo websites', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('answers 404 and creates nothing', async () => {
    const { response, token } = await startDemo();
    expect(response.status).toBe(404);
    expect(token).toBeNull();
    const user = await env.DB.prepare('SELECT 1 AS found FROM user WHERE user_id = ?1').bind(DEMO_USER_ID).first();
    expect(user).toBeNull();
  });
});

describe('read-only demo session', () => {
  let token = '';

  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedSites();
    const started = await startDemo();
    expect(started.response.status).toBe(200);
    token = started.token!;
  });

  it('signs in as the passwordless demo account for four hours', async () => {
    const ip = testIp();
    const { response, body, token: fresh } = await startDemo({ ip });
    expect(response.status).toBe(200);
    expect(body).toEqual({ websiteId: PUBLIC_DEMO_WEBSITE_ID });
    expect(fresh).toBeTruthy();
    const cookie = response.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/Max-Age=14400/);
    expect(cookie).toMatch(/HttpOnly/);

    const user = await env.DB.prepare('SELECT username, password, role, email FROM user WHERE user_id = ?1')
      .bind(DEMO_USER_ID)
      .first<{ username: string; password: string; role: string; email: string | null }>();
    expect(user).toEqual({ username: 'demo', password: '', role: ROLES.viewOnly, email: null });
    const membership = await env.DB.prepare('SELECT role FROM team_user WHERE user_id = ?1 AND team_id = ?2')
      .bind(DEMO_USER_ID, DEMO_TEAM_ID)
      .first<{ role: string }>();
    expect(membership?.role).toBe(ROLES.teamViewOnly);
    // The websites keep their owner.
    const site = await env.DB.prepare('SELECT user_id AS userId, team_id AS teamId FROM website WHERE website_id = ?1')
      .bind(PUBLIC_DEMO_WEBSITE_ID)
      .first<{ userId: string; teamId: string | null }>();
    expect(site).toEqual({ userId: OWNER_ID, teamId: null });

    const session = await env.DB.prepare(
      `SELECT method, device, expires_at - created_at AS ttl FROM user_session WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(DEMO_USER_ID)
      .first<{ method: string; device: string; ttl: number }>();
    expect(session).toEqual({ method: 'demo', device: 'Chrome on macOS', ttl: 4 * 60 * 60 * 1000 });

    const me = await asDemo(fresh!, '/api/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: DEMO_USER_ID, username: 'demo', isDemo: true });
  });

  it('keeps an existing demo session instead of starting another', async () => {
    const count = async () =>
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM user_session WHERE user_id = ?1').bind(DEMO_USER_ID).first<{ n: number }>())!.n;
    const before = await count();
    const again = await startDemo({ cookie: token });
    expect(again.response.status).toBe(200);
    expect(again.token).toBeNull();
    expect(await count()).toBe(before);
  });

  it('requires the dashboard origin', async () => {
    const { response } = await startDemo({ origin: null });
    expect(response.status).toBe(403);
    const foreign = await startDemo({ origin: 'https://evil.example' });
    expect(foreign.response.status).toBe(403);
  });

  it('rate limits demo sign-ins per IP', async () => {
    const ip = testIp();
    for (let i = 0; i < 10; i++) {
      expect((await startDemo({ ip })).response.status).toBe(200);
    }
    expect((await startDemo({ ip })).response.status).toBe(429);
    // Another visitor is unaffected.
    expect((await startDemo()).response.status).toBe(200);
  });

  it('is not blocked by a two-factor requirement on the demo team', async () => {
    await env.DB.prepare('UPDATE team SET require_two_factor = 1 WHERE team_id = ?1').bind(DEMO_TEAM_ID).run();
    const { response, token: fresh } = await startDemo();
    expect(response.status).toBe(200);
    const site = await asDemo(fresh!, `/api/websites/${PUBLIC_DEMO_WEBSITE_ID}`);
    expect(site.status).toBe(200);
  });

  it('reads the demo websites', async () => {
    const list = await asDemo(token, '/api/websites');
    expect(list.status).toBe(200);
    const ids = (list.body as unknown as Array<{ id?: string; websiteId?: string }>).map((w) => w.id ?? w.websiteId);
    expect(ids.sort()).toEqual([PUBLIC_DEMO_WEBSITE_ID, DEMO_DOCS_WEBSITE_ID].sort());

    const stats = await asDemo(token, `/api/websites/${PUBLIC_DEMO_WEBSITE_ID}/stats?${RANGE}`);
    expect(stats.status).toBe(200);
    expect(stats.body.pageviews.value).toBeGreaterThan(0);

    const pages = await asDemo(token, `/api/websites/${PUBLIC_DEMO_WEBSITE_ID}/metrics?type=path&${RANGE}`);
    expect(pages.status).toBe(200);
    expect(JSON.stringify(pages.body)).toContain('/pricing');

    const permissions = await asDemo(token, `/api/websites/${PUBLIC_DEMO_WEBSITE_ID}/permissions`);
    expect(permissions.status).toBe(200);
    expect(permissions.body).toMatchObject({ canView: true, canEdit: false, canManageTeam: false });
    expect(Object.values(permissions.body.modules as Record<string, { canEdit: boolean }>).every((m) => !m.canEdit)).toBe(true);

    const flags = await asDemo(token, `/api/websites/${PUBLIC_DEMO_WEBSITE_ID}/feature-flags`);
    expect(flags.status).toBe(200);

    const billing = await asDemo(token, '/api/billing/subscription');
    expect(billing.status).toBe(200);
  });

  it('runs the read-only POSTs', async () => {
    const preview = await asDemo(token, `/api/insights/preview?websiteId=${PUBLIC_DEMO_WEBSITE_ID}&${RANGE}`, {
      method: 'POST',
      body: { type: 'trend', query: { metric: 'events', event: 'signup', unit: 'day' } },
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ kind: 'trend' });

    const actors = await asDemo(token, `/api/insights/funnel-actors?websiteId=${PUBLIC_DEMO_WEBSITE_ID}&${RANGE}`, {
      method: 'POST',
      body: {
        type: 'funnel',
        query: {
          version: 2,
          funnel: {
            steps: [
              { kind: 'event', event: 'signup' },
              { kind: 'event', event: 'purchase' },
            ],
            window: { value: 1, unit: 'hour' },
          },
        },
        step: 0,
        outcome: 'converted',
      },
    });
    expect(actors.status).toBe(200);

    const query = await asDemo(token, `/api/websites/${PUBLIC_DEMO_WEBSITE_ID}/warehouse/query`, {
      method: 'POST',
      body: { sql: 'SELECT event_name FROM website_event WHERE website_id = ?1 LIMIT 10' },
    });
    expect(query.status).toBe(200);
    // Demo queries stay out of the website's shared query history.
    const history = await asDemo(token, `/api/websites/${PUBLIC_DEMO_WEBSITE_ID}/warehouse/history`);
    expect(history.status).toBe(200);
    expect(history.body.history).toEqual([]);

    const evaluated = await asDemo(token, `/api/websites/${PUBLIC_DEMO_WEBSITE_ID}/feature-flags/evaluate`, {
      method: 'POST',
      body: { key: 'new-checkout', distinctId: 'visitor-1' },
    });
    expect(evaluated.status).toBe(200);
    const all = await asDemo(token, `/api/websites/${PUBLIC_DEMO_WEBSITE_ID}/feature-flags/evaluate-all`, {
      method: 'POST',
      body: { distinctId: 'visitor-1' },
    });
    expect(all.status).toBe(200);
  });

  it('refuses every change', async () => {
    const site = `/api/websites/${PUBLIC_DEMO_WEBSITE_ID}`;
    const blocked: Array<[method: string, path: string, body?: unknown]> = [
      ['POST', '/api/websites', { name: 'Mine', domain: 'mine.example.com' }],
      ['PATCH', site, { name: 'Renamed' }],
      ['DELETE', site],
      ['PATCH', `${site}/feature-flags/${FLAG_ID}`, { enabled: false }],
      ['DELETE', `${site}/feature-flags/${FLAG_ID}`],
      ['POST', `${site}/feature-flags`, { key: 'x', name: 'x' }],
      ['DELETE', `${site}/cohorts/some-cohort`],
      ['POST', `${site}/annotations`, { text: 'hi', createdAt: NOW }],
      ['PATCH', `${site}/people/someone`, { properties: {} }],
      ['POST', '/api/insights', { websiteId: PUBLIC_DEMO_WEBSITE_ID, name: 'x', type: 'trend', query: {} }],
      ['POST', '/api/boards', { name: 'x' }],
      // AI assistant (costs money), including the view-only exceptions.
      ['GET', `${site}/assistant`],
      ['POST', `${site}/assistant/messages`, { message: 'hello' }],
      ['DELETE', `${site}/assistant/conversations/abc`],
      // Personal API keys and account security.
      ['GET', '/api/me/api-keys'],
      ['POST', '/api/me/api-keys', { name: 'k', scopes: ['read'] }],
      ['POST', '/api/me/2fa/setup', {}],
      ['POST', '/api/me/2fa/enable', { code: '000000' }],
      ['GET', '/api/me/sessions'],
      ['POST', '/api/me/sessions/revoke-others', {}],
      ['GET', '/api/me/audit-log'],
      ['PATCH', '/api/me/password', { currentPassword: '', newPassword: 'another-password-1' }],
      ['PATCH', '/api/me', { displayName: 'Hacker' }],
      ['POST', '/api/me/delete', { confirm: 'demo' }],
      // Billing, sharing, teams, imports and exports, administration.
      ['POST', '/api/billing/checkout', { planId: 'cloud' }],
      ['POST', '/api/billing/portal', {}],
      ['POST', '/api/share', { entityId: PUBLIC_DEMO_WEBSITE_ID, shareType: 1 }],
      ['POST', `/api/insights/some-insight/share`, {}],
      ['POST', `${site}/replays/some-replay/shares`, {}],
      ['POST', '/api/teams', { name: 'Mine' }],
      ['POST', '/api/teams/join', { accessCode: 'abc' }],
      ['POST', `/api/teams/${DEMO_TEAM_ID}/websites`, { name: 'x', domain: 'x.example.com' }],
      ['PATCH', `/api/teams/${DEMO_TEAM_ID}/users/${DEMO_USER_ID}`, { role: ROLES.teamOwner }],
      ['POST', `${site}/import`, {}],
      ['POST', `${site}/warehouse/schedules/run-due`, {}],
      ['POST', `${site}/warehouse/data-sources`, {}],
      ['POST', `${site}/workflows/some-workflow/test`, { send: true }],
      ['POST', `${site}/project-key/rotate`, {}],
      ['GET', `${site}/project-key`],
      ['GET', '/api/admin/export'],
      ['POST', '/api/admin/users', { username: 'x', password: 'y', role: 'admin' }],
    ];
    for (const [method, path, body] of blocked) {
      const result = await asDemo(token, path, { method, body });
      expect({ method, path, status: result.status, message: result.body.message }).toEqual({
        method,
        path,
        status: 403,
        message: READ_ONLY,
      });
    }
    // Nothing changed.
    const flag = await env.DB.prepare('SELECT enabled FROM feature_flag WHERE flag_id = ?1').bind(FLAG_ID).first<{ enabled: number }>();
    expect(flag?.enabled).toBe(1);
    const keys = await env.DB.prepare('SELECT COUNT(*) AS n FROM personal_api_key WHERE user_id = ?1')
      .bind(DEMO_USER_ID)
      .first<{ n: number }>();
    expect(keys?.n).toBe(0);
  });

  it('allows only listed POSTs, and blocks writes by default', () => {
    expect(demoRequestAllowed('POST', '/api/insights/preview')).toBe(true);
    expect(demoRequestAllowed('POST', '/api/websites/x/warehouse/query')).toBe(true);
    expect(demoRequestAllowed('POST', '/api/websites/x/some-new-endpoint')).toBe(false);
    expect(demoRequestAllowed('PUT', '/api/websites/x/ai-observability/settings')).toBe(false);
    expect(demoRequestAllowed('PUT', '/api/websites/x/feature-flags/early-access/k/enrollment')).toBe(false);
    expect(demoRequestAllowed('POST', '/api/insights/preview/extra')).toBe(false);
    expect(demoRequestAllowed('GET', '/api/me/2fa')).toBe(false);
  });

  it('never sees or reaches another website', async () => {
    for (const path of [
      `/api/websites/${OTHER_SITE}`,
      `/api/websites/${OTHER_SITE}/stats?${RANGE}`,
      `/api/websites/${OTHER_SITE}/permissions`,
      `/api/insights/property-keys?websiteId=${OTHER_SITE}&type=event`,
    ]) {
      expect((await asDemo(token, path)).status, path).toBe(404);
    }
    const preview = await asDemo(token, `/api/insights/preview?websiteId=${OTHER_SITE}&${RANGE}`, {
      method: 'POST',
      body: { type: 'trend', query: { metric: 'events', event: 'signup', unit: 'day' } },
    });
    expect(preview.status).toBe(404);
    const dashboard = await asDemo(token, '/api/dashboard');
    expect(JSON.stringify(dashboard.body)).not.toContain(OTHER_SITE);
  });

  it('keeps the demo websites out of a real account\'s overview, its owner\'s included', async () => {
    const ownSite = 'demo-spec-own-site';
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, 'Own site', 'own.example.com', ?2, ?3, ?3)`,
    )
      .bind(ownSite, OWNER_ID, NOW)
      .run();
    await testSiteDb(ownSite)
      .prepare(
        `INSERT OR REPLACE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type)
         VALUES ('demo-spec-own-view', ?1, 'own-session', 'own-visit', ?2, '/', ?3)`,
      )
      .bind(ownSite, NOW - 500, EVENT_TYPE.pageView)
      .run();
    const owner = await createSecureToken({ userId: OWNER_ID, role: ROLES.user }, env.APP_SECRET);
    const response = await fetchWorker(`/api/dashboard?${RANGE}`, { headers: { Authorization: `Bearer ${owner}` } });
    expect(response.status).toBe(200);
    const overview = (await response.json()) as { siteCount: number; totals: { pageviews: number }; websites: Array<{ id: string }> };
    expect(overview.siteCount).toBe(1);
    expect(overview.websites.map((site) => site.id)).toEqual([ownSite]);
    expect(overview.totals.pageviews).toBe(1);

    const demo = await asDemo(token, `/api/dashboard?${RANGE}`);
    expect(demo.status).toBe(200);
    expect(demo.body.websites.map((site: { id: string }) => site.id)).toContain(PUBLIC_DEMO_WEBSITE_ID);
    expect(demo.body.totals.pageviews).toBe(1);
  });

  it('cannot sign in with a password or an API key', async () => {
    for (const password of ['', 'demo', 'flareboard']) {
      const result = await login('demo', password);
      expect(result.response.status).not.toBe(200);
      expect(result.token).toBeNull();
    }
    // Even a key row planted directly in the database does not authenticate.
    const secret = generatePersonalApiKey();
    await env.DB.prepare(
      `INSERT INTO personal_api_key (key_id, user_id, name, key_hash, key_prefix, scopes, created_at)
       VALUES ('demo-spec-key', ?1, 'planted', ?2, 'fb_sk_x', 'read,write', ?3)`,
    )
      .bind(DEMO_USER_ID, await hashApiKey(secret), NOW)
      .run();
    const response = await fetchWorker('/api/websites', { headers: { Authorization: `Bearer ${secret}` } });
    expect(response.status).toBe(401);
  });

  it('is never erased by the deletion job, while its expired sessions are', async () => {
    await env.DB.prepare(
      `INSERT INTO user_session (session_id, user_id, device, method, created_at, last_seen_at, expires_at)
       VALUES ('demo-spec-expired', ?1, 'Chrome on macOS', 'demo', ?2, ?2, ?3)`,
    )
      .bind(DEMO_USER_ID, NOW - 5 * 60 * 60 * 1000, NOW - 60 * 60 * 1000)
      .run();
    await env.DB.prepare('UPDATE user SET deleted_at = ?2 WHERE user_id = ?1').bind(DEMO_USER_ID, NOW - 90 * DAY).run();
    await runDataDeletion(env, NOW);
    const user = await env.DB.prepare('SELECT 1 AS found FROM user WHERE user_id = ?1').bind(DEMO_USER_ID).first();
    expect(user).not.toBeNull();
    const expired = await env.DB.prepare(`SELECT 1 AS found FROM user_session WHERE session_id = 'demo-spec-expired'`).first();
    expect(expired).toBeNull();
  });
});
