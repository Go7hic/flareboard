import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, ROLES } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const OWNER_ID = 'link-stats-owner';
const LINK_ID = 'link-stats-link';
const NOW = Date.now();

describe('link stats', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
       VALUES (?1, 'link-stats-owner', 'hash', ?2, ?3, ?3)`,
    )
      .bind(OWNER_ID, ROLES.user, NOW)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO link (link_id, name, url, slug, user_id, created_at, updated_at)
       VALUES (?1, 'Docs', 'https://example.com/docs', 'link-stats-docs', ?2, ?3, ?3)`,
    )
      .bind(LINK_ID, OWNER_ID, NOW)
      .run();
    const hits = [
      ['h1', 'visitor-a', NOW - 3_600_000],
      ['h2', 'visitor-a', NOW - 1_800_000],
      ['h3', 'visitor-b', NOW - 60_000],
    ] as const;
    for (const [hitId, visitorId, createdAt] of hits) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO link_pixel_hit (hit_id, source_type, source_id, visitor_id, created_at)
         VALUES (?1, 'link', ?2, ?3, ?4)`,
      )
        .bind(`link-stats-${hitId}`, LINK_ID, visitorId, createdAt)
        .run();
    }
  });

  it('counts clicks and unique visitors from recorded hits', async () => {
    const token = await createSecureToken({ userId: OWNER_ID, role: ROLES.user }, env.APP_SECRET);
    const { response, body } = await fetchWorkerJson<{ clicks: number; visitors: number; series: unknown[] }>(
      `/api/links/${LINK_ID}/stats`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(200);
    expect(body.clicks).toBe(3);
    expect(body.visitors).toBe(2);
    expect(body.series.length).toBeGreaterThan(0);
  });
});
