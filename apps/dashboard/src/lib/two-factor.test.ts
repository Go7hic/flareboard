import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { auditActionLabel, auditDetail } from './audit-labels';
import { groupSecret, isTotpCode, normalizeTwoFactorCode, recoveryCodesFile, twoFactorErrorMessage } from './two-factor';

describe('two-factor helpers', () => {
  it('groups a base32 secret in fours', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXPAB')).toBe('JBSW Y3DP EHPK 3PXP AB');
    expect(groupSecret('')).toBe('');
  });

  it('normalizes TOTP and recovery codes', () => {
    expect(normalizeTwoFactorCode(' 123 456 ')).toBe('123456');
    expect(normalizeTwoFactorCode('123-456')).toBe('123456');
    expect(normalizeTwoFactorCode(' ABCDE-FGHIJ ')).toBe('abcde-fghij');
    expect(isTotpCode('123456')).toBe(true);
    expect(isTotpCode('12345')).toBe(false);
    expect(isTotpCode('abcde-fghij')).toBe(false);
  });

  it('writes recovery codes one per line', () => {
    const file = recoveryCodesFile(['aaaaa-bbbbb', 'ccccc-ddddd'], 'alice', new Date(0));
    expect(file).toContain('alice');
    expect(file).toContain('\naaaaa-bbbbb\nccccc-ddddd\n');
  });

  it('maps API errors to friendly messages', () => {
    expect(twoFactorErrorMessage(null)).toBeNull();
    expect(twoFactorErrorMessage(new ApiError('bad', 401, { code: 'invalid_code' }))).toBe("That code didn't work. Check it and try again.");
    expect(twoFactorErrorMessage(new ApiError('slow down', 429))).toBe('Too many attempts. Try again later.');
    expect(twoFactorErrorMessage(new ApiError('Current password is incorrect', 401, {}))).toBe('That password is incorrect.');
    expect(twoFactorErrorMessage(new ApiError('Boom', 500, { code: 'other' }))).toBe('Boom');
  });
});

describe('audit labels', () => {
  it('labels known actions and falls back to entity + action', () => {
    expect(auditActionLabel({ entityType: 'user', action: 'login' })).toBe('Signed in');
    expect(auditActionLabel({ entityType: 'events', action: 'export' })).toBe('Exported data');
    expect(auditActionLabel({ entityType: 'widget', action: 'spin' })).toBe('widget spin');
  });

  it('summarizes metadata', () => {
    expect(auditDetail({ metadata: { method: 'github', twoFactor: true, device: 'Chrome on macOS' } })).toBe(
      'GitHub · with two-factor · Chrome on macOS',
    );
    expect(auditDetail({ metadata: { reason: 'two_factor' } })).toBe('Wrong two-factor code');
    expect(auditDetail({ metadata: { provider: 'google' } })).toBe('Google');
    expect(auditDetail({ metadata: null })).toBe('');
  });
});
