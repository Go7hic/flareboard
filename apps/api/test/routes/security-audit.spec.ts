import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations } from '../helpers/migrations';
import { call, createTestUser, login } from '../helpers/auth';
import { fetchWorker } from '../helpers/fetch-worker';

async function actions(userId: string) {
  const rows = await env.DB.prepare(`SELECT entity_type || '.' || action AS a FROM audit_log WHERE user_id = ?1`)
    .bind(userId)
    .all<{ a: string }>();
  return rows.results.map((row) => row.a);
}

describe('security audit coverage', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('records API keys, share links, exports and website deletion', async () => {
    const userId = await createTestUser('audit-cover', 'cover-password');
    const token = (await login('audit-cover', 'cover-password')).token!;

    const key = await call('/api/me/api-keys', token, { method: 'POST', body: JSON.stringify({ name: 'CI', scopes: ['read'] }) });
    await call(`/api/me/api-keys/${key.body.id}`, token, { method: 'DELETE' });

    const site = await call('/api/websites', token, { method: 'POST', body: JSON.stringify({ name: 'Audit', domain: 'audit.example' }) });
    const websiteId = site.body.id as string;
    expect(websiteId).toBeTruthy();

    const share = await call('/api/share', token, { method: 'POST', body: JSON.stringify({ websiteId }) });
    expect(share.response.status).toBe(201);

    const exported = await fetchWorker(`/api/websites/${websiteId}/export?type=events`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(exported.status).toBe(200);
    await exported.text();

    await call(`/api/websites/${websiteId}`, token, { method: 'DELETE' });

    expect(await actions(userId)).toEqual(
      expect.arrayContaining([
        'user.login',
        'personal_api_key.create',
        'personal_api_key.delete',
        'website.create',
        'share.create',
        'website.export',
        'website.delete',
      ]),
    );
    const shareEntry = await env.DB.prepare(`SELECT metadata FROM audit_log WHERE user_id = ?1 AND entity_type = 'share'`)
      .bind(userId)
      .first<{ metadata: string }>();
    // The website purge erases history that names its website.
    expect(JSON.parse(shareEntry!.metadata).websiteId).toBe(websiteId);
  });
});
