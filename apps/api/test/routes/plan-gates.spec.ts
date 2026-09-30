import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, currentMonthKey, ROLES } from '@flareboard/shared';
import worker from '../../src/index';
import { applyTestMigrations } from '../helpers/migrations';

const PAID_OWNER = 'plan-gate-paid-owner';
const FREE_OWNER = 'plan-gate-free-owner';
const TEAM_ID = 'plan-gate-team';
const PAID_SITE = 'plan-gate-paid-site';
const FREE_SITE = 'plan-gate-free-site';
const NOW = Date.now();

async function hostedCall(userId: string, path: string, init: RequestInit = {}) {
  const token = await createSecureToken({ userId, role: ROLES.user }, env.APP_SECRET);
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://example.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    }),
    { ...env, HOSTED_MODE: 'true' },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function getFlags(userId: string, websiteId: string) {
  const token = await createSecureToken({ userId, role: ROLES.user }, env.APP_SECRET);
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://example.com/api/websites/${websiteId}/feature-flags`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    { ...env, HOSTED_MODE: 'true' },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response.status;
}

describe('paid feature gates follow the website owner’s plan', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
       VALUES (?1, 'plan-gate-paid', 'hash', 'user', ?3, ?3), (?2, 'plan-gate-free', 'hash', 'user', ?3, ?3)`,
    )
      .bind(PAID_OWNER, FREE_OWNER, NOW)
      .run();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO user_subscription (user_id, plan_id, status, created_at, updated_at)
       VALUES (?1, 'cloud', 'active', ?3, ?3), (?2, 'free', 'active', ?3, ?3)`,
    )
      .bind(PAID_OWNER, FREE_OWNER, NOW)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO team (team_id, name, access_code, created_at, updated_at) VALUES (?1, 'Plan gate', 'plangate', ?2, ?2)`,
    )
      .bind(TEAM_ID, NOW)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at)
       VALUES ('plan-gate-paid-m', ?1, ?2, ?4, ?5, ?5), ('plan-gate-free-m', ?1, ?3, ?4, ?5, ?5)`,
    )
      .bind(TEAM_ID, PAID_OWNER, FREE_OWNER, ROLES.teamMember, NOW)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, team_id, created_at, updated_at)
       VALUES (?1, 'Paid', 'paid.example', ?2, ?5, ?6, ?6), (?3, 'Free', 'free.example', ?4, ?5, ?6, ?6)`,
    )
      .bind(PAID_SITE, PAID_OWNER, FREE_SITE, FREE_OWNER, TEAM_ID, NOW)
      .run();
  });

  it('lets a free-plan member use flags on a paid owner’s site', async () => {
    expect(await getFlags(FREE_OWNER, PAID_SITE)).toBe(200);
  });

  it('blocks a paid member on a free owner’s site', async () => {
    expect(await getFlags(PAID_OWNER, FREE_SITE)).toBe(403);
  });

  it('caps website retention at the owner’s plan maximum', async () => {
    const patch = (userId: string, websiteId: string, retentionDays: number | null) =>
      hostedCall(userId, `/api/websites/${websiteId}`, { method: 'PATCH', body: JSON.stringify({ retentionDays }) });
    const tooLong = await patch(FREE_OWNER, FREE_SITE, 400);
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as { message: string }).message).toContain('365 days on the Free plan');
    expect((await patch(FREE_OWNER, FREE_SITE, 365)).status).toBe(200);
    const saved = (await (await hostedCall(FREE_OWNER, `/api/websites/${FREE_SITE}`)).json()) as { retentionDays: number | null };
    expect(saved.retentionDays).toBe(365);
    expect((await patch(FREE_OWNER, FREE_SITE, null)).status).toBe(200);
    expect((await patch(PAID_OWNER, PAID_SITE, 1095)).status).toBe(200);
    expect((await patch(PAID_OWNER, PAID_SITE, 1096)).status).toBe(400);
  });

  it('reports every monthly allowance with this month’s usage', async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO usage_monthly (user_id, month_key, events_count, replays_count, otel_rows) VALUES (?1, ?2, 1200, 7, 30)`,
    )
      .bind(PAID_OWNER, currentMonthKey())
      .run();
    const body = (await (await hostedCall(PAID_OWNER, '/api/billing/subscription')).json()) as {
      plan: Record<string, unknown>;
      usage: Record<string, number>;
    };
    expect(body.plan).toMatchObject({ maxReplaysPerMonth: 5000, maxOtelRowsPerMonth: 10_000_000, maxRetentionDays: 1095, usageGraceMultiple: 2 });
    expect(body.usage).toEqual({ eventsThisMonth: 1200, replaysThisMonth: 7, otelRowsThisMonth: 30 });
  });
});
