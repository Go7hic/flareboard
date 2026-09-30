/**
 * Deterministic randomness for the demo data generator. Every stream is seeded from a string
 * (website, hour, purpose), so generating the same hour twice yields byte-identical rows.
 */

/** 32-bit FNV-1a, then mixed: a well-spread seed from any string. */
export function seedOf(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** 0..1 value that depends only on the string (no stream state). */
export function unitHash(value: string): number {
  return seedOf(value) / 4294967296;
}

/** Hex string of `length` characters derived from a string (ids that must look like hex). */
export function hexHash(value: string, length: number): string {
  let out = '';
  let round = 0;
  while (out.length < length) {
    out += seedOf(`${value}#${round++}`).toString(16).padStart(8, '0');
  }
  return out.slice(0, length);
}

export class Rng {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === 'number' ? seed >>> 0 : seedOf(seed);
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** mulberry32: uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Item chosen by weight (`weight` is read from each item). */
  weighted<T extends { weight: number }>(items: readonly T[]): T {
    let total = 0;
    for (const item of items) total += item.weight;
    let roll = this.next() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll < 0) return item;
    }
    return items[items.length - 1]!;
  }

  /** Standard normal (Box-Muller). */
  normal(mean = 0, deviation = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Log-normal around `median` (multiplicative spread `sigma`). */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(this.normal(0, sigma));
  }

  /** Poisson-distributed count (Knuth for small means, normal approximation above 30). */
  poisson(mean: number): number {
    if (mean <= 0) return 0;
    if (mean > 30) return Math.max(0, Math.round(this.normal(mean, Math.sqrt(mean))));
    const limit = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > limit);
    return k - 1;
  }
}
