import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getErrorEvent } from '../../src/lib/errors';
import { resolveErrorStack } from '../../src/lib/source-maps';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 25, 12);

describe('source map resolution', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('maps generated stack frames back to original sources', async () => {
    const map = {
      version: 3,
      file: 'app.js',
      sources: ['src/app.ts'],
      names: [],
      mappings: 'AAAA',
    };

    await env.DB.prepare(
      `INSERT INTO error_source_map (source_map_id, website_id, release, file, content, size, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
      .bind(crypto.randomUUID(), TEST_WEBSITE_ID, '1.0.0', 'assets/app.js.map', JSON.stringify(map), 64, BASE)
      .run();

    const stack = [
      'Error: boom',
      '    at main (https://cdn.example.com/assets/app.js:1:0)',
    ].join('\n');

    const frames = await resolveErrorStack(env, TEST_WEBSITE_ID, '1.0.0', stack);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(
      expect.objectContaining({
        file: 'assets/app.js',
        source: 'src/app.ts',
        resolved: true,
      }),
    );
  });

  it('returns resolvedStack on error event detail', async () => {
    const eventId = '00000000-0000-0000-0000-00000000e301';
    const sessionId = 'source-map-session';
    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, distinct_id, browser, country, created_at)
       VALUES (?1, ?2, ?3, 'Chrome', 'US', ?4)`,
    )
      .bind(sessionId, TEST_WEBSITE_ID, 'user-source-map', BASE)
      .run();

    await env.DB.prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES (?1, ?2, ?3, ?3, ?4, '/checkout', ?5, 'error')`,
    )
      .bind(eventId, TEST_WEBSITE_ID, sessionId, BASE, EVENT_TYPE.error)
      .run();

    const stack = 'Error: fail\n    at checkout (https://cdn.example.com/assets/app.js:1:0)';
    for (const [suffix, key, value] of [
      ['stack', 'stack', stack],
      ['release', 'release', '1.0.0'],
      ['message', 'message', 'fail'],
      ['name', 'name', 'Error'],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)`,
      )
        .bind(`${eventId}-${suffix}`, TEST_WEBSITE_ID, eventId, key, value, BASE)
        .run();
    }

    const event = await getErrorEvent(env, TEST_WEBSITE_ID, eventId);
    expect(event?.resolvedStack).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'src/app.ts',
          resolved: true,
        }),
      ]),
    );
  });
});
