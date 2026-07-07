import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

describe('error source map routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('uploads and lists source maps by release', async () => {
    const upload = await fetchWorkerJson<{
      release: string;
      file: string;
      size: number;
    }>(`/api/websites/${TEST_WEBSITE_ID}/errors/source-maps`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        release: '4.0.0',
        file: 'assets/app.js.map',
        content: JSON.stringify({
          version: 3,
          file: 'app.js',
          sources: ['src/app.ts'],
          mappings: '',
        }),
      }),
    });

    expect(upload.response.status).toBe(201);
    expect(upload.body).toMatchObject({
      release: '4.0.0',
      file: 'assets/app.js.map',
      size: expect.any(Number),
    });

    const list = await fetchWorkerJson<{
      sourceMaps: Array<{ release: string; file: string; size: number }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/errors/source-maps?release=4.0.0`, {
      headers: await authHeader(),
    });

    expect(list.response.status).toBe(200);
    expect(list.body.sourceMaps).toEqual([
      expect.objectContaining({
        release: '4.0.0',
        file: 'assets/app.js.map',
        size: upload.body.size,
      }),
    ]);
  });
});
