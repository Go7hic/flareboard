import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, hashPassword } from '@flareboard/shared';
import { SESSION_COOKIE } from '../../src/lib/session-cookie';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const USER_ID = '00000000-0000-0000-0000-0000000000o1';

describe('oauth code exchange', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO user (user_id, username, password, role, token_version, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'admin', 0, ?4, ?4)`,
    )
      .bind(USER_ID, 'oauth-user', hashPassword('oauth-password'), Date.now())
      .run();
  });

  it('swaps a one-time code for a session cookie exactly once', async () => {
    const jwt = await createSecureToken({ userId: USER_ID, role: 'admin', tv: 0 }, env.APP_SECRET);
    await env.CACHE.put('oauth-code:sample-code', jwt, { expirationTtl: 60 });

    const first = await fetchWorkerJson<{ user: { id: string; username: string } }>('/api/auth/oauth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'sample-code' }),
    });
    expect(first.response.status).toBe(200);
    expect(first.body.user.id).toBe(USER_ID);
    expect(first.response.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE}=`);

    const second = await fetchWorkerJson('/api/auth/oauth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'sample-code' }),
    });
    expect(second.response.status).toBe(401);
  });
});
