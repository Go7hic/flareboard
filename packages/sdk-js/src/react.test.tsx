import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createFlareboard } from './client.js';
import { createFlagStore, flagFromSnapshot, isFlagOn, EMPTY_FLAGS } from './flag-store.js';
import { FlareboardProvider, useFeatureFlag, useFeatureFlagPayload, useFlareboard } from './react.js';

describe('flag store (hook state)', () => {
  it('keeps one snapshot object until flags change and notifies subscribers', () => {
    const store = createFlagStore();
    expect(store.getSnapshot()).toBe(EMPTY_FLAGS);
    let notified = 0;
    const off = store.subscribe(() => notified++);
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);

    store.update(['a'], { a: 'test', b: 'control' }, { a: 1 });
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(store.getSnapshot()).toBe(after);
    expect(after).toMatchObject({ loaded: true, flags: ['a'], variants: { a: 'test', b: 'control' }, payloads: { a: 1 } });
    expect(notified).toBe(1);
    expect(Object.isFrozen(after.variants)).toBe(true);

    off();
    store.update([], {}, {});
    expect(notified).toBe(1);
  });

  it('reads values with fallbacks and applies the enabled rule', () => {
    const store = createFlagStore();
    expect(flagFromSnapshot(store.getSnapshot(), 'a', 'fb')).toBe('fb');
    store.update(['a'], { a: 'variant-x', off: false, ctl: 'control' }, {});
    expect(flagFromSnapshot(store.getSnapshot(), 'a', 'fb')).toBe('variant-x');
    expect(flagFromSnapshot(store.getSnapshot(), 'missing', 'fb')).toBe('fb');
    expect([true, 'test', 'variant-x'].map((v) => isFlagOn(v))).toEqual([true, true, true]);
    expect([false, 'control', undefined].map((v) => isFlagOn(v))).toEqual([false, false, false]);
  });
});

describe('React bindings', () => {
  function Flag({ flagKey }: { flagKey: string }) {
    const value = useFeatureFlag(flagKey, 'loading');
    const payload = useFeatureFlagPayload<{ title: string }>(flagKey);
    return <p>{`${String(value)}|${payload?.title ?? '-'}`}</p>;
  }

  it('renders fallbacks on the server without touching window', () => {
    const client = createFlareboard({});
    const html = renderToString(
      <FlareboardProvider client={client} config={{ host: 'https://t.example.com', websiteId: 's' }}>
        <Flag flagKey="beta" />
      </FlareboardProvider>,
    );
    expect(html).toContain('loading|-');
    expect(client.initialized).toBe(false);
  });

  it('hooks read the current flag snapshot of the provided client', () => {
    const window: { flareboard?: Record<string, unknown> } = {};
    const document = { head: { appendChild: () => undefined }, querySelector: () => null, createElement: () => ({ setAttribute() {}, addEventListener() {} }) };
    const client = createFlareboard({ window, document } as never);
    client.init({ host: 'https://t.example.com', websiteId: 's' });
    const [, [onFlags]] = (window.flareboard as { _q: Array<[string, [(...a: unknown[]) => void]]> })._q[0]!;
    onFlags(['beta'], { beta: 'b' }, { beta: { title: 'New checkout' } });

    let fromContext: unknown;
    function Probe() {
      fromContext = useFlareboard();
      return null;
    }
    const html = renderToString(
      <FlareboardProvider client={client}>
        <Flag flagKey="beta" />
        <Flag flagKey="unknown" />
        <Probe />
      </FlareboardProvider>,
    );
    expect(html).toContain('b|New checkout');
    expect(html).toContain('loading|-');
    expect(fromContext).toBe(client);
  });
});
