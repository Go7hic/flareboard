import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { decodeMappings, migrateInlineSourceMapsToR2, resolveErrorStack } from '../../src/lib/source-maps';
import { fetchWorker, fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

async function bearer() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return `Bearer ${token}`;
}

function vlq(value: number) {
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += B64[digit];
  } while (v > 0);
  return out;
}

/** Encodes absolute [genColumn, source, line, column, name?] segments per generated line. */
function encodeMappings(lines: number[][][]) {
  const previous = [0, 0, 0, 0];
  return lines
    .map((segments) => {
      let column = 0;
      return segments
        .map((segment) => {
          const fields = [segment[0]! - column];
          column = segment[0]!;
          for (let i = 1; i < segment.length; i++) {
            fields.push(segment[i]! - previous[i - 1]!);
            previous[i - 1] = segment[i]!;
          }
          return fields.map(vlq).join('');
        })
        .join(',');
    })
    .join(';');
}

const CART_SOURCE = [
  "import { price } from './price';", // 1
  '', // 2
  'export function lineTotal(item) {', // 3
  '  return item.qty * price(item);', // 4
  '}', // 5
  'export function renderCart(cart) {', // 6
  '  return cart.items.map(lineTotal);', // 7
  '}', // 8
  'renderCart(window.cart);', // 9
].join('\n');

// Generated line 1 carries name indexes (5-field segments), which the old decoder misread.
const MAP = {
  version: 3,
  file: 'cart-C3sPvF1q.js',
  sourceRoot: '',
  sources: ['../../src/cart.ts'],
  sourcesContent: [CART_SOURCE],
  names: ['lineTotal', 'renderCart'],
  mappings: encodeMappings([
    [
      [0, 0, 0, 0],
      [10, 0, 3, 9, 0],
      [20, 0, 6, 9, 1],
    ],
    [[0, 0, 8, 0]],
  ]),
};

describe('source maps in R2', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('decodes mappings that include name indexes', () => {
    const lines = decodeMappings(MAP.mappings, new Set([0, 1]));
    expect(lines.get(0)).toEqual([
      [0, 0, 0, 0],
      [10, 0, 3, 9],
      [20, 0, 6, 9],
    ]);
    expect(lines.get(1)).toEqual([[0, 0, 8, 0]]);
  });

  it('accepts multipart uploads from CI, stores content in R2 and resolves frames with source context', async () => {
    const form = new FormData();
    form.set('release', '7.0.0');
    form.append('file', new File([JSON.stringify(MAP)], 'assets/cart-C3sPvF1q.js.map', { type: 'application/json' }));
    form.append('file', new File([JSON.stringify({ ...MAP, sourcesContent: undefined })], 'assets/other.js.map'));
    const upload = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/errors/source-maps`, {
      method: 'POST',
      headers: { Authorization: await bearer() },
      body: form,
    });
    expect(upload.status).toBe(201);
    const body = (await upload.json()) as { release: string; sourceMaps: Array<{ id: string; file: string }> };
    expect(body.sourceMaps.map((row) => row.file)).toEqual(['assets/cart-C3sPvF1q.js.map', 'assets/other.js.map']);

    const row = await env.DB.prepare(`SELECT content, object_key AS objectKey FROM error_source_map WHERE source_map_id = ?1`)
      .bind(body.sourceMaps[0]!.id)
      .first<{ content: string; objectKey: string }>();
    expect(row).toEqual({ content: '', objectKey: `sourcemaps/${TEST_WEBSITE_ID}/${body.sourceMaps[0]!.id}.map` });
    expect(JSON.parse(await (await env.REPLAY_BUCKET!.get(row!.objectKey))!.text())).toMatchObject({ version: 3 });

    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'qty')",
      '    at t (https://shop.example.com/assets/cart-C3sPvF1q.js?v=1:1:15)',
      '    at Array.map (<anonymous>)',
      '    at n (https://shop.example.com/assets/cart-C3sPvF1q.js:1:23)',
      '    at https://cdn.example.net/vendor.js:1:1',
    ].join('\n');
    const frames = await resolveErrorStack(env, TEST_WEBSITE_ID, '7.0.0', stack);
    expect(frames.map((frame) => [frame.source, frame.sourceLine, frame.sourceColumn, frame.resolved, frame.inApp])).toEqual([
      ['src/cart.ts', 4, 10, true, true],
      ['src/cart.ts', 7, 10, true, true],
      [null, null, null, false, false],
    ]);
    expect(frames[0]!.context).toEqual({
      startLine: 1,
      lines: CART_SOURCE.split('\n').slice(0, 9),
    });

    // Firefox / Safari frames resolve the same way.
    const firefox = await resolveErrorStack(env, TEST_WEBSITE_ID, '7.0.0', 'n@https://shop.example.com/assets/cart-C3sPvF1q.js:2:1');
    expect(firefox[0]).toMatchObject({ source: 'src/cart.ts', sourceLine: 9, resolved: true });

    // No release on the event: a content-hashed file name is unambiguous, a plain one is not.
    const hashed = await resolveErrorStack(env, TEST_WEBSITE_ID, null, '    at t (https://shop.example.com/assets/cart-C3sPvF1q.js:1:15)');
    expect(hashed[0]).toMatchObject({ resolved: true, sourceLine: 4 });
    const plain = await resolveErrorStack(env, TEST_WEBSITE_ID, null, '    at t (https://shop.example.com/assets/other.js:1:15)');
    expect(plain[0]).toMatchObject({ resolved: false });
    // Wrong release: nothing to resolve with.
    const other = await resolveErrorStack(env, TEST_WEBSITE_ID, '6.9.9', '    at t (https://shop.example.com/assets/cart-C3sPvF1q.js:1:15)');
    expect(other[0]).toMatchObject({ resolved: false });

    // Re-uploading the same release + file replaces the object in place.
    const again = await fetchWorkerJson<{ id: string }>(`/api/websites/${TEST_WEBSITE_ID}/errors/source-maps`, {
      method: 'POST',
      headers: { Authorization: await bearer(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ release: '7.0.0', file: '/assets/cart-C3sPvF1q.js.map', content: JSON.stringify(MAP) }),
    });
    expect(again.response.status).toBe(201);
    expect(again.body.id).toBe(body.sourceMaps[0]!.id);

    // Deleting removes the row and the R2 object.
    const deleted = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/errors/source-maps/${body.sourceMaps[0]!.id}`, {
      method: 'DELETE',
      headers: { Authorization: await bearer() },
    });
    expect(deleted.status).toBe(200);
    expect(await env.REPLAY_BUCKET!.get(row!.objectKey)).toBeNull();
    expect(
      await env.DB.prepare(`SELECT 1 FROM error_source_map WHERE source_map_id = ?1`).bind(body.sourceMaps[0]!.id).first(),
    ).toBeNull();
  });

  it('rejects content that is not a v3 source map', async () => {
    for (const content of ['not json', JSON.stringify({ version: 2, mappings: '' }), JSON.stringify({ version: 3, sections: [] })]) {
      const response = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/errors/source-maps`, {
        method: 'POST',
        headers: { Authorization: await bearer(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ release: '7.0.1', file: 'app.js.map', content }),
      });
      expect(response.status, content).toBe(400);
    }
    const noRelease = new FormData();
    noRelease.append('file', new File(['{}'], 'app.js.map'));
    const response = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/errors/source-maps`, {
      method: 'POST',
      headers: { Authorization: await bearer() },
      body: noRelease,
    });
    expect(response.status).toBe(400);
  });

  it('moves maps stored inline in D1 to R2 and keeps resolving them', async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO error_source_map (source_map_id, website_id, release, file, content, size, created_at, updated_at)
       VALUES (?1, ?2, '8.0.0', 'assets/legacy.js.map', ?3, 100, 1, 1)`,
    )
      .bind(id, TEST_WEBSITE_ID, JSON.stringify(MAP))
      .run();
    const stack = '    at t (https://shop.example.com/assets/legacy.js:1:15)';
    expect((await resolveErrorStack(env, TEST_WEBSITE_ID, '8.0.0', stack))[0]).toMatchObject({ resolved: true, sourceLine: 4 });

    expect(await migrateInlineSourceMapsToR2(env)).toEqual({ moved: 1 });
    expect(await migrateInlineSourceMapsToR2(env)).toEqual({ moved: 0 });
    const row = await env.DB.prepare(`SELECT content, object_key AS objectKey FROM error_source_map WHERE source_map_id = ?1`)
      .bind(id)
      .first<{ content: string; objectKey: string }>();
    expect(row).toEqual({ content: '', objectKey: `sourcemaps/${TEST_WEBSITE_ID}/${id}.map` });
    expect((await resolveErrorStack(env, TEST_WEBSITE_ID, '8.0.0', stack))[0]).toMatchObject({ resolved: true, sourceLine: 4 });
  });
});
