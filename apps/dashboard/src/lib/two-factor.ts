import { ApiError } from './api';
import { t } from './i18n';

/** Base32 secret split into groups of four for manual entry in an authenticator app. */
export function groupSecret(secret: string): string {
  return (secret.replace(/\s+/g, '').match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * Clean up what the user typed: a TOTP code loses its spaces ("123 456" → "123456"), a
 * recovery code is trimmed and lowercased ("ABCDE-FGHIJ " → "abcde-fghij").
 */
export function normalizeTwoFactorCode(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[\s-]/g, '');
  if (/^\d+$/.test(digits)) return digits;
  return trimmed.replace(/\s+/g, '').toLowerCase();
}

/** Six digits: the only format `POST /api/me/2fa/enable` accepts. */
export function isTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/** Plain-text file body for the "Download" button next to freshly issued recovery codes. */
export function recoveryCodesFile(codes: string[], account: string, issuedAt = new Date()): string {
  return [
    t('twoFactorRecoveryFileHeading').replace('{account}', account),
    issuedAt.toISOString(),
    '',
    ...codes,
    '',
    t('twoFactorRecoveryFileNote'),
    '',
  ].join('\n');
}

/**
 * Message for a failed code / password check. `invalid_code` and 429 get friendly copy,
 * a plain 401 (wrong password on disable / password change) gets the password message.
 */
export function twoFactorErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : t('requestFailed');
  if (error.status === 429) return t('twoFactorTooManyAttempts');
  const code = error.data?.code;
  if (code === 'invalid_code') return t('twoFactorInvalidCode');
  if (code === 'challenge_expired') return t('twoFactorChallengeExpired');
  if (code === 'invalid_password' || (error.status === 401 && !code)) return t('securityWrongPassword');
  return error.message || t('requestFailed');
}
