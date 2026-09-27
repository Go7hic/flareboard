import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, ROLES } from '@flareboard/shared';
import worker from '../../src/index';
import { applyTestMigrations } from '../helpers/migrations';

const PAID_OWNER = 'plan-gate-paid-owner';
const FREE_OWNER = 'plan-gate-free-owner';
const TEAM_ID = 'plan-gate-team';
const PAID_SITE = 'plan-gate-paid-site';
const FREE_SITE = 'plan-gate-free-site';
const NOW = Date.now();

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
});
