import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { flareboard } from './index.js';
import type { FlareboardClient } from './client.js';
import { flagFromSnapshot } from './flag-store.js';
import type { FlagValue, FlareboardConfig } from './types.js';

const FlareboardContext = createContext<FlareboardClient>(flareboard);

export type FlareboardProviderProps = {
  /** Calls `client.init(config)` once after mount. Omit if you call `init` yourself. */
  config?: FlareboardConfig;
  /** Defaults to the shared `flareboard` client. */
  client?: FlareboardClient;
  children?: ReactNode;
};

/** Initializes Flareboard (optionally) and makes the client available to the hooks. SSR-safe. */
export function FlareboardProvider({ config, client = flareboard, children }: FlareboardProviderProps) {
  useEffect(() => {
    if (config) client.init(config);
    // The tracker loads once per page; later config changes are ignored on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  return <FlareboardContext.Provider value={client}>{children}</FlareboardContext.Provider>;
}

/** The Flareboard client from the nearest provider (or the shared client). */
export function useFlareboard(): FlareboardClient {
  return useContext(FlareboardContext);
}

function useFlagSnapshot(client: FlareboardClient) {
  const store = client.featureFlags;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * A flag's value, re-rendering when flags load or change. Returns `fallback` (default
 * `undefined`) until flags have loaded, so render a neutral state for `undefined`. Records a
 * `$feature_flag_called` exposure once the value is known, like `getFeatureFlag`.
 */
export function useFeatureFlag(key: string, fallback?: FlagValue): FlagValue | undefined {
  const client = useFlareboard();
  const snapshot = useFlagSnapshot(client);
  const value = flagFromSnapshot(snapshot, key, fallback);
  const known = snapshot.loaded && Object.prototype.hasOwnProperty.call(snapshot.variants, key);
  useEffect(() => {
    if (known) client.getFeatureFlag(key);
  }, [client, key, known]);
  return value;
}

/** The payload attached to the flag's assigned variant (or to an enabled boolean flag). */
export function useFeatureFlagPayload<T = unknown>(key: string): T | undefined {
  const client = useFlareboard();
  return useFlagSnapshot(client).payloads[key] as T | undefined;
}

export type { FlareboardClient } from './client.js';
export type { FlagValue, FlareboardConfig } from './types.js';
