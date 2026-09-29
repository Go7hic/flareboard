import { describe, expect, it } from 'vitest';
import { alignmentPatternPositions, encodeQr, numDataCodewords, rsRemainder } from './qr';

/** Reads the 15 format bits next to the top-left finder and returns the mask they carry. */
function readMask(size: number, modules: boolean[]) {
  const at = (x: number, y: number) => (modules[y * size + x] ? 1 : 0);
  const bits: number[] = [];
  for (let i = 0; i <= 5; i++) bits[i] = at(8, i);
  bits[6] = at(8, 7);
  bits[7] = at(8, 8);
  bits[8] = at(7, 8);
  for (let i = 9; i < 15; i++) bits[i] = at(14 - i, 8);
  const value = bits.reduce((acc, bit, i) => acc | (bit << i), 0) ^ 0x5412;
  return { ecl: value >>> 13, mask: (value >>> 10) & 7 };
}

describe('encodeQr', () => {
  it('uses level M capacities from the standard', () => {
    // ISO/IEC 18004 table 7, level M data codewords.
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(numDataCodewords)).toEqual([16, 28, 44, 64, 86, 108, 124, 154, 182, 216]);
    expect(alignmentPatternPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPatternPositions(14)).toEqual([6, 26, 46, 66]);
  });

  it('produces Reed–Solomon codewords that divide the generator', () => {
    const data = [0x40, 0xd2, 0x75, 0x47, 0x76, 0x17, 0x32, 0x06, 0x27, 0x26, 0x96, 0xc6, 0xc6, 0x96, 0x70, 0xec];
    const ecc = rsRemainder(data, 10);
    expect(ecc).toHaveLength(10);
    expect(rsRemainder([...data, ...ecc], 10)).toEqual(new Array(10).fill(0));
  });

  it('draws finder patterns, timing and matching format information', () => {
    const qr = encodeQr('otpauth://totp/Flareboard:admin?secret=JBSWY3DPEHPK3PXP&issuer=Flareboard');
    expect(qr.size).toBe(qr.version * 4 + 17);
    const at = (x: number, y: number) => qr.modules[y * qr.size + x];
    for (const [ox, oy] of [
      [0, 0],
      [qr.size - 7, 0],
      [0, qr.size - 7],
    ]) {
      expect(at(ox, oy)).toBe(true);
      expect(at(ox + 1, oy + 1)).toBe(false);
      expect(at(ox + 3, oy + 3)).toBe(true);
    }
    for (let i = 8; i < qr.size - 8; i++) expect(at(i, 6)).toBe(i % 2 === 0);
    expect(at(8, qr.size - 8)).toBe(true);
    expect(readMask(qr.size, qr.modules)).toEqual({ ecl: 0, mask: qr.mask });
  });

  it('picks the smallest version that fits and rejects oversized input', () => {
    expect(encodeQr('hello').version).toBe(1);
    expect(encodeQr('x'.repeat(14)).version).toBe(1);
    expect(encodeQr('x'.repeat(15)).version).toBe(2);
    expect(encodeQr('x'.repeat(412)).version).toBe(15);
    expect(() => encodeQr('x'.repeat(413))).toThrow();
  });
});
