/**
 * Request body decoding for the PostHog-compatible endpoints. PostHog SDKs send:
 * - plain JSON (posthog-node, posthog-python, most server SDKs),
 * - gzip (`Content-Encoding: gzip`, `?compression=gzip-js`, or a bare gzip body from posthog-js,
 *   which drops the query parameter),
 * - `data=<base64 JSON>` form bodies (posthog-js base64 mode and sendBeacon), or base64 bodies
 *   with `?compression=base64`.
 * The legacy `lz64` encoding is not supported.
 */

/** Raw bytes accepted on the wire (PostHog SDK batches are far smaller). */
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
/** Decoded JSON size; also the ceiling that stops gzip bombs. */
export const MAX_DECODED_BYTES = 8 * 1024 * 1024;
const GZIP_INPUT_SLICE = 8 * 1024;

export class PostHogBodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
  }
}

async function readLimited(stream: ReadableStream<Uint8Array> | null, limit: number, what: string): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  // A failed stream also rejects `closed`; the error is reported through read() below.
  reader.closed.catch(() => {});
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new PostHogBodyError(413, `${what} too large`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function gunzip(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  // Cheap checks first: a gzip member has a 10-byte header (deflate method 8) and ends with the
  // uncompressed size mod 2^32. Honest bombs stop here; lying ones stop at the streaming limit.
  // (workerd also logs an internal rejection when DecompressionStream meets corrupt data.)
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) {
    throw new PostHogBodyError(400, 'Invalid gzip payload');
  }
  const trailerSize = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4).getUint32(0, true);
  if (trailerSize > limit) throw new PostHogBodyError(413, 'Decompressed payload too large');

  const decompressor = new DecompressionStream('gzip');
  const writer = decompressor.writable.getWriter();
  writer.closed.catch(() => {});
  writer.ready.catch(() => {});
  const reader = decompressor.readable.getReader();
  reader.closed.catch(() => {});

  // The runtime does not apply backpressure to the decompressor, so the input goes in small
  // slices, yielding between them so the reader below drains the output and can stop a bomb
  // whose size trailer lies (deflate expands a slice at most ~1000x). Write errors surface on
  // the readable side and are swallowed here so none go unhandled.
  let total = 0;
  let stopped = false;
  const written = (async () => {
    for (let offset = 0; offset < bytes.length && !stopped; offset += GZIP_INPUT_SLICE) {
      await writer.write(bytes.subarray(offset, offset + GZIP_INPUT_SLICE));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (stopped) await writer.abort().catch(() => {});
    else await writer.close();
  })().catch(() => {});

  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        stopped = true;
        await reader.cancel().catch(() => {});
        throw new PostHogBodyError(413, 'Decompressed payload too large');
      }
      chunks.push(value);
    }
  } catch (error) {
    stopped = true;
    if (error instanceof PostHogBodyError) throw error;
    throw new PostHogBodyError(400, 'Invalid gzip payload');
  } finally {
    await written;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const utf8 = new TextDecoder('utf-8');

/** Standard or URL-safe base64, with or without padding (form decoding may turn `+` into spaces). */
export function decodeBase64Utf8(value: string): string {
  let normalized = value.trim().replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  while (normalized.length % 4) normalized += '=';
  let binary: string;
  try {
    binary = atob(normalized);
  } catch {
    throw new PostHogBodyError(400, 'Invalid base64 payload');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return utf8.decode(bytes);
}

function looksLikeJson(text: string) {
  const first = text.trimStart()[0];
  return first === '{' || first === '[';
}

function unsupported(compression: string | null) {
  if (compression === 'lz64' || compression === 'lz-string') {
    throw new PostHogBodyError(400, 'lz64 compression is not supported; use gzip or base64');
  }
}

/** Decodes a PostHog request body to its JSON value. Empty bodies decode to `null`. */
export async function readPostHogBody(req: Request): Promise<unknown> {
  const declared = Number.parseInt(req.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    throw new PostHogBodyError(413, 'Payload too large');
  }
  const url = new URL(req.url);
  const compression = url.searchParams.get('compression')?.toLowerCase() ?? null;
  unsupported(compression);

  let bytes = await readLimited(req.body, MAX_REQUEST_BYTES, 'Payload');
  const gzipped =
    compression === 'gzip' ||
    compression === 'gzip-js' ||
    /\bgzip\b/i.test(req.headers.get('content-encoding') ?? '') ||
    (bytes[0] === 0x1f && bytes[1] === 0x8b);
  if (gzipped && bytes.length) bytes = await gunzip(bytes, MAX_DECODED_BYTES);
  if (bytes.length > MAX_DECODED_BYTES) throw new PostHogBodyError(413, 'Payload too large');

  let text = utf8.decode(bytes);
  if (!text.trim()) return null;

  const contentType = req.headers.get('content-type') ?? '';
  if (/application\/x-www-form-urlencoded/i.test(contentType) || /^data=/.test(text)) {
    const form = new URLSearchParams(text);
    const data = form.get('data');
    if (data == null) throw new PostHogBodyError(400, 'Missing data field');
    const formCompression = form.get('compression')?.toLowerCase() ?? compression;
    unsupported(formCompression);
    text = looksLikeJson(data) ? data : decodeBase64Utf8(data);
  } else if (compression === 'base64' && !looksLikeJson(text)) {
    text = decodeBase64Utf8(text);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new PostHogBodyError(400, 'Invalid JSON');
  }
}
