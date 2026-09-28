import { describe, expect, it } from 'vitest';
import { FakeStorage, WEBSITE_ID, createBrowser, defaultConfig, type TrackerApi } from './helpers/fake-browser';

async function loaded(options: Parameters<typeof createBrowser>[0] = {}) {
  const b = createBrowser({ config: defaultConfig(), ...options });
  const api = b.run();
  await b.flush();
  return { b, api: (b.window.flareboard as TrackerApi) ?? api };
}

describe('backward compatibility', () => {
  it('sends a pageview on load and exposes the existing API', async () => {
    const { b, api } = await loaded({ config: defaultConfig({ autocapture: false }) });
    expect(b.pageviews()).toHaveLength(1);
    expect(b.pageviews()[0]?.payload).toMatchObject({ website: WEBSITE_ID, url: '/pricing', hostname: 'shop.example.test' });
    for (const method of ['track', 'identify', 'alias', 'group', 'reset', 'revenue', 'log', 'ai', 'captureException', 'page', 'getDistinctId', 'getSessionId', 'getVisitId', 'getFeatureFlag', 'getFeatureFlagVariant', 'isFeatureEnabled', 'featureFlagsReady', 'showSurvey']) {
      expect(typeof (api as unknown as Record<string, unknown>)[method]).toBe('function');
    }
    expect(b.window.Flareboard).toBe(api);
  });

  it('keeps sending after reset() (the next event used to be swallowed)', async () => {
    const { b, api } = await loaded();
    api.track('before');
    await b.flush();
    api.reset();
    api.track('after');
    await b.flush();
    expect(b.names()).toContain('after');
  });
});

describe('$pageleave', () => {
  it('beacons time on page and max scroll depth on pagehide, once', async () => {
    const { b } = await loaded({ documentHeight: 4000, viewportHeight: 1000 });
    b.scrollTo(1000);
    b.pagehide();
    b.pagehide();
    const leaves = b.events('$pageleave');
    expect(leaves).toHaveLength(1);
    expect(leaves[0]?.via).toBe('beacon');
    expect(leaves[0]?.payload).toMatchObject({ url: '/pricing', title: 'Pricing' });
    expect(leaves[0]?.payload.data).toMatchObject({ $time_on_page: expect.any(Number), $max_scroll_depth: 50 });
    // The cache token rides in the body so the beacon joins the tab's session.
    expect(leaves[0]?.cache).toBe('cache-1');
  });

  it('does not count hidden time', async () => {
    const { b } = await loaded();
    b.setVisibility('hidden');
    await new Promise((r) => setTimeout(r, 1100));
    b.pagehide();
    expect(b.events('$pageleave')[0]?.payload.data?.$time_on_page).toBe(0);
  });

  it('is sent for the previous route before the next SPA pageview', async () => {
    const { b } = await loaded();
    (b.history as { pushState(s: unknown, t: string, u: string): void }).pushState({}, '', '/checkout');
    await b.flush();
    expect(b.names()).toEqual(['pageview', '$pageleave', 'pageview']);
    expect(b.events('$pageleave')[0]?.payload.url).toBe('/pricing');
    expect(b.pageviews()[1]?.payload.url).toBe('/checkout');
  });

  it('follows autocapture unless data-pageleave says otherwise', async () => {
    const off = await loaded({ config: defaultConfig({ autocapture: false }) });
    off.b.pagehide();
    expect(off.b.events('$pageleave')).toHaveLength(0);

    const on = await loaded({
      config: defaultConfig({ autocapture: false }),
      script: { 'data-website-id': WEBSITE_ID, 'data-pageleave': 'true' },
    });
    on.b.pagehide();
    expect(on.b.events('$pageleave')).toHaveLength(1);
  });

  it('falls back to keepalive fetch without sendBeacon', async () => {
    const { b } = await loaded({ beacon: false });
    b.pagehide();
    await b.flush();
    expect(b.events('$pageleave')[0]?.via).toBe('fetch');
  });
});

describe('super properties', () => {
  it('attaches registered properties to every event; event data wins', async () => {
    const { b, api } = await loaded();
    api.register({ plan: 'pro', source: 'ads' });
    api.registerOnce({ plan: 'free', first: 'yes' });
    api.track('clicked', { source: 'explicit' });
    api.unregister('first');
    api.track('second');
    await b.flush();

    expect(b.events('clicked')[0]?.payload.data).toEqual({ source: 'explicit', plan: 'pro', first: 'yes' });
    expect(b.events('second')[0]?.payload.data).toEqual({ plan: 'pro', source: 'ads' });
  });

  it('applies to errors and logs, keeps at most 100 keys, and survives reloads in the tab', async () => {
    const sessionStorage = new FakeStorage();
    const first = await loaded({ sessionStorage });
    const many = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`k${i}`, i]));
    first.api.register(many);
    first.api.track('big', { own: 1 });
    (first.api as unknown as { log(l: string, m: string): void }).log('info', 'hello');
    await first.b.flush();
    const data = first.b.events('big')[0]?.payload.data ?? {};
    expect(Object.keys(data)).toHaveLength(100);
    expect(data.own).toBe(1);
    expect(first.b.sent.find((e) => e.type === 'log')?.payload.data).toMatchObject({ k0: 0 });

    // Cookieless by default: stored in sessionStorage, not localStorage.
    expect(first.b.localStorage.getItem('flareboard.props')).toBeNull();
    const second = await loaded({ sessionStorage });
    expect(second.b.pageviews()[0]?.payload.data).toMatchObject({ k1: 1 });
  });

  it('are cleared by reset()', async () => {
    const { b, api } = await loaded();
    api.register({ plan: 'pro' });
    api.reset();
    api.track('after');
    await b.flush();
    expect(b.events('after')[0]?.payload.data).toBeUndefined();
  });
});

describe('opt-out and Do Not Track', () => {
  it('optOut stops everything and persists across page loads; optIn records the page', async () => {
    const localStorage = new FakeStorage();
    const { b, api } = await loaded({ localStorage });
    api.optOut();
    const before = b.sent.length;
    api.track('hidden');
    b.pagehide();
    await b.flush();
    expect(b.sent.length).toBe(before);
    expect(api.hasOptedOut()).toBe(true);
    expect(localStorage.getItem('flareboard.opt_out')).toBe('1');

    const next = await loaded({ localStorage });
    expect(next.b.sent).toHaveLength(0);
    next.api.optIn();
    await next.b.flush();
    expect(next.api.hasOptedOut()).toBe(false);
    expect(next.b.pageviews()).toHaveLength(1);
  });

  it('honors DNT with data-respect-dnt without waiting for the config', async () => {
    const { b, api } = await loaded({
      doNotTrack: '1',
      config: defaultConfig({ respectDnt: false }),
      script: { 'data-website-id': WEBSITE_ID, 'data-respect-dnt': '' },
    });
    api.track('x');
    await b.flush();
    expect(b.sent).toHaveLength(0);
    expect(api.hasOptedOut()).toBe(true);
  });

  it('holds sends from DNT/GPC browsers until the website setting is known', async () => {
    let resolve!: (cfg: Record<string, unknown>) => void;
    const b = createBrowser({ globalPrivacyControl: true, config: new Promise((r) => (resolve = r)) });
    b.run();
    await b.flush();
    expect(b.sent).toHaveLength(0);
    resolve(defaultConfig({ respectDnt: true }));
    await b.flush();
    expect(b.sent).toHaveLength(0);

    let resolve2!: (cfg: Record<string, unknown>) => void;
    const c = createBrowser({ doNotTrack: '1', config: new Promise((r) => (resolve2 = r)) });
    c.run();
    await c.flush();
    expect(c.sent).toHaveLength(0);
    resolve2(defaultConfig({ respectDnt: false }));
    await c.flush();
    expect(c.pageviews()).toHaveLength(1);
  });

  it('does not hold browsers without a signal', async () => {
    const b = createBrowser({ config: new Promise(() => {}) });
    b.run();
    await b.flush();
    expect(b.pageviews()).toHaveLength(1);
  });
});

describe('persistent anonymous identity', () => {
  it('stays cookieless when the website does not remember visitors', async () => {
    const { b, api } = await loaded({ config: defaultConfig({ persistence: false }) });
    api.track('later');
    await b.flush();
    expect(b.localStorage.getItem('flareboard.anon_id')).toBeNull();
    expect(b.sessionStorage.getItem('flareboard.anon_id')).toBeNull();
    const later = b.events('later')[0]!.payload;
    expect(later.id).toBeUndefined();
    expect(later.anonymousId).toBeUndefined();
    expect(api.getDistinctId()).toBe('');
  });

  it('keeps one random id in localStorage across page loads when persistence is on', async () => {
    const localStorage = new FakeStorage();
    const first = await loaded({ localStorage, config: defaultConfig({ persistence: true }) });
    const anon = localStorage.getItem('flareboard.anon_id');
    expect(anon).toMatch(/^[0-9a-f-]{36}$/);
    // The first pageview (sent before the setting was known) already carried it.
    expect(first.b.pageviews()[0]?.payload).toMatchObject({ id: anon, anonymousId: anon });

    const second = await loaded({ localStorage, config: defaultConfig({ persistence: true }) });
    expect(second.b.pageviews()[0]?.payload).toMatchObject({ id: anon, anonymousId: anon });
    expect(second.api.getDistinctId()).toBe(anon);
  });

  it('forgets the id when the website turns persistence off', async () => {
    const localStorage = new FakeStorage({ 'flareboard.anon_id': 'old-anon' });
    const { b, api } = await loaded({ localStorage, config: defaultConfig({ persistence: false }) });
    api.track('after');
    await b.flush();
    expect(localStorage.getItem('flareboard.anon_id')).toBeNull();
    expect(b.events('after')[0]?.payload.id).toBeUndefined();
  });

  it('data-persistence="false" never stores or sends an anonymous id', async () => {
    const { b } = await loaded({
      config: defaultConfig({ persistence: true }),
      script: { 'data-website-id': WEBSITE_ID, 'data-persistence': 'false' },
    });
    expect(b.localStorage.getItem('flareboard.anon_id')).toBeNull();
    expect(b.sent.every((e) => e.payload.anonymousId === undefined && e.payload.id === undefined)).toBe(true);
  });

  it('identify() aliases the anonymous id and switches the distinct id', async () => {
    const { b, api } = await loaded({ config: defaultConfig({ persistence: true }) });
    const anon = api.getDistinctId();
    api.identify('user-42', { email: 'a@b.c' });
    api.track('after');
    await b.flush();

    expect(b.events('$alias')[0]?.payload.data).toEqual({ alias: anon, distinctId: 'user-42' });
    expect(b.sent.find((e) => e.type === 'identify')?.payload).toMatchObject({ id: 'user-42' });
    const after = b.events('after')[0]!.payload;
    expect(after.id).toBe('user-42');
    expect(after.anonymousId).toBeUndefined();

    // A second identify for the same user does not alias again.
    api.identify('user-42');
    await b.flush();
    expect(b.events('$alias')).toHaveLength(1);
  });

  it('defers the alias until persistence is confirmed', async () => {
    let resolve!: (cfg: Record<string, unknown>) => void;
    const b = createBrowser({ config: new Promise((r) => (resolve = r)) });
    const api = b.run();
    api.identify('user-7');
    await b.flush();
    expect(b.events('$alias')).toHaveLength(0);
    resolve(defaultConfig({ persistence: true }));
    await b.flush();
    expect(b.events('$alias')[0]?.payload.data).toMatchObject({ distinctId: 'user-7' });

    let resolveOff!: (cfg: Record<string, unknown>) => void;
    const c = createBrowser({ config: new Promise((r) => (resolveOff = r)) });
    c.run().identify('user-8');
    resolveOff(defaultConfig({ persistence: false }));
    await c.flush();
    expect(c.events('$alias')).toHaveLength(0);
  });

  it('reset() starts a new anonymous id and a new session', async () => {
    const { b, api } = await loaded({ config: defaultConfig({ persistence: true }) });
    const before = api.getDistinctId();
    api.identify('user-1');
    api.reset();
    api.track('fresh');
    await b.flush();
    const fresh = b.events('fresh')[0]!.payload;
    expect(fresh.id).toBe(fresh.anonymousId);
    expect(fresh.id).not.toBe(before);
    expect(b.localStorage.getItem('flareboard.distinct_id')).toBeNull();
    expect(b.localStorage.getItem('flareboard.anon_id')).toBe(fresh.id);
  });

  it('stores super properties in localStorage when visitors are remembered', async () => {
    const { b, api } = await loaded({ config: defaultConfig({ persistence: true }) });
    api.register({ plan: 'pro' });
    expect(JSON.parse(b.localStorage.getItem('flareboard.props') ?? '{}')).toEqual({ plan: 'pro' });
  });

  it('group() attaches the anonymous id with its marker', async () => {
    const { b, api } = await loaded({ config: defaultConfig({ persistence: true }) });
    api.group('company', 'acme');
    await b.flush();
    const group = b.sent.find((e) => e.type === 'group')!.payload;
    expect(group.id).toBe(group.anonymousId);
  });
});

describe('queued calls from the loader stub', () => {
  it('applies identity and consent calls before the first pageview and captures after it', async () => {
    const q: Array<[string, unknown[]]> = [
      ['track', ['early_event']],
      ['register', [{ plan: 'pro' }]],
      ['identify', ['user-9']],
    ];
    const { b } = await loaded({ preload: { _q: q } });
    expect(b.names().filter((n) => n !== '$alias')).toEqual(['pageview', 'early_event']);
    expect(b.pageviews()[0]?.payload).toMatchObject({ id: 'user-9', data: { plan: 'pro' } });
  });

  it('a queued optOut prevents the first pageview', async () => {
    const { b } = await loaded({ preload: { _q: [['optOut', []], ['track', ['x']]] } });
    expect(b.sent).toHaveLength(0);
  });
});

describe('data-project-key', () => {
  it('resolves the website through tracker-config before tracking', async () => {
    const { b } = await loaded({ script: { 'data-project-key': 'pk_live_123' } });
    expect(b.requests[0]?.url).toContain('/api/tracker-config?key=pk_live_123');
    expect(b.pageviews()[0]?.payload.website).toBe(WEBSITE_ID);
  });

  it('does nothing when the key cannot be resolved', async () => {
    const { b } = await loaded({ script: { 'data-project-key': 'nope' }, config: null });
    expect(b.sent).toHaveLength(0);
  });
});
