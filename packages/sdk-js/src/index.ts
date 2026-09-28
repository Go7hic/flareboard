import { createFlareboard, type FlareboardClient } from './client.js';
import type { FlareboardConfig } from './types.js';

export { createFlareboard, scriptSrc, QUEUED_METHODS } from './client.js';
export type { BrowserEnv, FlareboardClient } from './client.js';
export { createFlagStore, flagFromSnapshot, isFlagOn, EMPTY_FLAGS } from './flag-store.js';
export type { FlagSnapshot, FlagStore } from './flag-store.js';
export type * from './types.js';

/** The shared client. Call `flareboard.init({ host, websiteId })` once, as early as you can. */
export const flareboard: FlareboardClient = createFlareboard();

/** Shorthand for `flareboard.init(config)`. */
export function init(config: FlareboardConfig): FlareboardClient {
  return flareboard.init(config);
}

export default flareboard;
