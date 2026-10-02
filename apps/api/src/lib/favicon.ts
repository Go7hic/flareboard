/**
 * Website favicons for the dashboard, fetched from the site itself — `https://<host>/favicon.ico`,
 * else the icon its home page links to — and cached at the edge. The dashboard used a third-party
 * icon service before; that sent every website's domain elsewhere, and the service now answers
 * with a bot challenge, so no icon ever loaded.
 */

const MAX_ICON_BYTES = 100 * 1024;
const MAX_HTML_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 3000;
const HIT_TTL_S = 7 * 24 * 3600;
const MISS_TTL_S = 24 * 3600;
const CACHE_ORIGIN = 'https://favicon-cache.flareboard.internal';
const USER_AGENT = 'Mozilla/5.0 (compatible; FlareboardFavicon/1.0; +https://flareboard.dev)';
/** A public DNS name: labels of letters, digits and inner hyphens, at least one dot, no IPs. */
const HOST_PATTERN = /^(?=.{4,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z][a-z0-9-]{0,62}(?<!-)$/;

/** Normalizes a stored website domain ("https://Shop.example.com/path") to a fetchable host. */
export function faviconHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .split(/[/?#]/)[0]!
    .split(':')[0]!
    .replace(/\.$/, '');
  if (!HOST_PATTERN.test(host)) return null;
  if (/\.(local|localhost|internal|lan|home|test|invalid)$/.test(host)) return null;
  return host;
}

/** Reads at most `limit` bytes; null when the body is larger (the rest is cancelled). */
async function readCapped(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function get(url: string, accept: string) {
  return fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: accept, 'User-Agent': USER_AGENT },
  }).catch(() => null);
}

async function fetchIcon(url: string): Promise<{ type: string; body: Uint8Array } | null> {
  const res = await get(url, 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8');
  if (!res?.ok) {
    await res?.body?.cancel().catch(() => {});
    return null;
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!type.startsWith('image/') && type !== 'application/octet-stream') {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const body = await readCapped(res.body, MAX_ICON_BYTES);
  // Tiny bodies are 1×1 placeholders or empty files.
  if (!body || body.byteLength < 64) return null;
  return { type: type.startsWith('image/') ? type : 'image/x-icon', body };
}

/** The icon a home page links to (`<link rel="icon">`, then `apple-touch-icon`), as an absolute URL. */
async function linkedIconUrl(host: string): Promise<string | null> {
  const page = await get(`https://${host}/`, 'text/html');
  if (!page?.ok || !(page.headers.get('content-type') ?? '').includes('text/html')) {
    await page?.body?.cancel().catch(() => {});
    return null;
  }
  let icon: string | null = null;
  let touchIcon: string | null = null;
  const rewritten = new HTMLRewriter()
    .on('link[rel][href]', {
      element(element) {
        const rel = (element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
        const href = element.getAttribute('href');
        if (!href) return;
        if (!icon && rel.includes('icon')) icon = href;
        else if (!touchIcon && rel.includes('apple-touch-icon')) touchIcon = href;
      },
    })
    .transform(page);
  const reader = rewritten.body?.getReader();
  let read = 0;
  while (reader && !icon && read < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
  }
  await reader?.cancel().catch(() => {});
  const href = icon ?? touchIcon;
  if (!href) return null;
  try {
    const url = new URL(href, page.url || `https://${host}/`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function iconResponse(icon: { type: string; body: Uint8Array } | null, maxAge: number) {
  const headers = new Headers({
    'Cache-Control': `public, max-age=${maxAge}`,
    // An SVG opened directly must not run scripts on the API origin.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
  if (!icon) return new Response(null, { status: 404, headers });
  headers.set('Content-Type', icon.type);
  return new Response(icon.body, { status: 200, headers });
}

/** The favicon of `host` (cached for a week; misses for a day), or a 404. */
export async function getFavicon(host: string, ctx?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const key = new Request(`${CACHE_ORIGIN}/${host}`);
  const cached = await cache?.match(key);
  if (cached) return cached;

  let icon = await fetchIcon(`https://${host}/favicon.ico`);
  if (!icon) {
    const linked = await linkedIconUrl(host);
    if (linked) icon = await fetchIcon(linked);
  }
  const response = iconResponse(icon, icon ? HIT_TTL_S : MISS_TTL_S);
  if (cache) {
    const store = cache.put(key, response.clone());
    if (ctx) ctx.waitUntil(store);
    else await store;
  }
  return response;
}
