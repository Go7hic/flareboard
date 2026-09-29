import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  MAX_SUBSCRIPTIONS_PER_TARGET,
  createSubscriptionSchema,
  nextSubscriptionRunAt,
  updateSubscriptionSchema,
  type SubscriptionFrequency,
} from '@flareboard/shared';
import { isValidSiteTimezone } from '@flareboard/shared/timezone';
import type { Env } from '../env';
import { canAccessTeamResource, canAccessWebsite, canMutateTeamResource, canMutateWebsite } from '../lib/access';
import { getWebsiteById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import { serializeSubscription, subscriptionsAllowed } from '../lib/subscriptions';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

type Target = { name: string; websiteId: string | null; timezone: string; canMutate: boolean };

/** The board or insight a subscription points at, as the caller may see it (null = not found). */
async function resolveTarget(c: Ctx, targetType: string, targetId: string): Promise<Target | null> {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  if (targetType === 'board') {
    const [board] = await db.select().from(schema.board).where(eq(schema.board.boardId, targetId)).limit(1);
    if (!board || !(await canAccessTeamResource(c.env, board, user))) return null;
    return { name: board.name, websiteId: null, timezone: 'UTC', canMutate: await canMutateTeamResource(c.env, board, user) };
  }
  if (targetType === 'insight') {
    const [insight] = await db.select().from(schema.insight).where(eq(schema.insight.insightId, targetId)).limit(1);
    const website = insight ? await getWebsiteById(c.env, insight.websiteId) : null;
    if (!insight || !website || !(await canAccessWebsite(c.env, website, user))) return null;
    return {
      name: insight.name,
      websiteId: website.websiteId,
      timezone: website.timezone ?? 'UTC',
      canMutate: await canMutateWebsite(c.env, website, user),
    };
  }
  return null;
}

async function loadSubscription(c: Ctx) {
  const db = createDb(c.env.DB);
  const [row] = await db
    .select()
    .from(schema.reportSubscription)
    .where(eq(schema.reportSubscription.subscriptionId, c.req.param('subscriptionId') ?? ''))
    .limit(1);
  if (!row) return null;
  const target = await resolveTarget(c, row.targetType, row.targetId);
  return target ? { row, target } : null;
}

/** `?targetType=board|insight&targetId=` */
export async function handleList(c: Ctx) {
  const targetType = c.req.query('targetType') ?? '';
  const targetId = c.req.query('targetId') ?? '';
  const target = await resolveTarget(c, targetType, targetId);
  if (!target) return notFound();
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.reportSubscription)
    .where(and(eq(schema.reportSubscription.targetType, targetType), eq(schema.reportSubscription.targetId, targetId)))
    .orderBy(schema.reportSubscription.createdAt);
  return json(rows.map(serializeSubscription));
}

export async function handleCreate(c: Ctx) {
  const parsed = createSubscriptionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid subscription');
  const target = await resolveTarget(c, parsed.data.targetType, parsed.data.targetId);
  if (!target) return notFound();
  if (!target.canMutate) return json({ message: 'Read-only access' }, 403);
  const user = c.get('user');
  if (!(await subscriptionsAllowed(c.env, user.userId))) {
    return json({ message: 'Email subscriptions require a paid plan.' }, 403);
  }
  const timezone = parsed.data.timezone ?? target.timezone;
  if (!isValidSiteTimezone(timezone)) return badRequest('Unknown timezone');

  const db = createDb(c.env.DB);
  const existing = await db
    .select({ id: schema.reportSubscription.subscriptionId })
    .from(schema.reportSubscription)
    .where(
      and(
        eq(schema.reportSubscription.targetType, parsed.data.targetType),
        eq(schema.reportSubscription.targetId, parsed.data.targetId),
      ),
    );
  if (existing.length >= MAX_SUBSCRIPTIONS_PER_TARGET) {
    return json({ message: `At most ${MAX_SUBSCRIPTIONS_PER_TARGET} subscriptions per ${parsed.data.targetType}.` }, 409);
  }

  const now = new Date();
  const subscriptionId = crypto.randomUUID();
  await db.insert(schema.reportSubscription).values({
    subscriptionId,
    websiteId: target.websiteId,
    userId: user.userId,
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    title: parsed.data.title || target.name,
    frequency: parsed.data.frequency,
    weekday: parsed.data.weekday,
    hour: parsed.data.hour,
    timezone,
    recipients: parsed.data.recipients,
    enabled: parsed.data.enabled,
    nextRunAt: nextSubscriptionRunAt(
      { frequency: parsed.data.frequency, hour: parsed.data.hour, weekday: parsed.data.weekday, timezone },
      now.getTime(),
    ),
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db
    .select()
    .from(schema.reportSubscription)
    .where(eq(schema.reportSubscription.subscriptionId, subscriptionId))
    .limit(1);
  return json(serializeSubscription(row!), 201);
}

export async function handleUpdate(c: Ctx) {
  const found = await loadSubscription(c);
  if (!found) return notFound();
  if (!found.target.canMutate) return json({ message: 'Read-only access' }, 403);
  const parsed = updateSubscriptionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid subscription');
  const { row } = found;
  const timezone = parsed.data.timezone ?? row.timezone;
  if (!isValidSiteTimezone(timezone)) return badRequest('Unknown timezone');
  const schedule = {
    frequency: (parsed.data.frequency ?? row.frequency) as SubscriptionFrequency,
    hour: parsed.data.hour ?? row.hour,
    weekday: parsed.data.weekday ?? row.weekday,
    timezone,
  };
  const enabled = parsed.data.enabled ?? row.enabled;
  const scheduleChanged =
    schedule.frequency !== row.frequency ||
    schedule.hour !== row.hour ||
    schedule.weekday !== row.weekday ||
    timezone !== row.timezone ||
    (enabled && !row.enabled);
  const db = createDb(c.env.DB);
  await db
    .update(schema.reportSubscription)
    .set({
      title: parsed.data.title ?? row.title,
      frequency: schedule.frequency,
      hour: schedule.hour,
      weekday: schedule.weekday,
      timezone,
      recipients: parsed.data.recipients ?? row.recipients,
      enabled,
      nextRunAt: scheduleChanged ? nextSubscriptionRunAt(schedule, Date.now()) : row.nextRunAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.reportSubscription.subscriptionId, row.subscriptionId));
  const [updated] = await db
    .select()
    .from(schema.reportSubscription)
    .where(eq(schema.reportSubscription.subscriptionId, row.subscriptionId))
    .limit(1);
  return json(serializeSubscription(updated!));
}

export async function handleDelete(c: Ctx) {
  const found = await loadSubscription(c);
  if (!found) return notFound();
  if (!found.target.canMutate) return json({ message: 'Read-only access' }, 403);
  const db = createDb(c.env.DB);
  await db.delete(schema.reportSubscription).where(eq(schema.reportSubscription.subscriptionId, found.row.subscriptionId));
  return json({ ok: true });
}
