import { describe, expect, it } from 'vitest';
// Source import: the package's exports point at dist/, which is only built for publishing.
import { createFlareboard, type BrowserEnv } from '../../../packages/sdk-js/src/client';
import { WEBSITE_ID, createBrowser, defaultConfig } from './helpers/fake-browser';

/**
 * @flareboard/js queues calls on window.flareboard._q and injects script.js; the script replays
 * the queue. This runs both halves for real so the protocol cannot drift.
 */
describe('@flareboard/js with the real tracker script', () => {
  it('replays queued calls, applies script attributes and feeds flags back to the SDK', async () => {
    const b = createBrowser({
      config: defaultConfig({
        persistence: true,
        featureFlags: [{ key: 'beta', enabled: true, rollout: 100, variants: [], targeted: false, payload: { v: 1 } }],
      }),
    });
    let injected: { attrs: Record<string, string>; src: string } | undefined;
    const document = {
      head: { appendChild: (node: typeof injected) => (injected = node) },
      querySelector: () => null,
      createElement: () => {
        const node = { attrs: {} as Record<string, string>, src: '', setAttribute: (k: string, v: string) => (node.attrs[k] = v), addEventListener() {} };
        return node;
      },
    };
    const sdk = createFlareboard({ window: b.window, document } as unknown as BrowserEnv);
    const flagCalls: unknown[] = [];
    sdk.onFeatureFlags((flags) => flagCalls.push(flags));

    sdk.init({ host: 'https://t.example.test', websiteId: WEBSITE_ID, autocapture: false, capturePageleave: false });
    sdk.register({ app: 'web' });
    sdk.identify('user-1');
    sdk.track('signed_up', { plan: 'pro' });
    expect(b.sent).toHaveLength(0);

    // The browser loads the injected script: copy its attributes onto the fake <script> tag.
    expect(injected?.src).toBe('https://t.example.test/script.js');
    const tag = b.document.currentScript!;
    for (const [name, value] of Object.entries(injected!.attrs)) tag.setAttribute(name, value);
    b.run();
    await b.flush();

    expect(b.names().filter((n) => n !== '$alias')).toEqual(['pageview', 'signed_up']);
    expect(b.pageviews()[0]?.payload).toMatchObject({ id: 'user-1', data: { app: 'web' } });
    expect(b.events('signed_up')[0]?.payload.data).toEqual({ plan: 'pro', app: 'web' });

    expect(sdk.loaded).toBe(true);
    expect(flagCalls).toEqual([['beta']]);
    expect(sdk.getFeatureFlag('beta')).toBe('test');
    expect(sdk.getFeatureFlagPayload('beta')).toEqual({ v: 1 });
    expect(sdk.featureFlags.getSnapshot().variants).toEqual({ beta: 'test' });

    b.click(b.mount(b.el('button', {}, 'Nope')));
    b.pagehide();
    await b.flush();
    expect(b.events('$autocapture')).toHaveLength(0);
    expect(b.events('$pageleave')).toHaveLength(0);
  });
});
