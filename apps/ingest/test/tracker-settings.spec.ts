import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorkerJson } from './helpers/fetch-worker';
import { forgetTrackerSettings, trackerSettingsKey } from '../src/lib/tracker-settings';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

async function setSettings(values: { autocapture?: number; persist?: number; dnt?: number }) {
  await env.DB.prepare(
    `UPDATE website SET autocapture = COALESCE(?2, autocapture), persist_visitors = COALESCE(?3, persist_visitors),
            respect_dnt = COALESCE(?4, respect_dnt) WHERE website_id = ?1`,
  )
    .bind(TEST_WEBSITE_ID, values.autocapture ?? null, values.persist ?? null, values.dnt ?? null)
    .run();
  await env.CACHE.delete(`tracker-config:${TEST_WEBSITE_ID}`);
  await env.CACHE.delete(trackerSettingsKey(TEST_WEBSITE_ID));
  forgetTrackerSettings(TEST_WEBSITE_ID);
}

function send(payload: Record<string, unknown>, ip: string) {
  return fetchWorkerJson<{ cache?: string; sessionId?: string }>('/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': UA, 'cf-connecting-ip': ip },
    body: JSON.stringify({ type: 'event', payload: { website: TEST_WEBSITE_ID, hostname: 'example.com', url: '/', ...payload } }),
  });
}

describe('tracker settings', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  beforeEach(async () => {
    await setSettings({ autocapture: 1, persist: 0, dnt: 0 });
  });

  it('tracker-config exposes the defaults for a new website: autocapture on, cookieless, DNT not honored', async () => {
    const { body } = await fetchWorkerJson<Record<string, unknown>>(`/api/tracker-config?website=${TEST_WEBSITE_ID}`);
    expect(body).toMatchObject({ websiteId: TEST_WEBSITE_ID, autocapture: true, persistence: false, respectDnt: false });
  });

  it('tracker-config reflects the website settings', async () => {
    await setSettings({ autocapture: 0, persist: 1, dnt: 1 });
    const { body } = await fetchWorkerJson<Record<string, unknown>>(`/api/tracker-config?website=${TEST_WEBSITE_ID}`);
    expect(body).toMatchObject({ autocapture: false, persistence: true, respectDnt: true });
  });

  it('ignores an anonymous id when the website does not remember visitors', async () => {
    const cookieless = await send({}, '192.0.2.10');
    const withAnon = await send({ id: 'anon-1', anonymousId: 'anon-1' }, '192.0.2.10');
    expect(withAnon.body.sessionId).toBe(cookieless.body.sessionId);

    const onlyAnon = await send({ anonymousId: 'anon-1' }, '192.0.2.10');
    expect(onlyAnon.body.sessionId).toBe(cookieless.body.sessionId);
  });

  it('counts the visitor by the anonymous id across networks when persistence is on', async () => {
    await setSettings({ persist: 1 });
    const home = await send({ id: 'anon-2', anonymousId: 'anon-2' }, '192.0.2.20');
    const mobile = await send({ id: 'anon-2', anonymousId: 'anon-2' }, '198.51.100.7');
    const cookieless = await send({}, '192.0.2.20');
    expect(home.body.sessionId).toBe(mobile.body.sessionId);
    expect(home.body.sessionId).not.toBe(cookieless.body.sessionId);

    const other = await send({ id: 'anon-3', anonymousId: 'anon-3' }, '192.0.2.20');
    expect(other.body.sessionId).not.toBe(home.body.sessionId);
  });

  it('leaves identified ids unchanged whatever the persistence setting', async () => {
    const off = await send({ id: 'user-5', anonymousId: 'anon-5' }, '192.0.2.30');
    await setSettings({ persist: 1 });
    const on = await send({ id: 'user-5' }, '198.51.100.30');
    expect(off.body.sessionId).toBe(on.body.sessionId);
  });
});
