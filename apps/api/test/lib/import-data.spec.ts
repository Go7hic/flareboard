import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { importCsv } from '../../src/lib/import-data';

describe('importCsv', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('returns an error for empty CSV', async () => {
    const result = await importCsv(env, TEST_WEBSITE_ID, 'flareboard', '');
    expect(result.imported).toBe(0);
    expect(result.errors).toContain('Empty CSV');
  });

  it('imports flareboard CSV rows', async () => {
    const csv = [
      'timestamp,url_path,session_id,event_name',
      '2024-06-01T12:00:00Z,/home,session-1,',
      '2024-06-01T12:05:00Z,/pricing,session-1,cta_click',
    ].join('\n');

    const result = await importCsv(env, TEST_WEBSITE_ID, 'flareboard', csv);
    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.batches).toBeGreaterThan(0);
  });

  it('reports missing columns for GA4 CSV', async () => {
    const csv = 'views,screen page views\n10,20\n';
    const result = await importCsv(env, TEST_WEBSITE_ID, 'ga4', csv);
    expect(result.imported).toBe(0);
    expect(result.errors[0]).toMatch(/GA4 CSV must include Date and Page path columns/);
  });

  it('expands GA4 daily views into pageview rows', async () => {
    const csv = [
      'Date,Page path,Views',
      '20240601,/docs,2',
    ].join('\n');

    const result = await importCsv(env, TEST_WEBSITE_ID, 'ga4', csv);
    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(2);
  });
});
