import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, getSalt, hash, uuid, visitSalt } from './crypto';

describe('crypto helpers', () => {
  it('encrypts and decrypts round-trip', () => {
    const secret = 'my-app-secret';
    const cipher = encrypt('payload-value', secret);
    expect(cipher).not.toBe('payload-value');
    expect(decrypt(cipher, secret)).toBe('payload-value');
  });

  it('hash is deterministic', () => {
    expect(hash('a', 'b')).toBe(hash('a', 'b'));
    expect(hash('a', 'b')).not.toBe(hash('a', 'c'));
  });

  it('uuid is stable for same inputs', () => {
    expect(uuid('site', 'ip', 'ua')).toBe(uuid('site', 'ip', 'ua'));
    expect(uuid('site', 'ip', 'ua')).not.toBe(uuid('site', 'ip', 'other'));
  });

  it('getSalt and visitSalt rotate on calendar boundaries', () => {
    const day1 = new Date('2026-06-01T10:15:00Z');
    const day2 = new Date('2026-06-01T10:45:00Z');
    const nextDay = new Date('2026-06-02T10:00:00Z');
    const nextHour = new Date('2026-06-01T11:05:00Z');
    expect(getSalt(day1, 'day')).toBe(getSalt(day2, 'day'));
    expect(getSalt(day1, 'day')).not.toBe(getSalt(nextDay, 'day'));
    expect(visitSalt(day1)).toBe(visitSalt(day2));
    expect(visitSalt(day1)).not.toBe(visitSalt(nextHour));
  });
});
