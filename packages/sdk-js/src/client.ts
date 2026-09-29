import { createFlagStore, flagFromSnapshot, isFlagOn, type FlagStore } from './flag-store.js';
import type {
  AiObservation,
  ExceptionContext,
  FeatureFlagsCallback,
  FlagValue,
  FlareboardApi,
  FlareboardConfig,
  LogLevel,
  Properties,
} from './types.js';

type QueuedCall = [method: string, args: unknown[]];
type Stub = { _q: QueuedCall[] } & Record<string, unknown>;
type TrackerWindow = { flareboard?: Record<string, unknown> };

/** The browser globals the loader touches; injectable for tests. */
export type BrowserEnv = {
  window?: TrackerWindow;
  document?: Pick<Document, 'createElement' | 'head' | 'querySelector'>;
};

/** Every tracker method the stub accepts before the script has loaded. */
export const QUEUED_METHODS = [
  'track',
  'page',
  'identify',
  'alias',
  'group',
  'reset',
  'register',
  'registerOnce',
  'unregister',
  'optOut',
  'optIn',
  'onFeatureFlags',
  'captureException',
  'revenue',
  'log',
  'ai',
] as const;

export interface FlareboardClient extends FlareboardApi {
  /** Loads the tracker script once. Safe to call during SSR (does nothing without `window`). */
  init(config: FlareboardConfig): FlareboardClient;
  /** True once `init` ran in a browser. */
  readonly initialized: boolean;
  /** True once the tracker script has loaded and replaced the queue. */
  readonly loaded: boolean;
  /** Flag snapshot store used by the React hooks. */
  readonly featureFlags: Pick<FlagStore, 'getSnapshot' | 'subscribe'>;
}

function scriptAttributes(config: FlareboardConfig): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (config.websiteId) attrs['data-website-id'] = config.websiteId;
  else if (config.projectKey) attrs['data-project-key'] = config.projectKey;
  if (config.autocapture !== undefined) attrs['data-autocapture'] = String(config.autocapture);
  if (config.capturePageleave !== undefined) attrs['data-pageleave'] = String(config.capturePageleave);
  if (config.persistence === false) attrs['data-persistence'] = 'false';
  if (config.respectDnt !== undefined) attrs['data-respect-dnt'] = String(config.respectDnt);
  if (config.release) attrs['data-release'] = config.release;
  if (config.environment) attrs['data-environment'] = config.environment;
  if (config.heatmapSampleRate !== undefined) attrs['data-heatmap-sample-rate'] = String(config.heatmapSampleRate);
  return attrs;
}

export function scriptSrc(config: FlareboardConfig): string {
  return config.scriptUrl ?? `${config.host.replace(/\/+$/, '')}/script.js`;
}

/**
 * Creates a client. Most apps use the shared `flareboard` instance instead; this exists so tests
 * (and unusual setups) can pass their own `window` / `document`.
 */
export function createFlareboard(env: BrowserEnv = {}): FlareboardClient {
  const store = createFlagStore();
  const beforeInit: QueuedCall[] = [];
  const readyWaiters: Array<() => void> = [];
  const listeners = new Set<FeatureFlagsCallback>();
  let initialized = false;
  let optedOut: boolean | undefined;

  const win = (): TrackerWindow | undefined =>
    env.window ?? (typeof window !== 'undefined' ? (window as unknown as TrackerWindow) : undefined);
  const doc = () => env.document ?? (typeof document !== 'undefined' ? document : undefined);

  /** The real tracker, or null while only the queue stub (or nothing) is there. */
  function tracker(): Record<string, unknown> | null {
    const fb = win()?.flareboard;
    return fb && !Array.isArray((fb as Partial<Stub>)._q) ? fb : null;
  }

  function call(method: string, args: unknown[]): unknown {
    const w = win();
    if (!w) return undefined;
    if (!initialized) {
      beforeInit.push([method, args]);
      return undefined;
    }
    const fb = w.flareboard as Record<string, unknown> | undefined;
    const fn = fb?.[method];
    return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown).apply(fb, args) : undefined;
  }

  function installStub(w: TrackerWindow): Stub {
    const existing = w.flareboard as Partial<Stub> | undefined;
    const stub: Stub = existing && Array.isArray(existing._q) ? (existing as Stub) : { _q: [] };
    for (const method of QUEUED_METHODS) {
      stub[method] = (...args: unknown[]) => {
        stub._q.push([method, args]);
      };
    }
    w.flareboard = stub;
    return stub;
  }

  const onFlags: FeatureFlagsCallback = (flags, variants, payloads) => {
    store.update(flags, variants, payloads);
    const snap = store.getSnapshot();
    for (const listener of [...listeners]) {
      try {
        listener([...snap.flags], { ...snap.variants }, { ...snap.payloads });
      } catch (error) {
        console.warn('[flareboard] onFeatureFlags callback failed', error);
      }
    }
    while (readyWaiters.length) readyWaiters.shift()!();
  };

  const client: FlareboardClient = {
    get initialized() {
      return initialized;
    },
    get loaded() {
      return tracker() !== null;
    },
    featureFlags: { getSnapshot: store.getSnapshot, subscribe: store.subscribe },

    init(config) {
      const w = win();
      const d = doc();
      if (!w || !d) return client;
      if (initialized) {
        console.warn('[flareboard] init() was already called; ignoring the new config');
        return client;
      }
      if (!config?.host || (!config.websiteId && !config.projectKey)) {
        console.warn('[flareboard] init() needs host and websiteId (or projectKey)');
        return client;
      }
      initialized = true;

      if (tracker()) {
        // The script is already on the page (for example a plain <script> tag).
        (tracker()!.onFeatureFlags as (cb: FeatureFlagsCallback) => void)(onFlags);
        for (const [method, args] of beforeInit.splice(0)) call(method, args);
        return client;
      }

      const stub = installStub(w);
      stub._q.push(['onFeatureFlags', [onFlags]], ...beforeInit.splice(0));
      const script = d.createElement('script');
      script.async = true;
      script.src = scriptSrc(config);
      if (config.nonce) script.nonce = config.nonce;
      for (const [name, value] of Object.entries(scriptAttributes(config))) script.setAttribute(name, value);
      script.addEventListener('error', () => console.warn(`[flareboard] could not load ${script.src}`));
      (d.head ?? d.querySelector('head') ?? d.querySelector('body'))?.appendChild(script);
      return client;
    },

    track: (name, data, tag) => void call('track', [name, data, tag]),
    page: () => void call('page', []),
    identify: (distinctId, properties) => void call('identify', [distinctId, properties]),
    alias: (alias, distinctId) => void call('alias', [alias, distinctId]),
    group: (type, key, properties) => void call('group', [type, key, properties]),
    reset: () => void call('reset', []),
    register: (properties) => void call('register', [properties]),
    registerOnce: (properties) => void call('registerOnce', [properties]),
    unregister: (key) => void call('unregister', [key]),
    optOut() {
      optedOut = true;
      call('optOut', []);
    },
    optIn() {
      optedOut = false;
      call('optIn', []);
    },
    hasOptedOut() {
      const fb = tracker();
      return fb ? Boolean((fb.hasOptedOut as () => boolean)()) : optedOut === true;
    },
    getFeatureFlag(key: string, fallback?: FlagValue) {
      const fb = tracker();
      if (fb) return (fb.getFeatureFlag as (k: string, f?: FlagValue) => FlagValue)(key, fallback);
      return flagFromSnapshot(store.getSnapshot(), key, fallback);
    },
    isFeatureEnabled(key: string, fallback?: boolean) {
      const fb = tracker();
      if (fb) return Boolean((fb.isFeatureEnabled as (k: string, f?: boolean) => boolean)(key, fallback));
      const value = flagFromSnapshot(store.getSnapshot(), key);
      return value === undefined ? fallback === true : isFlagOn(value);
    },
    getFeatureFlagPayload(key: string) {
      const fb = tracker();
      if (fb && typeof fb.getFeatureFlagPayload === 'function') {
        return (fb.getFeatureFlagPayload as (k: string) => unknown)(key);
      }
      return store.getSnapshot().payloads[key];
    },
    onFeatureFlags(callback) {
      listeners.add(callback);
      const snap = store.getSnapshot();
      if (snap.loaded) callback([...snap.flags], { ...snap.variants }, { ...snap.payloads });
      return () => {
        listeners.delete(callback);
      };
    },
    featureFlagsReady() {
      if (store.getSnapshot().loaded) return Promise.resolve();
      return new Promise<void>((resolve) => readyWaiters.push(resolve));
    },
    captureException: (error: unknown, context?: ExceptionContext) => void call('captureException', [error, context]),
    revenue: (amount, currency, extra) => void call('revenue', [amount, currency, extra]),
    log: (level: LogLevel, message: string, data?: Properties) => void call('log', [level, message, data]),
    ai: (observation: AiObservation) => void call('ai', [observation]),
    getDistinctId() {
      const fb = tracker();
      return fb ? String((fb.getDistinctId as () => string)() ?? '') : '';
    },
    getSessionId() {
      const fb = tracker();
      return fb ? ((fb.getSessionId as () => string | null)() ?? null) : null;
    },
    getVisitId() {
      const fb = tracker();
      return fb ? ((fb.getVisitId as () => string | null)() ?? null) : null;
    },
  };

  return client;
}
