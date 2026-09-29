import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  timingSafeEqualString,
  totp,
  totpStep,
  verifyTotp,
  type TotpAlgorithm,
} from '../../src/lib/totp';
import { summarizeUserAgent } from '../../src/lib/user-sessions';

const ascii = (value: string) => new TextEncoder().encode(value);

/** RFC 6238 appendix B: seeds per algorithm and the expected 8-digit codes. */
const SEEDS: Record<TotpAlgorithm, Uint8Array> = {
  'SHA-1': ascii('12345678901234567890'),
  'SHA-256': ascii('12345678901234567890123456789012'),
  'SHA-512': ascii('1234567890123456789012345678901234567890123456789012345678901234'),
};
const VECTORS: Array<[seconds: number, sha1: string, sha256: string, sha512: string]> = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(VECTORS)('matches the reference vectors at T=%i', async (seconds, sha1, sha256, sha512) => {
    const at = seconds * 1000;
    expect(await totp(SEEDS['SHA-1'], at, { digits: 8, algorithm: 'SHA-1' })).toBe(sha1);
    expect(await totp(SEEDS['SHA-256'], at, { digits: 8, algorithm: 'SHA-256' })).toBe(sha256);
    expect(await totp(SEEDS['SHA-512'], at, { digits: 8, algorithm: 'SHA-512' })).toBe(sha512);
  });

  it('matches RFC 4226 HOTP values for the first counters', async () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    const codes = await Promise.all(expected.map((_, counter) => hotp(SEEDS['SHA-1'], counter)));
    expect(codes).toEqual(expected);
  });

  it('round-trips base32 secrets (RFC 4648 vectors)', () => {
    expect(base32Encode(ascii('foobar'))).toBe('MZXW6YTBOI');
    expect(new TextDecoder().decode(base32Decode('mzxw6ytboi'))).toBe('foobar');
    expect(base32Encode(SEEDS['SHA-1'])).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(() => base32Decode('not base32!')).toThrow();
  });

  it('accepts codes within one step of drift and rejects replays and malformed input', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    const code = (s: number) => hotp(SEEDS['SHA-1'], s);

    expect(await verifyTotp(secret, await code(step), now)).toBe(step);
    expect(await verifyTotp(secret, await code(step - 1), now)).toBe(step - 1);
    expect(await verifyTotp(secret, await code(step + 1), now)).toBe(step + 1);
    expect(await verifyTotp(secret, await code(step - 2), now)).toBeNull();
    expect(await verifyTotp(secret, await code(step + 2), now)).toBeNull();
    // Already used this step (or a later one): refused.
    expect(await verifyTotp(secret, await code(step), now, step)).toBeNull();
    expect(await verifyTotp(secret, await code(step + 1), now, step)).toBe(step + 1);
    expect(await verifyTotp(secret, '12345', now)).toBeNull();
    expect(await verifyTotp(secret, 'abcdef', now)).toBeNull();
    expect(await verifyTotp(secret, ` ${await code(step)} `, now)).toBe(step);
  });

  it('builds an otpauth URI authenticator apps understand', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'ada@example.com');
    expect(uri).toBe(
      'otpauth://totp/Flareboard:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Flareboard&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('compares strings in constant time with correct results', () => {
    expect(timingSafeEqualString('123456', '123456')).toBe(true);
    expect(timingSafeEqualString('123456', '123457')).toBe(false);
    expect(timingSafeEqualString('123456', '1234567')).toBe(false);
    expect(timingSafeEqualString('', '')).toBe(true);
  });
});

describe('summarizeUserAgent', () => {
  it('keeps only a coarse browser and OS label', () => {
    expect(
      summarizeUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome on macOS');
    expect(
      summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'),
    ).toBe('Safari on iOS');
    expect(
      summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0'),
    ).toBe('Edge on Windows');
    expect(summarizeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox on Linux');
    expect(summarizeUserAgent('curl/8.7.1')).toBe('curl');
    expect(summarizeUserAgent('')).toBeNull();
    expect(summarizeUserAgent('SomethingElse/1.0')).toBe('Unknown device');
  });
});
