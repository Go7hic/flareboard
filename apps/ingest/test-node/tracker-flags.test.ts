import { describe, expect, it } from 'vitest';
import {
  FLAG_HASH_JS,
  evaluateFeatureFlag,
  flagBucketingId,
  rolloutBucket,
  variantBucket,
  type FeatureFlagConfigForEvaluation,
} from '@flareboard/shared';
import { TRACKER_SCRIPT } from '../src/tracker/script';
import { FakeStorage, createBrowser, defaultConfig, type TrackerApi } from './helpers/fake-browser';

const variantFlag: FeatureFlagConfigForEvaluation = {
  key: 'checkout.flow',
  enabled: true,
  rollout: 70,
  variants: [
    { key: 'a', weight: 30 },
    { key: 'b', weight: 30 },
    { key: 'c', weight: 40 },
  ],
};
const booleanFlag: FeatureFlagConfigForEvaluation = { key: 'beta', enabled: true, rollout: 35 };

function trackerFlags(extra: Record<string, unknown> = {}) {
  return [
    { ...variantFlag, targeted: false, variants: variantFlag.variants!.map((v) => ({ ...v, name: v.key, payload: { v: v.key } })) },
    { ...booleanFlag, targeted: false, variants: [], payload: { banner: 'on' }, ...extra },
  ];
}

async function trackerFor(storage: { local?: Record<string, string>; session?: Record<string, string> }, persistence = false) {
  const b = createBrowser({
    localStorage: new FakeStorage(storage.local),
    sessionStorage: new FakeStorage(storage.session),
    config: defaultConfig({ featureFlags: trackerFlags(), persistence }),
  });
  b.run();
  await b.flush();
  return { b, api: b.window.flareboard as TrackerApi };
}

describe('tracker feature flag bucketing', () => {
  it('embeds the shared FLAG_HASH_JS verbatim', () => {
    expect(TRACKER_SCRIPT).toContain(FLAG_HASH_JS);
  });

  it("the script's hashFlag, extracted and evaluated, matches rolloutBucket/variantBucket", () => {
    const source = TRACKER_SCRIPT.match(/function hashFlag\(str\)\{.*?return Math\.abs\(h>>>0\)%100\}/)?.[0];
    expect(source).toBeTruthy();
    const hashFlag = new Function(`${source}; return hashFlag;`)() as (value: string) => number;
    for (let i = 0; i < 1000; i++) {
      const id = `visitor-${i}-${'é'.repeat(i % 3)}`;
      expect(hashFlag(`checkout.flow:${id}`)).toBe(rolloutBucket('checkout.flow', id));
      expect(hashFlag(`checkout.flow:variant:${id}`)).toBe(variantBucket('checkout.flow', id));
    }
  });

  it('assigns the same variant as the server evaluator for identified users', async () => {
    for (let i = 0; i < 150; i++) {
      const distinctId = `user-${i}`;
      const { api, b } = await trackerFor({ local: { 'flareboard.distinct_id': distinctId } });
      expect(api.getFeatureFlag('checkout.flow')).toBe(evaluateFeatureFlag(variantFlag, { distinctId }).variant);
      expect(api.getFeatureFlag('beta')).toBe(evaluateFeatureFlag(booleanFlag, { distinctId }).variant);
      // Targeted-flag context carries the same bucketing id.
      expect(b.localStorage.getItem('flareboard.distinct_id')).toBe(distinctId);
    }
  });

  it('uses the flagBucketingId order: distinct id, anonymous id, session id, visit id, anonymous', async () => {
    const cases: Array<{ local?: Record<string, string>; session?: Record<string, string>; persistence?: boolean; ids: { distinctId?: string; anonymousId?: string; sessionId?: string; visitId?: string } }> = [
      { local: { 'flareboard.distinct_id': 'u1', 'flareboard.anon_id': 'a1' }, session: { 'flareboard.sid': 's1' }, persistence: true, ids: { distinctId: 'u1', anonymousId: 'a1', sessionId: 's1' } },
      { local: { 'flareboard.anon_id': 'a2' }, session: { 'flareboard.sid': 's2' }, persistence: true, ids: { anonymousId: 'a2', sessionId: 's2' } },
      { session: { 'flareboard.sid': 's3', 'flareboard.vid': 'v3' }, ids: { sessionId: 's3', visitId: 'v3' } },
      { session: { 'flareboard.vid': 'v4' }, ids: { visitId: 'v4' } },
    ];
    for (const c of cases) {
      const { api, b } = await trackerFor({ local: c.local }, c.persistence);
      // The first send stores the ingest's session/visit ids; put the case's ids in place.
      for (const key of ['flareboard.sid', 'flareboard.vid']) b.sessionStorage.removeItem(key);
      for (const [key, value] of Object.entries(c.session ?? {})) b.sessionStorage.setItem(key, value);
      const expected = evaluateFeatureFlag(variantFlag, c.ids).variant;
      expect(flagBucketingId(c.ids)).toBe(c.ids.distinctId ?? c.ids.anonymousId ?? c.ids.sessionId ?? c.ids.visitId);
      expect(api.getFeatureFlag('checkout.flow')).toBe(expected);
    }
  });

  it('falls back to the literal "anonymous" bucket, not the user agent', async () => {
    const b = createBrowser({ config: defaultConfig({ featureFlags: trackerFlags() }) });
    b.run();
    await b.flush();
    // The first send stored session/visit ids; clear them to reach the last fallback.
    b.sessionStorage.removeItem('flareboard.sid');
    b.sessionStorage.removeItem('flareboard.vid');
    const api = b.window.flareboard as TrackerApi;
    expect(api.getFeatureFlag('checkout.flow')).toBe(evaluateFeatureFlag(variantFlag, {}).variant);
  });
});

describe('flag payloads and callbacks', () => {
  it('returns the payload of the assigned variant or the boolean flag', async () => {
    let found = { variant: false, boolean: false };
    for (let i = 0; i < 60 && !(found.variant && found.boolean); i++) {
      const distinctId = `payload-${i}`;
      const { api } = await trackerFor({ local: { 'flareboard.distinct_id': distinctId } });
      const variant = evaluateFeatureFlag(variantFlag, { distinctId }).variant;
      if (variant !== 'control') {
        expect(api.getFeatureFlagPayload('checkout.flow')).toEqual({ v: variant });
        found.variant = true;
      } else {
        expect(api.getFeatureFlagPayload('checkout.flow')).toBeUndefined();
      }
      const boolean = evaluateFeatureFlag(booleanFlag, { distinctId }).variant;
      expect(api.getFeatureFlagPayload('beta')).toEqual(boolean === 'test' ? { banner: 'on' } : undefined);
      if (boolean === 'test') found.boolean = true;
    }
    expect(found).toEqual({ variant: true, boolean: true });
  });

  it('does not send an exposure event for payload reads', async () => {
    const { api, b } = await trackerFor({ local: { 'flareboard.distinct_id': 'u' } });
    api.getFeatureFlagPayload('beta');
    await b.flush();
    expect(b.events('$feature_flag_called')).toHaveLength(0);
    api.getFeatureFlag('beta');
    await b.flush();
    expect(b.events('$feature_flag_called')).toHaveLength(1);
  });

  it('onFeatureFlags fires when flags load, immediately for late subscribers, and can unsubscribe', async () => {
    let resolve!: (cfg: Record<string, unknown>) => void;
    const b = createBrowser({
      localStorage: new FakeStorage({ 'flareboard.distinct_id': 'user-3' }),
      config: new Promise((r) => (resolve = r)),
    });
    const api = b.run();
    const calls: unknown[][] = [];
    const off = api.onFeatureFlags((...args) => calls.push(args));
    expect(calls).toHaveLength(0);
    resolve(defaultConfig({ featureFlags: trackerFlags() }));
    await b.flush();
    expect(calls).toHaveLength(1);
    const [flags, variants] = calls[0] as [string[], Record<string, string | boolean>];
    expect(variants['checkout.flow']).toBe(evaluateFeatureFlag(variantFlag, { distinctId: 'user-3' }).variant);
    expect(flags).toEqual(Object.keys(variants).filter((k) => variants[k] !== 'control'));

    const late: unknown[] = [];
    api.onFeatureFlags((f) => late.push(f));
    expect(late).toHaveLength(1);

    off();
    (b.history as { pushState(s: unknown, t: string, u: string): void }).pushState({}, '', '/next');
    await b.flush();
    expect(calls).toHaveLength(1);
    expect(late).toHaveLength(2);
  });
});
