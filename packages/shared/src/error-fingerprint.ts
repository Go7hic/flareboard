/**
 * Error grouping: parses JavaScript stack traces (V8/Chrome, Firefox and Safari formats) and
 * derives a stable issue fingerprint. Ingest stores the result on every error event as the
 * `$exception_fingerprint` property; the API computes the message fallback for older events
 * that were stored before fingerprints existed. Changing the output of any function here
 * regroups every future error, so keep the algorithm versioned (FINGERPRINT_VERSION) and covered
 * by the fixture tests.
 */

export const ERROR_FINGERPRINT_PROPERTY = '$exception_fingerprint';

const FINGERPRINT_VERSION = 'v1';
const MAX_FINGERPRINT_FRAMES = 5;
const MAX_STACK_LINES = 200;

export type StackFrame = {
  /** The line as it appeared in the stack. */
  raw: string;
  functionName: string | null;
  /** Location as it appeared (full URL or path), '' when the frame has none. */
  url: string;
  /** Path without origin, query string or fragment, used to look up source maps. */
  file: string;
  line: number | null;
  column: number | null;
  /** Built-in or eval frame without a usable source location. */
  native: boolean;
};

export type NormalizedFrame = { file: string; function: string };

export type ErrorFingerprintMethod = 'custom' | 'stack' | 'message';

export type ErrorFingerprint = {
  fingerprint: string;
  method: ErrorFingerprintMethod;
  /** The in-app frames that went into a stack fingerprint (empty otherwise). */
  frames: NormalizedFrame[];
};

const V8_FRAME = /^\s*at (?:(.+?) \((.*)\)|(.+))$/;
// `[asyncCause*]functionName@location` — Firefox and Safari.
const GECKO_FRAME = /^(?:([^@*]*)\*)?(.*?)@(.*)$/;
const LOCATION = /^(.*?):(\d+)(?::(\d+))?$/;
const BARE_LOCATION = /^[a-z][a-z0-9+.-]*:\/\/\S+:\d+:\d+$/i;
const EVAL_ORIGIN = /\(([^()]+?):(\d+):(\d+)\)/;
const FIREFOX_EVAL = / line \d+ > (?:eval|Function)$/;

function toNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Path of a frame URL without scheme, host, query string or fragment. */
export function stackFramePath(url: string): string {
  let value = url.trim();
  if (!value) return '';
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)(.*)$/i.exec(value);
  if (scheme) value = scheme[3] ?? '';
  value = value.split(/[?#]/)[0] ?? '';
  try {
    value = decodeURI(value);
  } catch {
    // keep the raw path
  }
  return value.replace(/^\/+/, '').replace(/^\.\//, '');
}

function frameFromLocation(raw: string, functionName: string | null, location: string): StackFrame {
  const trimmed = location.trim();
  const nativeFrame: StackFrame = {
    raw,
    functionName,
    url: '',
    file: '',
    line: null,
    column: null,
    native: true,
  };
  if (!trimmed || trimmed === 'native' || trimmed === '<anonymous>' || trimmed === '[native code]') {
    return nativeFrame;
  }
  if (/^index \d+$/.test(trimmed)) return nativeFrame;

  if (trimmed.startsWith('eval at ')) {
    // `eval at compile (https://x/app.js:1:2), <anonymous>:1:1`: attribute to the evaluating code.
    const origin = EVAL_ORIGIN.exec(trimmed);
    if (!origin) return nativeFrame;
    return {
      raw,
      functionName,
      url: origin[1]!,
      file: stackFramePath(origin[1]!),
      line: null,
      column: null,
      native: false,
    };
  }

  const match = LOCATION.exec(trimmed);
  if (!match) return nativeFrame;
  let url = match[1]!;
  let line = toNumber(match[2]);
  let column = toNumber(match[3]);
  if (FIREFOX_EVAL.test(url)) {
    url = url.replace(FIREFOX_EVAL, '');
    line = null;
    column = null;
  }
  if (!url) return nativeFrame;
  return { raw, functionName, url, file: stackFramePath(url), line, column, native: false };
}

function parseStackLine(line: string): StackFrame | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('at ')) {
    const match = V8_FRAME.exec(trimmed);
    if (!match) return null;
    const [, fn, location, bare] = match;
    return frameFromLocation(line, fn?.trim() || null, location ?? bare ?? '');
  }

  if (trimmed.includes('@')) {
    const match = GECKO_FRAME.exec(trimmed);
    if (match) {
      const [, , fn, location] = match;
      const loc = location?.trim() ?? '';
      if (loc === '[native code]' || LOCATION.test(loc)) {
        return frameFromLocation(line, fn?.trim() || null, loc);
      }
    }
  }

  // Older Safari prints anonymous frames as a bare `url:line:column`.
  if (BARE_LOCATION.test(trimmed)) return frameFromLocation(line, null, trimmed);
  return null;
}

/** Parses V8 (`at fn (url:1:2)`), Firefox and Safari (`fn@url:1:2`) stack traces, innermost frame first. */
export function parseStackTrace(stack: string | null | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n').slice(0, MAX_STACK_LINES)) {
    const frame = parseStackLine(line);
    if (frame) frames.push(frame);
  }
  return frames;
}

const EXTENSION_SCHEMES = new Set([
  'chrome-extension',
  'moz-extension',
  'safari-extension',
  'safari-web-extension',
  'webkit-masked-url',
  'ms-browser-extension',
  'edge-extension',
  'resource',
  'chrome',
]);

/** Third-party script hosts whose frames never belong to the customer's application. */
const THIRD_PARTY_HOSTS = [
  'googletagmanager.com',
  'google-analytics.com',
  'googlesyndication.com',
  'googletagservices.com',
  'doubleclick.net',
  'gstatic.com',
  'apis.google.com',
  'maps.googleapis.com',
  'connect.facebook.net',
  'platform.twitter.com',
  'snap.licdn.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'static.cloudflareinsights.com',
  'challenges.cloudflare.com',
  'js.stripe.com',
  'static.hotjar.com',
  'script.hotjar.com',
  'cdn.segment.com',
  'js.intercomcdn.com',
  'widget.intercom.io',
];

// Bundler chunks that only hold dependencies: `vendor.js`, `vendors~main.js`, `chunk-vendors.js`,
// Next.js `framework-…` / `polyfills-…` / `webpack-…`, webpack `runtime~main.js`.
const VENDOR_CHUNK = /^(?:vendors?|chunk-vendors|framework|polyfills?|runtime|webpack-runtime|webpack)(?:[.\-~_]|$)/i;
// Prebuilt library files: `jquery-3.7.1.min.js`, `react-dom.production.min.js`, `lodash.js`.
const LIBRARY_FILE =
  /^(?:jquery|react-dom|react|vue|angular|lodash|moment|zone|core-js|regenerator-runtime)(?:[.-]\d|\.(?:min|production|development|runtime|global|umd)\b|\.m?js$)/i;

function frameHost(url: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url);
  return match ? match[1]!.toLowerCase() : null;
}

/** True for frames of the customer's own code: not built-in, extension, node_modules, CDN or vendor chunk. */
export function isInAppFrame(frame: StackFrame): boolean {
  if (frame.native || !frame.file) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(frame.url)?.[1]?.toLowerCase();
  if (scheme && EXTENSION_SCHEMES.has(scheme)) return false;
  const path = frame.file.toLowerCase();
  if (path.includes('node_modules/') || path.includes('/vendor/') || path.startsWith('vendor/')) return false;
  const host = frameHost(frame.url);
  if (host && THIRD_PARTY_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return false;
  const basename = frame.file.split('/').pop() ?? frame.file;
  return !VENDOR_CHUNK.test(basename) && !LIBRARY_FILE.test(basename);
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// A quote that opens after a non-word character, so apostrophes in "can't" stay literal.
const QUOTED = /(^|[^\w'"`])(['"`])(?:(?!\2)[^\n]){0,200}\2(?=$|[^\w])/g;
const HEX_LITERAL = /\b0x[0-9a-f]+\b/gi;
// Hex ids such as `3f2a1c9e`, also inside identifiers (`chunk_3f2a1c`); plain words stay.
const HEX_RUN = /(^|[^0-9a-z])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,}(?![0-9a-z])/gi;
const NUMBER = /\d+(?:\.\d+)?/g;

/** Replaces the dynamic parts of an error message (ids, numbers, emails, quoted values). */
export function normalizeErrorMessage(message: string | null | undefined): string {
  return (message ?? '')
    .slice(0, 2000)
    .replace(UUID, '<uuid>')
    .replace(EMAIL, '<email>')
    .replace(QUOTED, '$1<str>')
    .replace(HEX_LITERAL, '<hex>')
    .replace(HEX_RUN, '$1<hex>')
    .replace(NUMBER, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function normalizeIdentifiers(value: string): string {
  return value.replace(UUID, '<uuid>').replace(HEX_LITERAL, '<hex>').replace(HEX_RUN, '$1<hex>').replace(NUMBER, '<n>');
}

/** Content hashes bundlers put in file names (`app.3f2a1c9.js`, `index-C3sPvF1q.js`). */
function stripContentHash(basename: string): string {
  const extension = /(\.(?:m|c)?js|\.jsx|\.tsx?|\.css)$/i.exec(basename)?.[1] ?? '';
  let stem = extension ? basename.slice(0, -extension.length) : basename;
  // webpack/rollup hex hashes: `.3f2a1c9`, `-2f4e8c1a9b`, `_a1b2c3d4` (any position before the extension).
  stem = stem.replace(/[.\-_~](?=[0-9a-f]*\d)[0-9a-f]{6,}(?=$|[.\-_~])/gi, '');
  // Vite/Rollup base64url hashes: `index-C3sPvF1q`, `vendor-BAvLS_R-`.
  stem = stem.replace(/-([A-Za-z0-9_-]{8})$/, (whole, hash: string) =>
    /\d/.test(hash) || /[A-Z].*[A-Z]/.test(hash) || /[_-]/.test(hash) ? '' : whole,
  );
  // Numeric webpack chunk ids and bare `[contenthash].js` names change between builds.
  if (/^(?=.*\d)[0-9a-f]{8,}$/i.test(stem)) stem = '<hash>';
  else stem = stem.replace(/^\d+(?=$|[.\-_~])/, '<n>');
  return `${stem || '<hash>'}${extension}`;
}

function normalizeFramePath(file: string): string {
  const segments = file.split('/').filter(Boolean);
  const basename = segments.pop() ?? '';
  const directories = segments.map((segment) =>
    /^(?=.*\d)[0-9a-f]{8,}$/i.test(segment) || (/^[A-Za-z0-9_-]{16,}$/.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment))
      ? '<hash>'
      : segment,
  );
  return [...directories, stripContentHash(basename)].join('/');
}

function normalizeFunctionName(name: string | null): string {
  let value = (name ?? '').trim();
  value = value.replace(/\s*\[as [^\]]*\]$/, '');
  value = value.replace(/^(?:async|new|bound)\s+/g, '').replace(/^(?:async|new|bound)\s+/g, '');
  // Firefox nesting (`outer/inner`, `outer/<`) and V8 receivers (`Object.onClick`) → last segment.
  const slash = value.lastIndexOf('/');
  if (slash >= 0) value = value.slice(slash + 1);
  const dot = value.lastIndexOf('.');
  if (dot >= 0) value = value.slice(dot + 1);
  value = value.replace(/^<+$/, '');
  if (!value || value === '<anonymous>' || value === 'global code' || value === 'module code' || value === 'eval code') {
    return '<anonymous>';
  }
  return normalizeIdentifiers(value).slice(0, 200);
}

export function normalizeStackFrame(frame: StackFrame): NormalizedFrame {
  return { file: normalizeFramePath(frame.file), function: normalizeFunctionName(frame.functionName) };
}

/**
 * 64-bit non-cryptographic hash (cyrb53 widened to two 32-bit lanes) as 16 hex characters.
 * Deterministic in every JavaScript runtime.
 */
export function hashFingerprint(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function normalizeErrorType(type: string | null | undefined): string {
  return (type ?? '').trim().slice(0, 200) || 'Error';
}

/** Fallback grouping: error type + normalized message. Also used for events stored before fingerprints. */
export function messageFingerprint(type: string | null | undefined, message: string | null | undefined): string {
  return hashFingerprint([FINGERPRINT_VERSION, 'message', normalizeErrorType(type), normalizeErrorMessage(message)].join('\n'));
}

function customFingerprintValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().slice(0, 500) || null;
  if (Array.isArray(value)) {
    const parts = value.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number');
    return parts.length ? parts.join('\n').slice(0, 500) : null;
  }
  return null;
}

/**
 * Issue fingerprint for an error: a caller-supplied `$exception_fingerprint` wins; otherwise the
 * error type plus the top five normalized in-app frames; otherwise the type plus the normalized message.
 */
export function computeErrorFingerprint(input: {
  type?: string | null;
  message?: string | null;
  stack?: string | null;
  custom?: unknown;
}): ErrorFingerprint {
  const custom = customFingerprintValue(input.custom);
  if (custom) {
    return { fingerprint: hashFingerprint([FINGERPRINT_VERSION, 'custom', custom].join('\n')), method: 'custom', frames: [] };
  }

  const frames = parseStackTrace(input.stack)
    .filter(isInAppFrame)
    .slice(0, MAX_FINGERPRINT_FRAMES)
    .map(normalizeStackFrame);
  if (frames.length) {
    const parts = [FINGERPRINT_VERSION, 'stack', normalizeErrorType(input.type), ...frames.map((f) => `${f.file}|${f.function}`)];
    return { fingerprint: hashFingerprint(parts.join('\n')), method: 'stack', frames };
  }

  return { fingerprint: messageFingerprint(input.type, input.message), method: 'message', frames: [] };
}

/** True for fingerprints computed by this module (16 hex characters). */
export function isErrorFingerprint(value: string): boolean {
  return /^[0-9a-f]{16}$/.test(value);
}

export type ExceptionFrameInput = {
  function?: string | null;
  filename?: string | null;
  abs_path?: string | null;
  lineno?: number | null;
  colno?: number | null;
};

/**
 * Renders structured frames (PostHog / Sentry `$exception_list[].stacktrace.frames`, oldest first)
 * as a V8-style stack string, innermost frame first, so it can be sent as the error `stack`.
 */
export function formatStackFromFrames(frames: ExceptionFrameInput[]): string {
  return [...frames]
    .reverse()
    .map((frame) => {
      const location = frame.abs_path || frame.filename || '<anonymous>';
      const position = frame.lineno != null ? `:${frame.lineno}${frame.colno != null ? `:${frame.colno}` : ''}` : '';
      const fn = frame.function?.trim();
      return fn ? `    at ${fn} (${location}${position})` : `    at ${location}${position}`;
    })
    .join('\n');
}
