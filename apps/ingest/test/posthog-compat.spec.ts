import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { currentMonthKey, EVENT_TYPE, uuid } from '@flareboard/shared';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorkerWithEnv, recordingQueue, seedProjectKey } from './helpers/queue';
import { testSiteDb } from './helpers/site-db';

const KEY = `fb_pk_${'PostHogCompatKey'.padEnd(24, '0')}`;
const OTHER_SITE = '00000000-0000-0000-0000-0000000000b2';
const OTHER_KEY = `fb_pk_${'PostHogCompatOther'.padEnd(24, '0')}`;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

async function gzip(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function b64(text: string) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function post(path: string, body: BodyInit, headers: Record<string, string> = {}, overrides: Record<string, unknown> = {}) {
  const recorder = recordingQueue();
  const response = await fetchWorkerWithEnv(
    path,
    { method: 'POST', headers: { 'user-agent': 'posthog-node/4.2.0', 'cf-connecting-ip': '198.51.100.7', ...headers }, body },
    { EVENT_QUEUE: recorder.queue, ...overrides },
  );
  return { response, ...recorder };
}

function postJson(path: string, payload: unknown, headers: Record<string, string> = {}, overrides: Record<string, unknown> = {}) {
  return post(path, JSON.stringify(payload), { 'Content-Type': 'application/json', ...headers }, overrides);
}

function pageview(extra: Record<string, unknown> = {}) {
  return {
    event: '$pageview',
    uuid: crypto.randomUUID(),
    properties: {
      token: KEY,
      distinct_id: 'anon-device-1',
      $session_id: 'ph-session-1',
      $current_url: 'https://shop.example.com/pricing?utm_source=newsletter&gclid=abc#plans',
      $host: 'shop.example.com',
      $referrer: 'https://www.google.com/search?q=flareboard',
      $title: 'Pricing',
      $browser: 'Firefox',
      $os: 'Mac OS X',
      $device_type: 'Desktop',
      $screen_width: 1440,
      $screen_height: 900,
      $browser_language: 'en-GB',
      $lib: 'web',
      $ip: '203.0.113.9',
      $window_id: 'w1',
      ...extra,
    },
    timestamp: new Date().toISOString(),
  };
}

describe('PostHog-compatible capture', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, 'Other', 'other.example.com', '00000000-0000-0000-0000-000000000001', ?2, ?2)`,
    )
      .bind(OTHER_SITE, Date.now())
      .run();
    await seedProjectKey(env.DB, TEST_WEBSITE_ID, KEY);
    await seedProjectKey(env.DB, OTHER_SITE, OTHER_KEY);
  });

  it('maps a $pageview to a Flareboard pageview through the queue', async () => {
    const { response, events, sessions } = await postJson('/capture/', { api_key: KEY, ...pageview() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 1 });

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0]!.data).toMatchObject({
      id: uuid(TEST_WEBSITE_ID, 'anon-device-1'),
      websiteId: TEST_WEBSITE_ID,
      browser: 'Firefox',
      os: 'macOS',
      device: 'desktop',
      screen: '1440x900',
      language: 'en-GB',
      distinctId: 'anon-device-1',
      // A server SDK's request says nothing about where the visitor is.
      country: null,
    });

    expect(events()).toHaveLength(1);
    const [event] = events();
    expect(event!.data).toMatchObject({
      websiteId: TEST_WEBSITE_ID,
      eventType: EVENT_TYPE.pageView,
      eventName: null,
      urlPath: '/pricing#plans',
      urlQuery: 'utm_source=newsletter&gclid=abc',
      utmSource: 'newsletter',
      gclid: 'abc',
      referrerDomain: 'google.com',
      pageTitle: 'Pricing',
      hostname: 'shop.example.com',
    });
    const keys = (event!.eventData ?? []).map((row) => row.dataKey);
    expect(keys).toContain('$lib');
    for (const dropped of ['$ip', 'token', '$window_id', 'distinct_id', '$current_url', '$title']) {
      expect(keys).not.toContain(dropped);
    }
  });

  it('maps one PostHog session to one Flareboard visit, per distinct id and website', async () => {
    const first = await postJson('/e/', [pageview(), pageview({ $current_url: 'https://shop.example.com/cart' })]);
    const [a, b] = first.events();
    expect(a!.data.visitId).toBe(b!.data.visitId);
    expect(a!.data.sessionId).toBe(uuid(TEST_WEBSITE_ID, 'anon-device-1'));

    const nextSession = await postJson('/e/', [pageview({ $session_id: 'ph-session-2' })]);
    expect(nextSession.events()[0]!.data.sessionId).toBe(a!.data.sessionId);
    expect(nextSession.events()[0]!.data.visitId).not.toBe(a!.data.visitId);

    const otherSite = await postJson('/e/', [pageview({ token: OTHER_KEY })]);
    expect(otherSite.events()[0]!.data.websiteId).toBe(OTHER_SITE);
    expect(otherSite.events()[0]!.data.sessionId).not.toBe(a!.data.sessionId);
    expect(otherSite.events()[0]!.data.visitId).not.toBe(a!.data.visitId);
  });

  it('accepts every endpoint and body encoding', async () => {
    const batch = { api_key: KEY, batch: [pageview()], sent_at: new Date().toISOString() };
    const json = JSON.stringify(batch);
    const cases = [
      await postJson('/capture', batch),
      await postJson('/batch/', batch),
      await postJson('/track/', batch),
      await postJson('/i/v0/e/', batch),
      // posthog-js gzip: text/plain body, and newer versions drop ?compression.
      await post('/e/?compression=gzip-js&ver=1.200.0', await gzip(json), { 'Content-Type': 'text/plain' }),
      await post('/e/', await gzip(json), { 'Content-Type': 'text/plain' }),
      // posthog-node / posthog-python gzip.
      await post('/batch/', await gzip(json), { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }),
      // posthog-js base64 form bodies (legacy mode and sendBeacon).
      await post('/e/?compression=base64', `data=${encodeURIComponent(b64(json))}`, {
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      await post('/i/v0/e/', `data=${encodeURIComponent(b64(JSON.stringify([pageview()])))}`, {
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
    ];
    for (const { response, events } of cases) {
      expect(response.status).toBe(200);
      expect(events()).toHaveLength(1);
      expect(events()[0]!.data.eventType).toBe(EVENT_TYPE.pageView);
    }
  });

  it('maps custom events, $autocapture and $pageleave to custom events with their properties', async () => {
    const { events } = await postJson('/batch/', {
      api_key: KEY,
      batch: [
        { event: 'subscription_renewed', distinct_id: 'user-42', properties: { plan: 'pro', seats: 5, annual: true, nested: { a: 1 } } },
        {
          event: '$autocapture',
          distinct_id: 'user-42',
          properties: { $event_type: 'click', $el_text: 'Buy now', $elements_chain: 'button.buy:text="Buy now"' },
        },
        { event: '$pageleave', distinct_id: 'user-42', properties: { $prev_pageview_duration: 12.5 } },
      ],
    });
    expect(events().map((e) => [e.data.eventType, e.data.eventName])).toEqual([
      [EVENT_TYPE.customEvent, 'subscription_renewed'],
      [EVENT_TYPE.customEvent, '$autocapture'],
      [EVENT_TYPE.customEvent, '$pageleave'],
    ]);
    const data = (i: number) =>
      Object.fromEntries((events()[i]!.eventData ?? []).map((row) => [row.dataKey, row.stringValue ?? row.numberValue]));
    expect(data(0)).toEqual({ plan: 'pro', seats: 5, annual: 'true' });
    expect(data(1)).toMatchObject({ $event_type: 'click', $el_text: 'Buy now' });
    expect(data(2)).toEqual({ $prev_pageview_duration: 12.5 });
    // Server-side events have no page.
    expect(events()[0]!.data).toMatchObject({ urlPath: '', hostname: null, referrerDomain: null });
  });

  it('maps $exception to a Flareboard error event', async () => {
    const { events } = await postJson('/i/v0/e/', {
      api_key: KEY,
      batch: [
        {
          event: '$exception',
          distinct_id: 'user-42',
          properties: {
            $current_url: 'https://shop.example.com/checkout',
            checkoutStep: 'payment',
            $exception_list: [
              {
                type: 'TypeError',
                value: "Cannot read properties of undefined (reading 'total')",
                mechanism: { handled: false },
                stacktrace: { frames: [{ filename: 'https://shop.example.com/app.js', function: 'pay', lineno: 10, colno: 4 }] },
              },
            ],
          },
        },
      ],
    });
    const [event] = events();
    expect(event!.data).toMatchObject({
      eventType: EVENT_TYPE.error,
      eventName: "Cannot read properties of undefined (reading 'total')",
      urlPath: '/checkout',
    });
    const data = Object.fromEntries((event!.eventData ?? []).map((row) => [row.dataKey, row.stringValue ?? row.numberValue]));
    expect(data).toMatchObject({
      name: 'TypeError',
      message: "Cannot read properties of undefined (reading 'total')",
      source: 'https://shop.example.com/app.js',
      lineno: 10,
      colno: 4,
      severity: 'error',
      handled: 'false',
      checkoutStep: 'payment',
    });
    expect(String(data.stack)).toContain('at pay (https://shop.example.com/app.js:10:4)');
  });

  it('applies $identify through the identify path: $set, $set_once and the anonymous alias', async () => {
    await testSiteDb(TEST_WEBSITE_ID).prepare(
      `INSERT OR REPLACE INTO person (person_id, website_id, distinct_id, properties_json, first_seen_at, last_seen_at, created_at, updated_at)
       VALUES ('ph-person-1', ?1, 'ph-user-1', '{"plan":"free","signup_source":"ads"}', 1, 1, 1, 1)`,
    )
      .bind(TEST_WEBSITE_ID)
      .run();
    const { response, events, sessionData } = await postJson('/e/', [
      {
        event: '$identify',
        properties: {
          token: KEY,
          distinct_id: 'ph-user-1',
          $anon_distinct_id: 'ph-anon-1',
          $set: { plan: 'pro', email: 'ada@example.com' },
          $set_once: { signup_source: 'newsletter', first_plan: 'pro' },
        },
      },
    ]);
    expect(response.status).toBe(200);
    // Identity calls update people, not the event stream.
    expect(events()).toHaveLength(0);
    const rows = sessionData().flatMap((m) => m.data);
    expect(rows.map((row) => [row.dataKey, row.stringValue])).toEqual([
      ['plan', 'pro'],
      ['email', 'ada@example.com'],
    ]);
    expect(rows[0]!.sessionId).toBe(uuid(TEST_WEBSITE_ID, 'ph-user-1'));

    const person = await testSiteDb(TEST_WEBSITE_ID).prepare(`SELECT properties_json AS p FROM person WHERE website_id = ?1 AND distinct_id = 'ph-user-1'`)
      .bind(TEST_WEBSITE_ID)
      .first<{ p: string }>();
    expect(JSON.parse(person!.p)).toEqual({
      plan: 'pro',
      email: 'ada@example.com',
      // $set_once never overwrites.
      signup_source: 'ads',
      first_plan: 'pro',
      $alias: 'ph-anon-1',
    });
    const anon = await testSiteDb(TEST_WEBSITE_ID).prepare(`SELECT properties_json AS p FROM person WHERE website_id = ?1 AND distinct_id = 'ph-anon-1'`)
      .bind(TEST_WEBSITE_ID)
      .first<{ p: string }>();
    expect(JSON.parse(anon!.p)).toMatchObject({ $canonical_distinct_id: 'ph-user-1' });
  });

  it('applies $set on any event, $create_alias and $groupidentify', async () => {
    const { events, sessionData } = await postJson('/batch/', {
      api_key: KEY,
      batch: [
        { event: 'checkout', distinct_id: 'ph-user-2', properties: { $set: { tier: 'gold' }, $groups: { company: 'acme' } } },
        { event: '$create_alias', distinct_id: 'ph-user-2', properties: { alias: 'legacy-7' } },
        {
          event: '$groupidentify',
          distinct_id: 'ph-user-2',
          properties: { $group_type: 'company', $group_key: 'acme', $group_set: { name: 'Acme Inc', employees: 40 } },
        },
        // posthog-node's synthetic group distinct id does not become a person.
        { event: '$groupidentify', distinct_id: '$company_globex', properties: { $group_type: 'company', $group_key: 'globex' } },
      ],
    });
    expect(events().map((e) => e.data.eventName)).toEqual(['checkout']);
    const rows = sessionData().flatMap((m) => m.data.map((row) => [row.dataKey, row.stringValue ?? row.numberValue]));
    expect(rows).toEqual(
      expect.arrayContaining([
        ['$group/company', 'acme'],
        ['$group/company/name', 'Acme Inc'],
        ['$group/company/employees', 40],
        ['$group/company', 'globex'],
      ]),
    );

    const people = await testSiteDb(TEST_WEBSITE_ID).prepare(
      `SELECT distinct_id AS id, properties_json AS p FROM person WHERE website_id = ?1 AND distinct_id IN ('ph-user-2', 'legacy-7', '$company_globex')`,
    )
      .bind(TEST_WEBSITE_ID)
      .all<{ id: string; p: string }>();
    const byId = Object.fromEntries((people.results ?? []).map((row) => [row.id, JSON.parse(row.p)]));
    expect(byId['ph-user-2']).toMatchObject({ tier: 'gold', $alias: 'legacy-7' });
    expect(byId['legacy-7']).toMatchObject({ $canonical_distinct_id: 'ph-user-2' });
    expect(byId['$company_globex']).toBeUndefined();

    const membership = await testSiteDb(TEST_WEBSITE_ID).prepare(
      `SELECT m.group_key AS k FROM person_group_membership m JOIN person p ON p.person_id = m.person_id
       WHERE p.website_id = ?1 AND p.distinct_id = 'ph-user-2' AND m.group_type = 'company'`,
    )
      .bind(TEST_WEBSITE_ID)
      .first<{ k: string }>();
    expect(membership?.k).toBe('acme');
  });

  it('skips person processing when posthog-js says so', async () => {
    const { sessions } = await postJson('/e/', [
      pageview({ distinct_id: 'ph-anon-noprofile', $process_person_profile: false, $set: { a: 1 } }),
    ]);
    expect(sessions()[0]!.data.distinctId).toBeNull();
    const person = await testSiteDb(TEST_WEBSITE_ID).prepare(`SELECT 1 FROM person WHERE website_id = ?1 AND distinct_id = 'ph-anon-noprofile'`)
      .bind(TEST_WEBSITE_ID)
      .first();
    expect(person).toBeNull();
  });

  it('corrects timestamps for clock skew and honors offset', async () => {
    const skew = 2 * 60 * 60 * 1000;
    const before = Date.now();
    const { events } = await postJson('/batch/', {
      api_key: KEY,
      sent_at: new Date(before + skew).toISOString(),
      batch: [
        { event: 'skewed', distinct_id: 'ph-time', timestamp: new Date(before + skew - 30_000).toISOString() },
        { event: 'offset', distinct_id: 'ph-time', offset: 60_000 },
        { event: 'ancient', distinct_id: 'ph-time', timestamp: '2001-01-01T00:00:00Z', properties: { $ignore_sent_at: true } },
      ],
    });
    const after = Date.now();
    const [skewed, offset, ancient] = events().map((e) => e.data.createdAt);
    expect(skewed).toBeGreaterThanOrEqual(before - 30_000);
    expect(skewed).toBeLessThanOrEqual(after - 30_000);
    expect(offset).toBeGreaterThanOrEqual(before - 60_000);
    expect(offset).toBeLessThanOrEqual(after - 60_000);
    // Outside the accepted window: server time.
    expect(ancient).toBeGreaterThanOrEqual(before);
  });

  it('derives stable event ids from PostHog uuids so retries do not duplicate', async () => {
    const event = pageview();
    const first = await postJson('/e/', [event]);
    const retry = await postJson('/e/', [event]);
    expect(first.events()[0]!.data.id).toBe(uuid(TEST_WEBSITE_ID, '$posthog', event.uuid));
    expect(retry.events()[0]!.data.id).toBe(first.events()[0]!.data.id);
  });

  it('drops crawlers, recordings and events for another project', async () => {
    const crawler = await postJson('/e/', [pageview()], {
      'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    });
    expect(crawler.response.status).toBe(200);
    expect(crawler.messages).toHaveLength(0);

    const mixed = await postJson('/batch/', {
      api_key: KEY,
      batch: [
        { event: '$snapshot', distinct_id: 'u', properties: { $snapshot_data: [] } },
        { event: 'intruder', distinct_id: 'u', properties: { token: OTHER_KEY } },
        { event: 'kept', distinct_id: 'u', properties: { $raw_user_agent: BROWSER_UA } },
        { event: 'bot', distinct_id: 'u', properties: { $raw_user_agent: 'Googlebot/2.1 (+http://www.google.com/bot.html)' } },
      ],
    });
    expect(mixed.events().map((e) => e.data.eventName)).toEqual(['kept']);
  });

  it('rejects bad keys and bad payloads', async () => {
    expect((await postJson('/capture/', { ...pageview(), properties: { distinct_id: 'u' } })).response.status).toBe(401);
    expect((await postJson('/capture/', { api_key: 'fb_pk_000000000000000000000000', ...pageview() })).response.status).toBe(401);
    expect((await postJson('/capture/', { api_key: 'phc_not_ours', event: 'x', distinct_id: 'u' })).response.status).toBe(401);
    const noDistinct = await postJson('/capture/', { api_key: KEY, event: 'x' });
    expect(noDistinct.response.status).toBe(400);
    expect((await postJson('/batch/', { api_key: KEY, batch: [] })).response.status).toBe(400);
    expect((await post('/e/', '{not json', { 'Content-Type': 'application/json' })).response.status).toBe(400);
    expect((await post('/e/?compression=lz64', 'data=xyz', { 'Content-Type': 'application/x-www-form-urlencoded' })).response.status).toBe(400);
    expect((await post('/e/', new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0]), { 'Content-Type': 'text/plain' })).response.status).toBe(400);
  });

  it('enforces the hosted event quota', async () => {
    await env.CACHE.put(`usage:00000000-0000-0000-0000-000000000001:${currentMonthKey()}`, String(1e12));
    const { response, messages } = await postJson('/e/', [pageview()], {}, { HOSTED_MODE: 'true' });
    expect(response.status).toBe(402);
    expect(messages).toHaveLength(0);
    await env.CACHE.delete(`usage:00000000-0000-0000-0000-000000000001:${currentMonthKey()}`);
  });
});

describe('PostHog-compatible flags', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await seedProjectKey(env.DB, TEST_WEBSITE_ID, KEY);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO feature_flag (flag_id, website_id, key, name, description, enabled, rollout, variants, targeting_rules, created_at, updated_at) VALUES
         ('ph-flag-bool', ?1, 'ph-new-nav', 'Nav', '', 1, 100, NULL, NULL, ?2, ?2),
         ('ph-flag-multi', ?1, 'ph-checkout', 'Checkout', '', 1, 100, ?3, NULL, ?2, ?2),
         ('ph-flag-targeted', ?1, 'ph-pro-only', 'Pro', '', 1, 100, NULL, ?4, ?2, ?2),
         ('ph-flag-off', ?1, 'ph-disabled', 'Off', '', 0, 100, NULL, NULL, ?2, ?2)`,
    )
      .bind(
        TEST_WEBSITE_ID,
        now,
        JSON.stringify([{ key: 'blue', weight: 100 }]),
        JSON.stringify([{ field: 'property', key: 'plan', operator: 'equals', value: 'pro' }]),
      )
      .run();
  });

  type FlagsBody = {
    featureFlags: Record<string, string | boolean>;
    featureFlagPayloads: Record<string, unknown>;
    flags: Record<string, { enabled: boolean; variant?: string; reason: { code: string } }>;
    errorsWhileComputingFlags: boolean;
    supportedCompression: string[];
    sessionRecording: boolean;
  };

  it('evaluates flags for /decide and /flags in the shapes posthog-js and server SDKs read', async () => {
    for (const path of ['/decide/?v=3', '/flags/?v=2', '/decide', '/flags']) {
      const { response } = await postJson(path, {
        token: KEY,
        distinct_id: 'ph-flag-user',
        person_properties: { plan: 'pro' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as FlagsBody;
      expect(body.featureFlags).toEqual({ 'ph-new-nav': true, 'ph-checkout': 'blue', 'ph-pro-only': true });
      expect(body.featureFlagPayloads).toEqual({});
      expect(body.flags['ph-checkout']).toMatchObject({ enabled: true, variant: 'blue', reason: { code: 'condition_match' } });
      expect(body.flags['ph-new-nav']).not.toHaveProperty('variant');
      expect(body).toMatchObject({ errorsWhileComputingFlags: false, sessionRecording: false });
      expect(body.supportedCompression).toContain('gzip-js');
    }
  });

  it('accepts posthog-js base64 form bodies and honors targeting and requested keys', async () => {
    const payload = { token: KEY, distinct_id: 'ph-flag-user', person_properties: { plan: 'free' }, flag_keys_to_evaluate: ['ph-pro-only'] };
    const { response } = await post('/flags/?v=2', `data=${encodeURIComponent(b64(JSON.stringify(payload)))}`, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const body = (await response.json()) as FlagsBody;
    expect(body.featureFlags).toEqual({ 'ph-pro-only': false });
    expect(body.flags['ph-pro-only']!.reason.code).toBe('no_condition_match');
  });

  it('rejects unknown keys and serves the remote config', async () => {
    expect((await postJson('/decide/', { token: 'fb_pk_000000000000000000000000', distinct_id: 'u' })).response.status).toBe(401);

    const config = await fetchWorkerWithEnv(`/array/${KEY}/config`, undefined, {});
    expect(config.status).toBe(200);
    expect(await config.json()).toMatchObject({ token: KEY, hasFeatureFlags: true, surveys: false });
    const script = await fetchWorkerWithEnv(`/array/${KEY}/config.js`, undefined, {});
    expect(await script.text()).toContain(`_POSTHOG_REMOTE_CONFIG["${KEY}"]`);
    expect((await fetchWorkerWithEnv('/array/fb_pk_000000000000000000000000/config', undefined, {})).status).toBe(404);
  });
});
