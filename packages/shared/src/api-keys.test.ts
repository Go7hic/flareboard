import { describe, expect, it } from 'vitest';
import {
  createPersonalApiKeySchema,
  generatePersonalApiKey,
  generateProjectKey,
  hashApiKey,
  isPersonalApiKey,
  isProjectKey,
  normalizePersonalApiKeyScopes,
  personalApiKeyDisplayPrefix,
  randomBase62,
} from './api-keys';

describe('api key formats', () => {
  it('generates project keys as fb_pk_ plus 24 base62 characters', () => {
    const key = generateProjectKey();
    expect(key).toMatch(/^fb_pk_[0-9A-Za-z]{24}$/);
    expect(isProjectKey(key)).toBe(true);
    expect(isPersonalApiKey(key)).toBe(false);
  });

  it('generates personal keys as fb_sk_ plus 32 base62 characters', () => {
    const key = generatePersonalApiKey();
    expect(key).toMatch(/^fb_sk_[0-9A-Za-z]{32}$/);
    expect(isPersonalApiKey(key)).toBe(true);
    expect(isProjectKey(key)).toBe(false);
    expect(personalApiKeyDisplayPrefix(key)).toBe(key.slice(0, 10));
  });

  it('never repeats keys and uses the whole alphabet', () => {
    const keys = new Set(Array.from({ length: 500 }, () => generatePersonalApiKey()));
    expect(keys.size).toBe(500);
    const chars = new Set(randomBase62(20_000));
    expect(chars.size).toBe(62);
  });

  it('rejects lookalikes', () => {
    expect(isProjectKey('fb_pk_short')).toBe(false);
    expect(isProjectKey(`fb_pk_${'a'.repeat(23)}-`)).toBe(false);
    expect(isProjectKey(`fb_pk_${'a'.repeat(25)}`)).toBe(false);
    expect(isProjectKey('00000000-0000-0000-0000-000000000099')).toBe(false);
    expect(isPersonalApiKey(null)).toBe(false);
  });

  it('hashes keys with SHA-256', async () => {
    expect(await hashApiKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('personal key scopes', () => {
  it('normalizes to canonical order without duplicates', () => {
    expect(normalizePersonalApiKeyScopes(['write', 'read', 'write'])).toEqual(['read', 'write']);
    expect(normalizePersonalApiKeyScopes(['read'])).toEqual(['read']);
  });

  it('rejects empty, unknown or malformed scopes', () => {
    expect(normalizePersonalApiKeyScopes([])).toBeNull();
    expect(normalizePersonalApiKeyScopes(['read', 'admin'])).toBeNull();
    expect(normalizePersonalApiKeyScopes('read')).toBeNull();
  });

  it('validates create requests', () => {
    expect(createPersonalApiKeySchema.safeParse({ name: '  CI  ', scopes: ['read'] })).toMatchObject({
      success: true,
      data: { name: 'CI', scopes: ['read'] },
    });
    expect(createPersonalApiKeySchema.safeParse({ name: '', scopes: ['read'] }).success).toBe(false);
    expect(createPersonalApiKeySchema.safeParse({ name: 'x', scopes: ['delete'] }).success).toBe(false);
  });
});
