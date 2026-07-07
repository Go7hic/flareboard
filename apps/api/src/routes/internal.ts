import { Hono } from 'hono';
import type { Env } from '../env';
import { backfillActionTags } from '../lib/action-backfill';
import { sendEmail } from '../lib/email';
import { json } from '../lib/response';

const app = new Hono<{ Bindings: Env }>();

function timingSafeEqualString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function isAuthorized(secret: string, header: string | undefined) {
  if (!header?.startsWith('Bearer ')) return false;
  return timingSafeEqualString(header.slice('Bearer '.length), secret);
}

app.post('/deliver-email', async (c) => {
  if (!isAuthorized(c.env.APP_SECRET, c.req.header('Authorization'))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{ to?: string; subject?: string; text?: string; html?: string }>();
  const to = body.to?.trim();
  const subject = body.subject?.trim();
  const text = body.text?.trim();
  if (!to || !subject || !text) {
    return json({ error: 'to, subject, and text are required' }, 400);
  }

  const ok = await sendEmail(c.env, {
    to,
    subject,
    text,
    html: body.html?.trim() || `<p>${text}</p>`,
  });

  return json({ ok });
});

app.post('/backfill-action-tags', async (c) => {
  if (!isAuthorized(c.env.APP_SECRET, c.req.header('Authorization'))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{
    websiteId?: string;
    startAt?: number;
    endAt?: number;
    limit?: number;
    dryRun?: boolean;
  }>();

  const websiteId = body.websiteId?.trim();
  const startAt = Number(body.startAt);
  const endAt = Number(body.endAt);
  if (!websiteId || !Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    return json({ error: 'websiteId, startAt, and endAt are required' }, 400);
  }

  const result = await backfillActionTags(c.env, {
    websiteId,
    startAt,
    endAt,
    limit: body.limit,
    dryRun: body.dryRun,
  });

  return json(result);
});

export default app;
