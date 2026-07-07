import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, hashPassword } from '@flareboard/shared';
import { SESSION_COOKIE } from '../../src/lib/session-cookie';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const USER_ID = '00000000-0000-0000-0000-0000000000c7';

function cookieHeader(response: Response) {
  const setCookie = response.headers.get('Set-Cookie') ?? '';
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? `${SESSION_COOKIE}=${match[1]}` : '';
}

describe('session cookie auth', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO user (user_id, username, password, role, token_version, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'admin', 0, ?4, ?4)`,
    )
      .bind(USER_ID, 'cookie-user', hashPassword('cookie-password'), Date.now())
      .run();
  });

  it('sets an httpOnly session cookie on login and accepts it on protected routes', async () => {
    const login = await fetchWorkerJson<{ user: { id: string } }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cookie-user', password: 'cookie-password' }),
    });

    expect(login.response.status).toBe(200);
    expect(login.body.user.id).toBe(USER_ID);
    expect(login.response.headers.get('Set-Cookie')).toMatch(/flareboard_session=/);
    expect(login.response.headers.get('Set-Cookie')).toMatch(/HttpOnly/i);

    const cookie = cookieHeader(login.response);
    expect(cookie).toBeTruthy();

    const me = await fetchWorkerJson<{ username: string }>('/api/me', {
      headers: { Cookie: cookie },
    });
    expect(me.response.status).toBe(200);
    expect(me.body.username).toBe('cookie-user');
  });

  it('clears the session cookie on logout', async () => {
    const token = await createSecureToken({ userId: USER_ID, role: 'admin', tv: 0 }, env.APP_SECRET);
    const logout = await fetchWorkerJson('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(logout.response.status).toBe(200);
    expect(logout.response.headers.get('Set-Cookie')).toMatch(/Max-Age=0/i);

    const after = await fetchWorkerJson('/api/me', {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(after.response.status).toBe(401);
  });
});
