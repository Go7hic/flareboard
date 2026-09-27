import type { Context } from 'hono';
import type { Env } from '../env';
import { json } from '../lib/response';
import { getLinkBySlug, getPixelBySlug } from '../lib/queries';
import { hitAllowed, recordHit, type HitSource } from '../lib/link-pixel-hits';

const TRANSPARENT_GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0),
);

type Ctx = Context<{ Bindings: Env }>;

/** Records the hit after the response is sent; a failed write never breaks the redirect. */
function trackHit(c: Ctx, source: HitSource, sourceId: string) {
  c.executionCtx.waitUntil(
    (async () => {
      if (!(await hitAllowed(c.env, source, sourceId, c.req.raw))) return;
      await recordHit(c.env, source, sourceId, c.req.raw);
    })().catch((error) => console.error(`${source} hit not recorded`, error)),
  );
}

export async function handleLinkRedirect(c: Ctx) {
  const slug = c.req.param('slug');
  if (!slug) return json({ message: 'Not found' }, 404);
  const link = await getLinkBySlug(c.env, slug);
  if (!link) return json({ message: 'Not found' }, 404);

  trackHit(c, 'link', link.linkId);
  return c.redirect(link.url, 302);
}

export async function handleLinkRedirectApi(c: Ctx) {
  const slug = c.req.param('slug');
  if (!slug) return json({ message: 'Not found' }, 404);
  const link = await getLinkBySlug(c.env, slug);
  if (!link) return json({ message: 'Not found' }, 404);

  trackHit(c, 'link', link.linkId);
  return c.redirect(link.url, 302);
}

export async function handlePixelGif(c: Ctx) {
  const slug = c.req.param('file')?.replace(/\.gif$/, '');
  if (!slug) {
    return new Response(TRANSPARENT_GIF, { headers: { 'Content-Type': 'image/gif' } });
  }
  const pixel = await getPixelBySlug(c.env, slug);
  if (pixel) trackHit(c, 'pixel', pixel.pixelId);

  return new Response(TRANSPARENT_GIF, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
