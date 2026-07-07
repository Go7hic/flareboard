import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema, type Website } from '@flareboard/db';
import { createWebsiteSchema, updateWebsiteSchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite, canMutateTeam, canMutateWebsite, getWebsitePermissions } from '../lib/access';
import { listEntityAuditLog, logAdminAction } from '../lib/audit';
import { getAccessibleWebsites, getWebsiteById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function websiteParam(c: Ctx) {
  const id = c.req.param('websiteId');
  return id || null;
}

function serializeWebsite(website: Website) {
  return {
    id: website.websiteId,
    name: website.name,
    domain: website.domain ?? undefined,
    userId: website.userId,
    teamId: website.teamId ?? undefined,
    resetAt: website.resetAt ?? undefined,
    replayEnabled: website.replayEnabled ?? false,
    replayConfig: website.replayConfig ?? undefined,
    heatmapConfig: website.heatmapConfig ?? undefined,
    goalConfig: website.goalConfig ?? undefined,
    createdAt: website.createdAt,
  };
}

export async function handleList(c: Ctx) {
  const user = c.get('user');
  const websites = await getAccessibleWebsites(c.env, user.userId);
  return json(websites.map(serializeWebsite));
}

export async function handleGet(c: Ctx) {
  const websiteId = websiteParam(c);
  if (!websiteId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  return json(serializeWebsite(website));
}

export async function handlePermissions(c: Ctx) {
  const websiteId = websiteParam(c);
  if (!websiteId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  const permissions = await getWebsitePermissions(c.env, website, c.get('user'));
  return json(permissions);
}

export async function handleAuditLog(c: Ctx) {
  const websiteId = websiteParam(c);
  if (!websiteId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  const page = Math.max(Number(c.req.query('page') ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(c.req.query('pageSize') ?? 50), 1), 100);
  const audit = await listEntityAuditLog(c.env, 'website', website.websiteId, page, pageSize);
  return json(audit);
}

export async function handleCreate(c: Ctx) {
  const body = await c.req.json().catch(() => null);
  const parsed = createWebsiteSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.message);
  }

  const user = c.get('user');
  if (parsed.data.teamId) {
    const allowed = await canMutateTeam(c.env, parsed.data.teamId, user);
    if (!allowed) return json({ message: 'Read-only access' }, 403);
  }

  const { checkWebsiteLimit } = await import('../lib/billing');
  const limit = await checkWebsiteLimit(c.env, user.userId);
  if (!limit.ok) return json({ message: limit.message }, 403);

  const websiteId = parsed.data.id ?? uuid();
  const now = new Date();
  const db = createDb(c.env.DB);

  await db.insert(schema.website).values({
    websiteId,
    name: parsed.data.name,
    domain: parsed.data.domain,
    userId: user.userId,
    teamId: parsed.data.teamId ?? null,
    createdBy: user.userId,
    createdAt: now,
    updatedAt: now,
  });

  await c.env.CACHE.put(`website:${websiteId}`, '1', { expirationTtl: 3600 });
  const website = await getWebsiteById(c.env, websiteId);
  await logAdminAction(c.env, user.userId, 'create', 'website', websiteId, {
    name: parsed.data.name,
    domain: parsed.data.domain ?? null,
    teamId: parsed.data.teamId ?? null,
  });
  return json(serializeWebsite(website!), 201);
}

export async function handleUpdate(c: Ctx) {
  const websiteId = websiteParam(c);
  if (!websiteId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateWebsiteSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.message);
  }

  if (parsed.data.replayEnabled === true) {
    const { getUserSubscription, isHostedMode } = await import('../lib/billing');
    const { getPlan } = await import('@flareboard/shared');
    if (isHostedMode(c.env)) {
      const sub = await getUserSubscription(c.env, c.get('user').userId);
      if (!getPlan(sub.planId).replayEnabled) {
        return json({ message: 'Session replay requires a paid plan.' }, 403);
      }
    }
  }

  if (parsed.data.heatmapConfig?.enabled === true) {
    const { getUserSubscription, isHostedMode } = await import('../lib/billing');
    const { getPlan } = await import('@flareboard/shared');
    if (isHostedMode(c.env)) {
      const sub = await getUserSubscription(c.env, c.get('user').userId);
      if (!getPlan(sub.planId).heatmapsEnabled) {
        return json({ message: 'Heatmaps require a paid plan.' }, 403);
      }
    }
  }

  const db = createDb(c.env.DB);
  await db
    .update(schema.website)
    .set({
      name: parsed.data.name ?? website.name,
      domain: parsed.data.domain ?? website.domain,
      resetAt: parsed.data.resetAt ? new Date(parsed.data.resetAt) : website.resetAt,
      replayEnabled:
        parsed.data.replayEnabled !== undefined ? parsed.data.replayEnabled : website.replayEnabled,
      replayConfig:
        parsed.data.replayConfig !== undefined ? parsed.data.replayConfig : website.replayConfig,
      heatmapConfig:
        parsed.data.heatmapConfig !== undefined ? parsed.data.heatmapConfig : website.heatmapConfig,
      goalConfig:
        parsed.data.goalConfig !== undefined ? parsed.data.goalConfig : website.goalConfig,
      updatedAt: new Date(),
    })
    .where(eq(schema.website.websiteId, website.websiteId));

  const updated = await getWebsiteById(c.env, website.websiteId);
  await logAdminAction(c.env, c.get('user').userId, 'update', 'website', website.websiteId, {
    name: parsed.data.name ?? website.name,
    domain: parsed.data.domain ?? website.domain,
    replayEnabled: parsed.data.replayEnabled ?? website.replayEnabled ?? false,
    heatmapEnabled: parsed.data.heatmapConfig?.enabled ?? undefined,
  });
  return json(serializeWebsite(updated!));
}

export async function handleDelete(c: Ctx) {
  const websiteId = websiteParam(c);
  if (!websiteId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const db = createDb(c.env.DB);
  await db
    .update(schema.website)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.website.websiteId, website.websiteId));

  await c.env.CACHE.delete(`website:${website.websiteId}`);
  await logAdminAction(c.env, c.get('user').userId, 'delete', 'website', website.websiteId, {
    name: website.name,
    domain: website.domain ?? null,
  });
  return json({ ok: true });
}
