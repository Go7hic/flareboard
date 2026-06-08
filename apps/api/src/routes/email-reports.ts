import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { emailReportSchema, getPlan } from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite, canMutateWebsite } from '../lib/access';
import { getUserSubscription, isHostedMode } from '../lib/billing';
import { getWebsiteById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

export async function handleGet(c: Ctx) {
  const websiteId = c.req.param('websiteId');
  if (!websiteId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }

  const db = createDb(c.env.DB);
  const [row] = await db
    .select()
    .from(schema.websiteEmailReport)
    .where(eq(schema.websiteEmailReport.websiteId, websiteId))
    .limit(1);

  return json({
    enabled: row?.enabled ?? false,
    frequency: row?.frequency ?? 'weekly',
    recipientEmail: row?.recipientEmail ?? undefined,
    timezone: row?.timezone ?? 'UTC',
    lastSentAt: row?.lastSentAt ?? undefined,
  });
}

export async function handleUpdate(c: Ctx) {
  const websiteId = c.req.param('websiteId');
  if (!websiteId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = emailReportSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  if (isHostedMode(c.env)) {
    const sub = await getUserSubscription(c.env, c.get('user').userId);
    const plan = getPlan(sub.planId);
    const disabling = parsed.data.enabled === false;
    if (!plan.emailReportsEnabled && !disabling) {
      return json({ message: 'Email reports require a paid plan.' }, 403);
    }
  }

  const now = new Date();
  const db = createDb(c.env.DB);
  const [existing] = await db
    .select()
    .from(schema.websiteEmailReport)
    .where(eq(schema.websiteEmailReport.websiteId, websiteId))
    .limit(1);

  if (existing) {
    await db
      .update(schema.websiteEmailReport)
      .set({
        enabled: parsed.data.enabled,
        frequency: parsed.data.frequency,
        recipientEmail: parsed.data.recipientEmail ?? null,
        timezone: parsed.data.timezone ?? existing.timezone ?? 'UTC',
        updatedAt: now,
      })
      .where(eq(schema.websiteEmailReport.websiteId, websiteId));
  } else {
    await db.insert(schema.websiteEmailReport).values({
      websiteId,
      enabled: parsed.data.enabled,
      frequency: parsed.data.frequency,
      recipientEmail: parsed.data.recipientEmail ?? null,
      timezone: parsed.data.timezone ?? 'UTC',
      createdAt: now,
      updatedAt: now,
    });
  }

  return json({ ok: true });
}
