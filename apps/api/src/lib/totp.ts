/**
 * TOTP (RFC 6238) on Web Crypto. Authenticator apps use SHA-1, 6 digits and 30-second steps;
 * the other algorithms exist for the RFC test vectors.
 */

export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export const TOTP_PERIOD_SEC = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted on either side of the current one, for clock drift. */
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** 160 random bits, the size RFC 4226 recommends for SHA-1. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export function totpStep(nowMs: number, period = TOTP_PERIOD_SEC) {
  return Math.floor(nowMs / 1000 / period);
}

/** HOTP value (RFC 4226) for one counter step. */
export async function hotp(
  secret: Uint8Array,
  counter: number,
  { digits = TOTP_DIGITS, algorithm = 'SHA-1' as TotpAlgorithm } = {},
): Promise<string> {
  const message = new Uint8Array(8);
  let rest = counter;
  for (let i = 7; i >= 0; i--) {
    message[i] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: algorithm }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totp(secret: Uint8Array, nowMs: number, options?: { digits?: number; algorithm?: TotpAlgorithm }) {
  return hotp(secret, totpStep(nowMs), options);
}

/** Compares two strings without an early exit on the first differing character. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/**
 * The time step `code` matches within ±TOTP_WINDOW, or null. Steps at or before
 * `lastUsedStep` are refused so an observed code cannot be replayed.
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number,
  lastUsedStep: number | null = null,
): Promise<number | null> {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(nowMs);
  let matched: number | null = null;
  // Check every candidate step so timing does not reveal which one matched.
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    const expected = await hotp(secret, step);
    if (timingSafeEqualString(expected, normalized) && (lastUsedStep === null || step > lastUsedStep)) {
      matched ??= step;
    }
  }
  return matched;
}

export function otpauthUri(secretBase32: string, account: string, issuer = 'Flareboard') {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
