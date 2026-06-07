/**
 * Regenerate logo-mark.png:
 * 1) Load source PNG
 * 2) First pass: key near-white / low-alpha pixels to fully transparent
 * 3) Content bbox from non-transparent pixels only
 * 4) Extract, pad to square (transparent), resize 512×512 RGBA PNG
 */
import sharp from 'sharp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = join(__dirname, '..');
const defaultSource = join(dashboardRoot, 'src/assets/logo-mark.png');
const source = process.argv[2] ?? defaultSource;

const OUT_SIZE = 512;
const CONTENT_PAD = 16;
/** Pixels with R,G,B all >= this become fully transparent (removes white matte). */
const WHITE_KEY_THRESHOLD = 240;
/** Pixels with alpha below this are cleared in the first pass. */
const ALPHA_LOW_THRESHOLD = 10;

function dematteFirstPass(data, channels) {
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const nearWhite =
      r >= WHITE_KEY_THRESHOLD &&
      g >= WHITE_KEY_THRESHOLD &&
      b >= WHITE_KEY_THRESHOLD;
    if (nearWhite || a < ALPHA_LOW_THRESHOLD) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }
  return data;
}

async function loadDemattedRaw(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  dematteFirstPass(data, info.channels);
  return { data, info };
}

function contentBoundsFromDematted(data, info) {
  const { width, height, channels } = info;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (data[i + 3] > 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error('No logo content detected after first-pass dematte');
  }

  const left = Math.max(0, minX - CONTENT_PAD);
  const top = Math.max(0, minY - CONTENT_PAD);
  const right = Math.min(width - 1, maxX + CONTENT_PAD);
  const bottom = Math.min(height - 1, maxY + CONTENT_PAD);

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
    contentWidth: maxX - minX + 1,
    contentHeight: maxY - minY + 1,
  };
}

function extractRegion(data, info, bounds) {
  const { width, height, channels } = info;
  const { left, top, width: w, height: h } = bounds;
  const out = Buffer.alloc(w * h * channels);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcI = ((top + y) * width + (left + x)) * channels;
      const dstI = (y * w + x) * channels;
      for (let c = 0; c < channels; c++) {
        out[dstI + c] = data[srcI + c];
      }
    }
  }

  return sharp(out, { raw: { width: w, height: h, channels } });
}

async function main() {
  const meta = await sharp(source).metadata();
  const { data, info } = await loadDemattedRaw(source);
  const bounds = contentBoundsFromDematted(data, info);

  console.log(`Source: ${meta.width}x${meta.height}`);
  console.log(`Content: ${bounds.contentWidth}x${bounds.contentHeight}`);
  console.log(
    `Extract: ${bounds.width}x${bounds.height} at (${bounds.left},${bounds.top})`,
  );

  const w = bounds.width;
  const h = bounds.height;
  const side = Math.max(w, h);
  const padLeft = Math.floor((side - w) / 2);
  const padTop = Math.floor((side - h) / 2);

  const padded = await extractRegion(data, info, bounds)
    .extend({
      top: padTop,
      bottom: side - h - padTop,
      left: padLeft,
      right: side - w - padLeft,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const { data: resizedData, info: resizedInfo } = await sharp(padded)
    .resize(OUT_SIZE, OUT_SIZE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  dematteFirstPass(resizedData, resizedInfo.channels);

  const png = await sharp(resizedData, {
    raw: {
      width: resizedInfo.width,
      height: resizedInfo.height,
      channels: resizedInfo.channels,
    },
  })
    .png()
    .toBuffer();

  const outPaths = [
    join(dashboardRoot, 'src/assets/logo-mark.png'),
    join(dashboardRoot, 'public/logo-mark.png'),
  ];

  for (const out of outPaths) {
    await sharp(png).toFile(out);
    console.log(`Wrote ${out}`);
  }

  const verify = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  let nearWhiteOpaque = 0;
  let haloFringe = 0;
  for (let i = 0; i < verify.data.length; i += 4) {
    const r = verify.data[i];
    const g = verify.data[i + 1];
    const b = verify.data[i + 2];
    const a = verify.data[i + 3];
    if (a === 0) transparent++;
    if (
      a > 0 &&
      r >= WHITE_KEY_THRESHOLD &&
      g >= WHITE_KEY_THRESHOLD &&
      b >= WHITE_KEY_THRESHOLD
    ) {
      nearWhiteOpaque++;
    }
    if (a > 0 && a < 255 && r >= 220 && g >= 220 && b >= 220) {
      haloFringe++;
    }
  }

  console.log(
    JSON.stringify({
      strategy: 'first-pass-dematte-then-bbox-pad-square',
      hasAlpha: true,
      whiteKeyThreshold: WHITE_KEY_THRESHOLD,
      alphaLowThreshold: ALPHA_LOW_THRESHOLD,
      sourceSize: `${meta.width}x${meta.height}`,
      contentBBox: `${bounds.contentWidth}x${bounds.contentHeight}`,
      outputSize: `${OUT_SIZE}x${OUT_SIZE}`,
      verifyTransparentPixels: transparent,
      verifyNearWhiteOpaque: nearWhiteOpaque,
      verifyLightSemiTransparentFringe: haloFringe,
    }),
  );

  if (nearWhiteOpaque > 0) {
    console.warn(`Warning: ${nearWhiteOpaque} near-white opaque pixels remain`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
