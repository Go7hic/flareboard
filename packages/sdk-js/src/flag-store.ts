import type { FeatureFlagsCallback, FlagValue } from './types.js';

export type FlagSnapshot = {
  /** False until the tracker has loaded flags at least once. */
  readonly loaded: boolean;
  readonly flags: readonly string[];
  readonly variants: Readonly<Record<string, FlagValue>>;
  readonly payloads: Readonly<Record<string, unknown>>;
};

export const EMPTY_FLAGS: FlagSnapshot = Object.freeze({
  loaded: false,
  flags: Object.freeze([]) as readonly string[],
  variants: Object.freeze({}),
  payloads: Object.freeze({}),
});

/**
 * The latest flags the tracker reported, as an immutable snapshot plus listeners. React hooks
 * read it through useSyncExternalStore, so the snapshot object only changes when flags change.
 */
export function createFlagStore() {
  let snapshot: FlagSnapshot = EMPTY_FLAGS;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: (): FlagSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Tracker callback (see FeatureFlagsCallback). */
    update: ((flags, variants, payloads) => {
      snapshot = Object.freeze({
        loaded: true,
        flags: Object.freeze([...(flags ?? [])]),
        variants: Object.freeze({ ...(variants ?? {}) }),
        payloads: Object.freeze({ ...(payloads ?? {}) }),
      });
      for (const listener of [...listeners]) listener();
    }) as FeatureFlagsCallback,
  };
}

export type FlagStore = ReturnType<typeof createFlagStore>;

/** A flag's value from a snapshot: `fallback` until flags load or when the flag is unknown. */
export function flagFromSnapshot(snapshot: FlagSnapshot, key: string, fallback?: FlagValue): FlagValue | undefined {
  if (!snapshot.loaded || !Object.prototype.hasOwnProperty.call(snapshot.variants, key)) return fallback;
  return snapshot.variants[key];
}

/** Whether a flag value counts as "on" (same rule as the tracker's isFeatureEnabled). */
export function isFlagOn(value: FlagValue | undefined): boolean {
  return value === true || (value !== undefined && value !== false && value !== 'control');
}
