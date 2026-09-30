import { uuid } from '@flareboard/shared';

/**
 * Deterministic ids for everything the demo generator writes (uuid v5 over a fixed namespace
 * string). The same inputs always give the same id, so re-running a step updates or ignores
 * rows instead of duplicating them, and generated rows can be told apart from anything else.
 */
export function demoId(...parts: Array<string | number>): string {
  return uuid('flareboard-demo-data', ...parts.map(String));
}
