import type { Context } from 'hono';
import { EVENT_TYPE, getSalt, uuid, visitSalt, type QueueMessage } from '@flareboard/shared';
import type { Env } from '../env';
import { json } from '../lib/response';
import { getLinkBySlug, getPixelBySlug } from '../lib/queries';

const TRANSPARENT_GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0),
);

type Ctx = Context<{ Bindings: Env }>;

async function enqueueLinkHit(env: Env, linkId: string, req: Request) {
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '127.0.0.1';
  const userAgent = req.headers.get('user-agent') ?? '';
  const createdAt = new Date();
  const sessionSalt = getSalt(createdAt);
  const vSalt = visitSalt(createdAt);
  const sessionId = uuid(linkId, ip, userAgent, sessionSalt);
  const visitId = uuid(sessionId, vSalt);
  const eventId = crypto.randomUUID();

  const messages: QueueMessage[] = [
    {
      type: 'session',
      data: {
        id: sessionId,
        websiteId: linkId,
        browser: null,
        os: null,
        device: null,
        language: null,
        country: null,
        region: null,
        city: null,
        createdAt: createdAt.getTime(),
      },
    },
    {
      type: 'event',
      data: {
        id: eventId,
        websiteId: linkId,
        sessionId,
        visitId,
        createdAt: createdAt.getTime(),
        urlPath: '/',
        eventType: EVENT_TYPE.linkEvent,
        eventName: 'redirect',
      },
    },
  ];

  for (const msg of messages) {
    await env.EVENT_QUEUE.send(msg);
  }
}

async function enqueuePixelHit(env: Env, pixelId: string, req: Request) {
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '127.0.0.1';
  const userAgent = req.headers.get('user-agent') ?? '';
  const createdAt = new Date();
  const sessionSalt = getSalt(createdAt);
  const vSalt = visitSalt(createdAt);
  const sessionId = uuid(pixelId, ip, userAgent, sessionSalt);
  const visitId = uuid(sessionId, vSalt);
  const eventId = crypto.randomUUID();

  const messages: QueueMessage[] = [
    {
      type: 'session',
      data: {
        id: sessionId,
        websiteId: pixelId,
        createdAt: createdAt.getTime(),
      },
    },
    {
      type: 'event',
      data: {
        id: eventId,
        websiteId: pixelId,
        sessionId,
        visitId,
        createdAt: createdAt.getTime(),
        urlPath: '/pixel',
        eventType: EVENT_TYPE.pixelEvent,
        eventName: 'view',
      },
    },
  ];

  for (const msg of messages) {
    await env.EVENT_QUEUE.send(msg);
  }
}

export async function handleLinkRedirect(c: Ctx) {
  const slug = c.req.param('slug');
  if (!slug) return json({ message: 'Not found' }, 404);
  const link = await getLinkBySlug(c.env, slug);
  if (!link) return json({ message: 'Not found' }, 404);

  await enqueueLinkHit(c.env, link.linkId, c.req.raw);
  return c.redirect(link.url, 302);
}

export async function handleLinkRedirectApi(c: Ctx) {
  const slug = c.req.param('slug');
  if (!slug) return json({ message: 'Not found' }, 404);
  const link = await getLinkBySlug(c.env, slug);
  if (!link) return json({ message: 'Not found' }, 404);

  await enqueueLinkHit(c.env, link.linkId, c.req.raw);
  return c.redirect(link.url, 302);
}

export async function handlePixelGif(c: Ctx) {
  const slug = c.req.param('slug');
  if (!slug) {
    return new Response(TRANSPARENT_GIF, { headers: { 'Content-Type': 'image/gif' } });
  }
  const pixel = await getPixelBySlug(c.env, slug);
  if (pixel) {
    await enqueuePixelHit(c.env, pixel.pixelId, c.req.raw);
  }

  return new Response(TRANSPARENT_GIF, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
