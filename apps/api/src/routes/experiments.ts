import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { createExperimentSchema, statsQuerySchema, updateExperimentSchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { getExperimentResults } from '../lib/experiments';
import { badRequest, json, notFound } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

type ExperimentRow = {
  experimentId: string;
  websiteId: string;
  featureFlagId: string;
  name: string;
  description: string;
  status: string;
  goalEvent: string;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
  flagKey?: string | null;
  flagName?: string | null;
};

function serialize(row: ExperimentRow) {
  return {
    id: row.experimentId,
    websiteId: row.websiteId,
    featureFlagId: row.featureFlagId,
    featureFlagKey: row.flagKey ?? undefined,
    featureFlagName: row.flagName ?? undefined,
    name: row.name,
    description: row.description,
    status: row.status,
    goalEvent: row.goalEvent,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeFlag(row: typeof schema.featureFlag.$inferSelect) {
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getFlag(env: Env, websiteId: string, featureFlagId: string) {
  const db = createDb(env.DB);
  const [row] = await db
    .select()
    .from(schema.featureFlag)
    .where(eq(schema.featureFlag.flagId, featureFlagId))
    .limit(1);
  if (!row || row.websiteId !== websiteId) return null;
  return row;
}

async function getExperiment(env: Env, websiteId: string, experimentId: string) {
  const row = await env.DB.prepare(
    `SELECT
       e.experiment_id as experimentId,
       e.website_id as websiteId,
       e.feature_flag_id as featureFlagId,
       e.name,
       e.description,
       e.status,
       e.goal_event as goalEvent,
       e.started_at as startedAt,
       e.ended_at as endedAt,
       e.created_at as createdAt,
       e.updated_at as updatedAt,
       f.key as flagKey,
       f.name as flagName
     FROM experiment e
     INNER JOIN feature_flag f ON f.flag_id = e.feature_flag_id
     WHERE e.website_id = ?1 AND e.experiment_id = ?2
     LIMIT 1`,
  )
    .bind(websiteId, experimentId)
    .first<ExperimentRow>();
  return row ?? null;
}

function toDate(value: number | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function statusDates(
  nextStatus: string,
  previous?: { status: string; startedAt: number | Date | null; endedAt: number | Date | null },
) {
  const now = new Date();
  return {
    startedAt:
      nextStatus === 'running' && !previous?.startedAt ? now : toDate(previous?.startedAt),
    endedAt:
      nextStatus === 'completed' && !previous?.endedAt ? now : toDate(previous?.endedAt),
  };
}

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;

  const rows = await c.env.DB.prepare(
    `SELECT
       e.experiment_id as experimentId,
       e.website_id as websiteId,
       e.feature_flag_id as featureFlagId,
       e.name,
       e.description,
       e.status,
       e.goal_event as goalEvent,
       e.started_at as startedAt,
       e.ended_at as endedAt,
       e.created_at as createdAt,
       e.updated_at as updatedAt,
       f.key as flagKey,
       f.name as flagName
     FROM experiment e
     INNER JOIN feature_flag f ON f.flag_id = e.feature_flag_id
     WHERE e.website_id = ?1
     ORDER BY e.created_at DESC`,
  )
    .bind(website!.websiteId)
    .all<ExperimentRow>();
  return json((rows.results ?? []).map(serialize));
}

export async function handleCreate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createExperimentSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const flag = await getFlag(c.env, website!.websiteId, parsed.data.featureFlagId);
  if (!flag) return badRequest('Feature flag not found.');

  const now = new Date();
  const dates = statusDates(parsed.data.status);
  const experimentId = uuid();
  const db = createDb(c.env.DB);
  await db.insert(schema.experiment).values({
    experimentId,
    websiteId: website!.websiteId,
    featureFlagId: flag.flagId,
    name: parsed.data.name,
    description: parsed.data.description,
    status: parsed.data.status,
    goalEvent: parsed.data.goalEvent,
    startedAt: dates.startedAt,
    endedAt: dates.endedAt,
    createdAt: now,
    updatedAt: now,
  });

  const row = await getExperiment(c.env, website!.websiteId, experimentId);
  return json(serialize(row!), 201);
}

export async function handleGet(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const row = await getExperiment(c.env, website!.websiteId, c.req.param('experimentId') ?? '');
  if (!row) return notFound();
  return json(serialize(row));
}

export async function handleUpdate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const row = await getExperiment(c.env, website!.websiteId, c.req.param('experimentId') ?? '');
  if (!row) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateExperimentSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const flag = parsed.data.featureFlagId
    ? await getFlag(c.env, website!.websiteId, parsed.data.featureFlagId)
    : null;
  if (parsed.data.featureFlagId && !flag) return badRequest('Feature flag not found.');

  const nextStatus = parsed.data.status ?? row.status;
  const dates = statusDates(nextStatus, {
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  });

  const db = createDb(c.env.DB);
  await db
    .update(schema.experiment)
    .set({
      featureFlagId: flag?.flagId ?? row.featureFlagId,
      name: parsed.data.name ?? row.name,
      description: parsed.data.description ?? row.description,
      status: nextStatus,
      goalEvent: parsed.data.goalEvent ?? row.goalEvent,
      startedAt: dates.startedAt,
      endedAt: dates.endedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.experiment.experimentId, row.experimentId));

  const updated = await getExperiment(c.env, website!.websiteId, row.experimentId);
  return json(serialize(updated!));
}

export async function handleDelete(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const row = await getExperiment(c.env, website!.websiteId, c.req.param('experimentId') ?? '');
  if (!row) return notFound();

  const db = createDb(c.env.DB);
  await db.delete(schema.experiment).where(eq(schema.experiment.experimentId, row.experimentId));
  return json({ ok: true });
}

export async function handleResults(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const row = await getExperiment(c.env, website!.websiteId, c.req.param('experimentId') ?? '');
  if (!row || !row.flagKey) return notFound();

  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 14 * 24 * 60 * 60 * 1000;
  const result = await getExperimentResults(
    c.env,
    website!.websiteId,
    row.flagKey,
    row.goalEvent,
    startAt,
    endAt,
  );
  return json({ experiment: serialize(row), ...result });
}

export async function handleApply(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const row = await getExperiment(c.env, website!.websiteId, c.req.param('experimentId') ?? '');
  if (!row || !row.flagKey) return notFound();
  const flag = await getFlag(c.env, website!.websiteId, row.featureFlagId);
  if (!flag) return notFound();

  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 14 * 24 * 60 * 60 * 1000;
  const result = await getExperimentResults(
    c.env,
    website!.websiteId,
    row.flagKey,
    row.goalEvent,
    startAt,
    endAt,
  );
  const winningVariant = result.summary.significantVariant;
  if (!winningVariant || result.summary.decision !== 'ship_variant') {
    return badRequest('Experiment does not have a significant winning variant.');
  }

  const existingVariants = Array.isArray(flag.variants) ? flag.variants : [];
  const variants = existingVariants.length
    ? existingVariants.map((variant) => ({
        ...variant,
        weight: variant.key === winningVariant ? 100 : 0,
      }))
    : [{ key: winningVariant, name: winningVariant, weight: 100 }];
  const now = new Date();
  const db = createDb(c.env.DB);
  await db
    .update(schema.featureFlag)
    .set({
      enabled: true,
      rollout: 100,
      variants,
      updatedAt: now,
    })
    .where(eq(schema.featureFlag.flagId, flag.flagId));
  await db
    .update(schema.experiment)
    .set({
      status: 'completed',
      endedAt: row.endedAt ? toDate(row.endedAt) : now,
      updatedAt: now,
    })
    .where(eq(schema.experiment.experimentId, row.experimentId));
  await c.env.CACHE.delete(`tracker-config:${website!.websiteId}`);

  const [updatedFlag] = await db.select().from(schema.featureFlag).where(eq(schema.featureFlag.flagId, flag.flagId)).limit(1);
  const updatedExperiment = await getExperiment(c.env, website!.websiteId, row.experimentId);
  return json({
    appliedVariant: winningVariant,
    experiment: serialize(updatedExperiment!),
    featureFlag: serializeFlag(updatedFlag!),
    summary: result.summary,
  });
}
