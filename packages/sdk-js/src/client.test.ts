import { describe, expect, it, vi } from 'vitest';
import { createFlareboard, scriptSrc, type BrowserEnv } from './client.js';

type FakeScript = {
  attrs: Record<string, string>;
  src: string;
  async: boolean;
  nonce?: string;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, fn: () => void): void;
  listeners: Record<string, () => void>;
};

function fakeEnv() {
  const appended: FakeScript[] = [];
  const window: { flareboard?: Record<string, unknown> } = {};
  const document = {
    head: {
      appendChild(node: FakeScript) {
        appended.push(node);
        return node;
      },
    },
    querySelector: () => null,
    createElement(): FakeScript {
      const script: FakeScript = {
        attrs: {},
        src: '',
        async: false,
        listeners: {},
        setAttribute(name, value) {
          script.attrs[name] = value;
        },
        addEventListener(type, fn) {
          script.listeners[type] = fn;
        },
      };
      return script;
    },
  };
  return { env: { window, document } as unknown as BrowserEnv, window, appended };
}

/** Mimics what script.js does on load: replace the stub and replay its queue. */
function loadTracker(window: { flareboard?: Record<string, unknown> }, impl: Record<string, (...args: never[]) => unknown>) {
  const queue = (window.flareboard as { _q: Array<[string, unknown[]]> })._q;
  window.flareboard = impl;
  for (const [method, args] of queue) (impl[method] as (...a: unknown[]) => unknown)?.(...args);
}

describe('loader', () => {
  it('injects the tracker once with the config as script attributes', () => {
    const { env, appended } = fakeEnv();
    const client = createFlareboard(env);
    client.init({
      host: 'https://t.example.com/',
      websiteId: 'site-1',
      autocapture: false,
      capturePageleave: true,
      persistence: false,
      respectDnt: true,
      release: '1.2.3',
      environment: 'production',
      heatmapSampleRate: 0.5,
      nonce: 'abc',
    });
    client.init({ host: 'https://other.example.com', websiteId: 'site-2' });

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ src: 'https://t.example.com/script.js', async: true, nonce: 'abc' });
    expect(appended[0]!.attrs).toEqual({
      'data-website-id': 'site-1',
      'data-autocapture': 'false',
      'data-pageleave': 'true',
      'data-persistence': 'false',
      'data-respect-dnt': 'true',
      'data-release': '1.2.3',
      'data-environment': 'production',
      'data-heatmap-sample-rate': '0.5',
    });
  });

  it('omits unset options so the website settings apply, and supports project keys', () => {
    const { env, appended } = fakeEnv();
    createFlareboard(env).init({ host: 'https://t.example.com', projectKey: 'pk_1', persistence: true });
    expect(appended[0]!.attrs).toEqual({ 'data-project-key': 'pk_1' });
    expect(scriptSrc({ host: 'https://t.example.com', scriptUrl: 'https://cdn.example.com/fb.js' })).toBe(
      'https://cdn.example.com/fb.js',
    );
  });

  it('requires a host and a website id or project key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { env, appended } = fakeEnv();
    const client = createFlareboard(env);
    client.init({ host: '' , websiteId: 'x' });
    client.init({ host: 'https://t.example.com' });
    expect(appended).toHaveLength(0);
    expect(client.initialized).toBe(false);
    warn.mockRestore();
  });

  it('queues calls made before and after init, in order, until the script loads', () => {
    const { env, window } = fakeEnv();
    const client = createFlareboard(env);
    client.register({ plan: 'pro' });
    client.init({ host: 'https://t.example.com', websiteId: 'site-1' });
    client.identify('user-1', { email: 'a@b.c' });
    client.track('signup', { step: 1 });
    client.optOut();

    const queue = (window.flareboard as { _q: Array<[string, unknown[]]> })._q;
    expect(queue.map(([method]) => method)).toEqual(['onFeatureFlags', 'register', 'identify', 'track', 'optOut']);
    expect(queue[3]).toEqual(['track', ['signup', { step: 1 }, undefined]]);
    expect(client.loaded).toBe(false);
    expect(client.hasOptedOut()).toBe(true);

    const calls: string[] = [];
    loadTracker(window, {
      onFeatureFlags: () => calls.push('onFeatureFlags'),
      register: () => calls.push('register'),
      identify: () => calls.push('identify'),
      track: (name: never) => calls.push(`track:${name}`),
      optOut: () => calls.push('optOut'),
      hasOptedOut: () => false,
    });
    expect(calls).toEqual(['onFeatureFlags', 'register', 'identify', 'track:signup', 'optOut']);
    expect(client.loaded).toBe(true);

    // After load, calls go straight to the tracker and getters read from it.
    client.track('later');
    expect(calls.at(-1)).toBe('track:later');
    expect(client.hasOptedOut()).toBe(false);
  });

  it('keeps an existing queue from an HTML snippet and uses an already-loaded tracker', () => {
    const { env, window, appended } = fakeEnv();
    window.flareboard = { _q: [['track', ['from-snippet']]] };
    createFlareboard(env).init({ host: 'https://t.example.com', websiteId: 's' });
    expect((window.flareboard as { _q: unknown[] })._q).toContainEqual(['track', ['from-snippet']]);
    expect(appended).toHaveLength(1);

    const loaded = fakeEnv();
    const onFeatureFlags = vi.fn();
    const track = vi.fn();
    loaded.window.flareboard = { onFeatureFlags, track };
    const client = createFlareboard(loaded.env);
    client.track('before-init');
    client.init({ host: 'https://t.example.com', websiteId: 's' });
    expect(loaded.appended).toHaveLength(0);
    expect(onFeatureFlags).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('before-init', undefined, undefined);
  });

  it('is a no-op without a browser (SSR)', () => {
    const client = createFlareboard({});
    expect(client.init({ host: 'https://t.example.com', websiteId: 's' })).toBe(client);
    expect(client.initialized).toBe(false);
    client.track('x');
    expect(client.getFeatureFlag('f', 'fallback')).toBe('fallback');
    expect(client.isFeatureEnabled('f')).toBe(false);
    expect(client.getDistinctId()).toBe('');
    expect(client.getSessionId()).toBeNull();
  });
});

describe('feature flags before and after load', () => {
  it('serves fallbacks until flags arrive, then values, payloads and callbacks', async () => {
    const { env, window } = fakeEnv();
    const client = createFlareboard(env);
    client.init({ host: 'https://t.example.com', websiteId: 's' });
    expect(client.getFeatureFlag('beta', 'off')).toBe('off');
    expect(client.isFeatureEnabled('beta', true)).toBe(true);

    const seen: unknown[] = [];
    const unsubscribe = client.onFeatureFlags((flags, variants) => seen.push([flags, variants]));
    const ready = client.featureFlagsReady();

    // The tracker invokes the callback the SDK queued.
    const [, [onFlags]] = (window.flareboard as { _q: Array<[string, [(...a: unknown[]) => void]]> })._q[0]!;
    onFlags(['beta'], { beta: 'test', old: 'control' }, { beta: { color: 'red' } });
    await ready;

    expect(seen).toEqual([[['beta'], { beta: 'test', old: 'control' }]]);
    expect(client.getFeatureFlag('beta')).toBe('test');
    expect(client.isFeatureEnabled('old', true)).toBe(false);
    expect(client.getFeatureFlagPayload('beta')).toEqual({ color: 'red' });

    // Late subscribers get the current flags right away.
    const late = vi.fn();
    client.onFeatureFlags(late);
    expect(late).toHaveBeenCalledWith(['beta'], { beta: 'test', old: 'control' }, { beta: { color: 'red' } });

    unsubscribe();
    onFlags([], { beta: 'control' }, {});
    expect(seen).toHaveLength(1);
    expect(late).toHaveBeenCalledTimes(2);
    await expect(client.featureFlagsReady()).resolves.toBeUndefined();
  });
});
