import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  createFeatureFlagSchema,
  evaluateFeatureFlag,
  updateFeatureFlagSchema,
  uuid,
  type FeatureFlagEvaluationContext,
  type FeatureFlagRule,
  type FeatureFlagVariantConfig,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { getFeatureFlagExposureSummary } from '../lib/feature-flags';
import { badRequest, json, notFound } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

type FlagSummary = Awaited<ReturnType<typeof getFeatureFlagExposureSummary>>;

type EvaluateBody = FeatureFlagEvaluationContext & {
  key?: string;
};

function serialize(row: typeof schema.featureFlag.$inferSelect, summary?: FlagSummary) {
  return {
    id: row.flagId,
    websiteId: row.websiteId,
    key: row.key,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    rollout: row.rollout,
    variants: Array.isArray(row.variants) ? row.variants : [],
    targetingRules: Array.isArray(row.targetingRules) ? row.targetingRules : [],
    summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getFlag(env: Env, websiteId: string, flagId: string) {
  const db = createDb(env.DB);
  const [row] = await db
    .select()
    .from(schema.featureFlag)
    .where(eq(schema.featureFlag.flagId, flagId))
    .limit(1);
  if (!row || row.websiteId !== websiteId) return null;
  return row;
}

async function keyExists(env: Env, websiteId: string, key: string, exceptId?: string) {
  const row = await env.DB.prepare(
    `SELECT flag_id as id FROM feature_flag WHERE website_id = ?1 AND key = ?2 LIMIT 1`,
  )
    .bind(websiteId, key)
    .first<{ id: string }>();
  return Boolean(row && row.id !== exceptId);
}

async function getFlagByKey(env: Env, websiteId: string, key: string) {
  const db = createDb(env.DB);
  const [row] = await db
    .select()
    .from(schema.featureFlag)
    .where(and(eq(schema.featureFlag.websiteId, websiteId), eq(schema.featureFlag.key, key)))
    .limit(1);
  if (!row) return null;
  return row;
}

function cleanRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;

  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.featureFlag)
    .where(eq(schema.featureFlag.websiteId, website!.websiteId))
    .orderBy(schema.featureFlag.createdAt);
  const summaries = await Promise.all(
    rows.map((row) => getFeatureFlagExposureSummary(c.env, website!.websiteId, row.key)),
  );
  return json(rows.map((row, index) => serialize(row, summaries[index])));
}

export async function handleCreate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createFeatureFlagSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  if (await keyExists(c.env, website!.websiteId, parsed.data.key)) {
    return badRequest('Feature flag key already exists.');
  }

  const now = new Date();
  const flagId = uuid();
  const db = createDb(c.env.DB);
  await db.insert(schema.featureFlag).values({
    flagId,
    websiteId: website!.websiteId,
    key: parsed.data.key,
    name: parsed.data.name,
    description: parsed.data.description,
    enabled: parsed.data.enabled,
    rollout: parsed.data.rollout,
    variants: parsed.data.variants,
    targetingRules: parsed.data.targetingRules,
    createdAt: now,
    updatedAt: now,
  });

  const row = await getFlag(c.env, website!.websiteId, flagId);
  await c.env.CACHE.delete(`tracker-config:${website!.websiteId}`);
  return json(serialize(row!), 201);
}

export async function handleEvaluate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;

  const body = (await c.req.json().catch(() => null)) as EvaluateBody | null;
  const key = cleanText(body?.key);
  if (!key) return badRequest('Feature flag key is required.');

  const row = await getFlagByKey(c.env, website!.websiteId, key);
  if (!row) return notFound();

  const context: FeatureFlagEvaluationContext = {
    distinctId: cleanText(body?.distinctId),
    userId: cleanText(body?.userId),
    sessionId: cleanText(body?.sessionId),
    visitId: cleanText(body?.visitId),
    anonymousId: cleanText(body?.anonymousId),
    path: cleanText(body?.path),
    url: cleanText(body?.url),
    hostname: cleanText(body?.hostname),
    referrer: cleanText(body?.referrer),
    language: cleanText(body?.language),
    userAgent: cleanText(body?.userAgent),
    environment: cleanText(body?.environment),
    release: cleanText(body?.release),
    groups: cleanRecord(body?.groups),
    properties: cleanRecord(body?.properties),
  };
  const result = evaluateFeatureFlag(
    {
      key: row.key,
      enabled: row.enabled,
      rollout: row.rollout,
      variants: (Array.isArray(row.variants) ? row.variants : []) as FeatureFlagVariantConfig[],
      targetingRules: (Array.isArray(row.targetingRules) ? row.targetingRules : []) as FeatureFlagRule[],
    },
    context,
  );

  return json(result);
}

export async function handleGet(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;

  const row = await getFlag(c.env, website!.websiteId, c.req.param('flagId') ?? '');
  if (!row) return notFound();
  const summary = await getFeatureFlagExposureSummary(c.env, website!.websiteId, row.key);
  return json(serialize(row, summary));
}

export async function handleUpdate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const row = await getFlag(c.env, website!.websiteId, c.req.param('flagId') ?? '');
  if (!row) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateFeatureFlagSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  if (parsed.data.key && (await keyExists(c.env, website!.websiteId, parsed.data.key, row.flagId))) {
    return badRequest('Feature flag key already exists.');
  }

  const db = createDb(c.env.DB);
  await db
    .update(schema.featureFlag)
    .set({
      key: parsed.data.key ?? row.key,
      name: parsed.data.name ?? row.name,
      description: parsed.data.description ?? row.description,
      enabled: parsed.data.enabled ?? row.enabled,
      rollout: parsed.data.rollout ?? row.rollout,
      variants: parsed.data.variants ?? row.variants,
      targetingRules: parsed.data.targetingRules ?? row.targetingRules,
      updatedAt: new Date(),
    })
    .where(eq(schema.featureFlag.flagId, row.flagId));

  const updated = await getFlag(c.env, website!.websiteId, row.flagId);
  await c.env.CACHE.delete(`tracker-config:${website!.websiteId}`);
  return json(serialize(updated!));
}

export async function handleDelete(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const row = await getFlag(c.env, website!.websiteId, c.req.param('flagId') ?? '');
  if (!row) return notFound();

  const db = createDb(c.env.DB);
  await db.delete(schema.featureFlag).where(eq(schema.featureFlag.flagId, row.flagId));
  await c.env.CACHE.delete(`tracker-config:${website!.websiteId}`);
  return json({ ok: true });
}
