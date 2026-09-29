/**
 * Minimal QR code encoder (ISO/IEC 18004): byte mode, error correction level M, versions 1–15
 * (up to 412 bytes). Enough for otpauth:// enrollment URIs without pulling in a dependency.
 * Structure follows Project Nayuki's reference implementation (MIT).
 */

export type QrMatrix = {
  /** Modules per side. */
  size: number;
  /** Row-major, `true` = dark. */
  modules: boolean[];
  version: number;
  mask: number;
};

const MAX_VERSION = 15;
/** Level M, indexed by version (index 0 unused). */
const ECC_CODEWORDS_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24];
const NUM_ECC_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10];
/** Format-info bits identifying level M. */
const ECL_M_FORMAT_BITS = 0;

function getBit(value: number, index: number) {
  return ((value >>> index) & 1) !== 0;
}

export function numRawDataModules(version: number) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

export function numDataCodewords(version: number) {
  return Math.floor(numRawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[version]! * NUM_ECC_BLOCKS[version]!;
}

export function alignmentPatternPositions(version: number) {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function rsMultiply(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number) {
  const result: number[] = new Array(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

/** Reed–Solomon error correction codewords for `data` (exported for tests). */
export function rsRemainder(data: number[], degree: number) {
  const divisor = rsDivisor(degree);
  const result: number[] = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i]! ^= rsMultiply(coef, factor);
    });
  }
  return result;
}

function charCountBits(version: number) {
  return version <= 9 ? 8 : 16;
}

function encodeDataCodewords(bytes: Uint8Array, version: number) {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, charCountBits(version));
  for (const byte of bytes) push(byte, 8);
  const capacity = numDataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
    codewords.push(byte);
  }
  return codewords;
}

function addEccAndInterleave(data: number[], version: number) {
  const numBlocks = NUM_ECC_BLOCKS[version]!;
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[version]!;
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, blockEccLen);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      // Skip the padding byte of short blocks.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

class Grid {
  readonly size: number;
  readonly modules: boolean[];
  readonly isFunction: boolean[];

  constructor(size: number) {
    this.size = size;
    this.modules = new Array(size * size).fill(false);
    this.isFunction = new Array(size * size).fill(false);
  }

  get(x: number, y: number) {
    return this.modules[y * this.size + x]!;
  }

  setFunction(x: number, y: number, dark: boolean) {
    this.modules[y * this.size + x] = dark;
    this.isFunction[y * this.size + x] = true;
  }
}

function drawFormatBits(grid: Grid, mask: number) {
  const data = (ECL_M_FORMAT_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const size = grid.size;

  for (let i = 0; i <= 5; i++) grid.setFunction(8, i, getBit(bits, i));
  grid.setFunction(8, 7, getBit(bits, 6));
  grid.setFunction(8, 8, getBit(bits, 7));
  grid.setFunction(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) grid.setFunction(14 - i, 8, getBit(bits, i));

  for (let i = 0; i < 8; i++) grid.setFunction(size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) grid.setFunction(8, size - 15 + i, getBit(bits, i));
  grid.setFunction(8, size - 8, true);
}

function drawVersion(grid: Grid, version: number) {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = getBit(bits, i);
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    grid.setFunction(a, b, dark);
    grid.setFunction(b, a, dark);
  }
}

function drawFunctionPatterns(grid: Grid, version: number) {
  const size = grid.size;
  for (let i = 0; i < size; i++) {
    grid.setFunction(6, i, i % 2 === 0);
    grid.setFunction(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) grid.setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const positions = alignmentPatternPositions(version);
  const last = positions.length - 1;
  positions.forEach((py, i) => {
    positions.forEach((px, j) => {
      // Corners overlapping the finder patterns are skipped.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) grid.setFunction(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    });
  });
  drawFormatBits(grid, 0);
  drawVersion(grid, version);
}

function drawCodewords(grid: Grid, codewords: number[]) {
  const size = grid.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const index = y * size + x;
        if (!grid.isFunction[index] && i < codewords.length * 8) {
          grid.modules[index] = getBit(codewords[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function maskApplies(mask: number, x: number, y: number) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(grid: Grid, mask: number) {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      const index = y * grid.size + x;
      if (!grid.isFunction[index] && maskApplies(mask, x, y)) grid.modules[index] = !grid.modules[index];
    }
  }
}

const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
];

/** Standard penalty score (rules N1–N4) used to pick the most readable mask. */
function penalty(grid: Grid) {
  const size = grid.size;
  let score = 0;
  const line = (index: number, horizontal: boolean) => (k: number) => (horizontal ? grid.get(k, index) : grid.get(index, k));

  for (const horizontal of [true, false]) {
    for (let index = 0; index < size; index++) {
      const at = line(index, horizontal);
      let run = 1;
      for (let k = 1; k <= size; k++) {
        if (k < size && at(k) === at(k - 1)) {
          run++;
          continue;
        }
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
      for (let k = 0; k + 11 <= size; k++) {
        for (const pattern of FINDER_LIKE) {
          if (pattern.every((dark, offset) => at(k + offset) === dark)) score += 40;
        }
      }
    }
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const dark = grid.get(x, y);
      if (dark === grid.get(x + 1, y) && dark === grid.get(x, y + 1) && dark === grid.get(x + 1, y + 1)) score += 3;
    }
  }

  const darkCount = grid.modules.filter(Boolean).length;
  score += Math.floor(Math.abs((darkCount * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

/** Encodes `text` (UTF-8) as a QR code. Throws when it does not fit in version 15. */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= MAX_VERSION && 4 + charCountBits(version) + bytes.length * 8 > numDataCodewords(version) * 8) {
    version++;
  }
  if (version > MAX_VERSION) throw new Error('Text is too long for a QR code');

  const grid = new Grid(version * 4 + 17);
  drawFunctionPatterns(grid, version);
  drawCodewords(grid, addEccAndInterleave(encodeDataCodewords(bytes, version), version));

  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(grid, mask);
    drawFormatBits(grid, mask);
    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    applyMask(grid, mask);
  }
  applyMask(grid, bestMask);
  drawFormatBits(grid, bestMask);

  return { size: grid.size, modules: grid.modules, version, mask: bestMask };
}
