import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, hashPassword } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const USER_ID = '00000000-0000-0000-0000-0000000000a1';

async function mintToken(tv: number) {
  return createSecureToken({ userId: USER_ID, role: 'admin', tv }, env.APP_SECRET);
}

describe('token revocation on password reset', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO user (user_id, username, password, role, token_version, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'admin', 0, ?4, ?4)`,
    )
      .bind(USER_ID, 'revocation-user', hashPassword('old-password'), Date.now())
      .run();
  });

  it('rejects a token issued before a password reset', async () => {
    const token = await mintToken(0);

    const before = await fetchWorkerJson('/api/me', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    expect(before.response.status).toBe(200);

    const resetToken = 'revocation-reset-token';
    await env.CACHE.put(`reset:${resetToken}`, USER_ID);
    const reset = await fetchWorkerJson('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: 'brand-new-password' }),
    });
    expect(reset.response.status).toBe(200);

    const after = await fetchWorkerJson('/api/me', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    expect(after.response.status).toBe(401);
  });
});
