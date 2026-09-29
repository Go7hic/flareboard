import { z } from 'zod';

/**
 * Flareboard API key formats.
 *
 * - Project keys (`fb_pk_…`) are public: they identify a website to ingest (tracking snippets,
 *   PostHog SDKs) and may be embedded in web pages. One per website, rotatable.
 * - Personal keys (`fb_sk_…`) are secrets that authenticate API calls as a user. Only a SHA-256
 *   hash and a short display prefix are stored; the full key is shown once at creation.
 */
export const PROJECT_KEY_PREFIX = 'fb_pk_';
export const PERSONAL_KEY_PREFIX = 'fb_sk_';
export const PROJECT_KEY_RANDOM_LENGTH = 24;
export const PERSONAL_KEY_RANDOM_LENGTH = 32;
/** Characters of a personal key kept for display (`fb_sk_` plus the first four random characters). */
export const PERSONAL_KEY_DISPLAY_LENGTH = PERSONAL_KEY_PREFIX.length + 4;

export const PERSONAL_API_KEY_SCOPES = ['read', 'write'] as const;
export type PersonalApiKeyScope = (typeof PERSONAL_API_KEY_SCOPES)[number];

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Largest multiple of 62 below 256: bytes at or above it are redrawn so every character is equally likely. */
const UNBIASED_BYTE_LIMIT = 248;

const PROJECT_KEY_PATTERN = /^fb_pk_[0-9A-Za-z]{24}$/;
const PERSONAL_KEY_PATTERN = /^fb_sk_[0-9A-Za-z]{32}$/;

/** Uniformly random base62 string from the platform CSPRNG. */
export function randomBase62(length: number): string {
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte >= UNBIASED_BYTE_LIMIT) continue;
      out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export function generateProjectKey(): string {
  return PROJECT_KEY_PREFIX + randomBase62(PROJECT_KEY_RANDOM_LENGTH);
}

export function generatePersonalApiKey(): string {
  return PERSONAL_KEY_PREFIX + randomBase62(PERSONAL_KEY_RANDOM_LENGTH);
}

/** KV entry (shared by API and ingest) caching project key -> website id. Rotation deletes it. */
export function projectKeyCacheKey(key: string): string {
  return `project-key:${key}`;
}

export function isProjectKey(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_KEY_PATTERN.test(value);
}

export function isPersonalApiKey(value: unknown): value is string {
  return typeof value === 'string' && PERSONAL_KEY_PATTERN.test(value);
}

/** Hex SHA-256 of a personal key: the only form in which the secret is stored. */
export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function personalApiKeyDisplayPrefix(key: string): string {
  return key.slice(0, PERSONAL_KEY_DISPLAY_LENGTH);
}

/** Normalizes requested scopes (deduplicated, canonical order); null when empty or unknown. */
export function normalizePersonalApiKeyScopes(scopes: unknown): PersonalApiKeyScope[] | null {
  if (!Array.isArray(scopes)) return null;
  const picked = PERSONAL_API_KEY_SCOPES.filter((scope) => scopes.includes(scope));
  if (!picked.length || picked.length !== new Set(scopes).size) return null;
  return picked;
}

export const createPersonalApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z
    .array(z.string())
    .transform((value, ctx) => {
      const scopes = normalizePersonalApiKeyScopes(value);
      if (!scopes) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'scopes must be a non-empty subset of read, write' });
        return z.NEVER;
      }
      return scopes;
    }),
});
