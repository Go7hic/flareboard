import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, ROLES } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const USER_ID = 'audit-owner';
const WEBSITE_ID = 'audit-website';
const BASE = Date.UTC(2026, 0, 25, 12);

async function authHeader() {
  const token = await createSecureToken({ userId: USER_ID, role: ROLES.user }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

describe('website audit log route', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
       VALUES (?1, 'audit-owner', 'hash', ?2, ?3, ?3)`,
    )
      .bind(USER_ID, ROLES.user, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, 'Audit Site', 'audit.example.com', ?2, ?3, ?3)`,
    )
      .bind(WEBSITE_ID, USER_ID, BASE)
      .run();
  });

  it('records website changes and lists them for the website owner', async () => {
    const updated = await fetchWorkerJson<{ name: string }>(`/api/websites/${WEBSITE_ID}`, {
      method: 'PATCH',
      headers: await authHeader(),
      body: JSON.stringify({ name: 'Audit Site Updated' }),
    });
    expect(updated.response.status).toBe(200);

    const audit = await fetchWorkerJson<{
      items: Array<{ action: string; entityType: string; entityId: string; metadata: Record<string, unknown> }>;
    }>(`/api/websites/${WEBSITE_ID}/audit`, {
      headers: await authHeader(),
    });

    expect(audit.response.status).toBe(200);
    expect(audit.body.items[0]).toEqual(
      expect.objectContaining({
        action: 'update',
        entityType: 'website',
        entityId: WEBSITE_ID,
      }),
    );
    expect(audit.body.items[0]!.metadata).toEqual(
      expect.objectContaining({
        name: 'Audit Site Updated',
      }),
    );
  });
});
