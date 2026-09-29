import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  DEFAULT_EXPERIMENT_MDE_PERCENT,
  createExperimentSchema,
  experimentMetricSchema,
  updateExperimentSchema,
  uuid,
  type ExperimentMetric,
} from '@flareboard/shared';
import type { ExperimentAllocation } from '@flareboard/shared/experiment-stats';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { getExperimentResults } from '../lib/experiments';
import {
  fullRolloutConditionGroups,
  invalidateFeatureFlagCaches,
  recordFeatureFlagChange,
} from '../lib/feature-flags';
import { badRequest, json, notFound } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

export type ExperimentRow = {
  experimentId: string;
  websiteId: string;
  featureFlagId: string;
  name: string;
  description: string;
  status: string;
  goalEvent: string;
  primaryMetric: string | null;
  secondaryMetrics: string | null;
  minimumDetectableEffect: number | null;
  allocation: string | null;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
  flagKey?: string | null;
  flagName?: string | null;
  flagEnabled?: number | null;
  flagRollout?: number | null;
  flagVariants?: string | null;
  flagTargetingRules?: string | null;
};

export const EXPERIMENT_COLUMNS = `
       e.experiment_id as experimentId,
       e.website_id as websiteId,
       e.feature_flag_id as featureFlagId,
       e.name,
       e.description,
       e.status,
       e.goal_event as goalEvent,
       e.primary_metric as primaryMetric,
       e.secondary_metrics as secondaryMetrics,
       e.minimum_detectable_effect as minimumDetectableEffect,
       e.allocation,
       e.started_at as startedAt,
       e.ended_at as endedAt,
       e.created_at as createdAt,
       e.updated_at as updatedAt,
       f.key as flagKey,
       f.name as flagName,
       f.enabled as flagEnabled,
       f.rollout as flagRollout,
       f.variants as flagVariants,
       f.targeting_rules as flagTargetingRules`;

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseMetric(value: unknown): ExperimentMetric | null {
  const parsed = experimentMetricSchema.safeParse(parseJson(value));
  return parsed.success ? parsed.data : null;
}

function parseMetrics(value: unknown): ExperimentMetric[] {
  const raw = parseJson(value);
  if (!Array.isArray(raw)) return [];
  return raw.map(parseMetric).filter((metric): metric is ExperimentMetric => metric != null);
}

function primaryMetricOf(row: Pick<ExperimentRow, 'primaryMetric' | 'goalEvent'>): ExperimentMetric {
  return parseMetric(row.primaryMetric) ?? { type: 'conversion', event: row.goalEvent };
}

/** Flag config as the evaluator sees it, from a drizzle row or raw SQL columns. */
function allocationFromFlag(flag: {
  enabled: unknown;
  rollout: unknown;
  variants: unknown;
  targetingRules: unknown;
}): ExperimentAllocation {
  const variants = parseJson(flag.variants);
  const rules = parseJson(flag.targetingRules);
  return {
    enabled: Boolean(flag.enabled),
    rollout: Number.isFinite(Number(flag.rollout)) ? Number(flag.rollout) : 100,
    variants: Array.isArray(variants)
      ? variants
          .filter((variant) => variant && typeof variant === 'object' && typeof variant.key === 'string' && variant.key)
          .map((variant) => ({ key: String(variant.key), weight: Number(variant.weight ?? 0) || 0 }))
      : [],
    targeted: Array.isArray(rules) && rules.length > 0,
  };
}

function parseAllocation(value: unknown): ExperimentAllocation | null {
  const raw = parseJson(value);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return allocationFromFlag({
    enabled: record.enabled,
    rollout: record.rollout,
    variants: record.variants,
    targetingRules: record.targeted ? [true] : [],
  });
}

export function serialize(row: ExperimentRow) {
  const primaryMetric = primaryMetricOf(row);
  return {
    id: row.experimentId,
    websiteId: row.websiteId,
    featureFlagId: row.featureFlagId,
    featureFlagKey: row.flagKey ?? undefined,
    featureFlagName: row.flagName ?? undefined,
    name: row.name,
    description: row.description,
    status: row.status,
    goalEvent: primaryMetric.event,
    primaryMetric,
    secondaryMetrics: parseMetrics(row.secondaryMetrics),
    minimumDetectableEffect: row.minimumDetectableEffect ?? null,
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
    `SELECT ${EXPERIMENT_COLUMNS}
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

/**
 * The window starts the first time the experiment runs and ends when it is completed.
 * Reopening a completed experiment clears the end, so results run up to now again.
 */
function statusDates(
  nextStatus: string,
  previous?: { startedAt: number | Date | null; endedAt: number | Date | null },
) {
  const now = new Date();
  const startedAt = toDate(previous?.startedAt) ?? (nextStatus === 'running' ? now : null);
  const endedAt = nextStatus === 'completed' ? (toDate(previous?.endedAt) ?? now) : null;
  return { startedAt, endedAt };
}

/** Analysis window: [start of the run, or creation for drafts; end, or now]. */
function experimentWindow(row: ExperimentRow, now: number) {
  const startAt = Number(row.startedAt ?? row.createdAt ?? now - 14 * 24 * 60 * 60 * 1000);
  const endAt = Math.max(startAt, Number(row.endedAt ?? now));
  return { startAt, endAt };
}

export async function computeResults(env: Env, websiteId: string, row: ExperimentRow) {
  const now = Date.now();
  const { startAt, endAt } = experimentWindow(row, now);
  const allocation =
    parseAllocation(row.allocation) ??
    allocationFromFlag({
      enabled: row.flagEnabled,
      rollout: row.flagRollout,
      variants: row.flagVariants,
      targetingRules: row.flagTargetingRules,
    });
  return getExperimentResults(env, websiteId, {
    flagKey: row.flagKey!,
    startAt,
    endAt,
    primaryMetric: primaryMetricOf(row),
    secondaryMetrics: parseMetrics(row.secondaryMetrics),
    allocation,
    minimumDetectableEffect: (row.minimumDetectableEffect ?? DEFAULT_EXPERIMENT_MDE_PERCENT) / 100,
    ended: row.endedAt != null,
    now,
  });
}

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;

  const rows = await c.env.DB.prepare(
    `SELECT ${EXPERIMENT_COLUMNS}
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

  const primaryMetric: ExperimentMetric = parsed.data.primaryMetric ?? {
    type: 'conversion',
    event: parsed.data.goalEvent!,
  };
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
    goalEvent: primaryMetric.event,
    primaryMetric,
    secondaryMetrics: parsed.data.secondaryMetrics,
    minimumDetectableEffect: parsed.data.minimumDetectableEffect ?? null,
    allocation: dates.startedAt ? allocationFromFlag(flag) : null,
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
  const dates = statusDates(nextStatus, { startedAt: row.startedAt, endedAt: row.endedAt });
  const currentPrimary = primaryMetricOf(row);
  const primaryMetric: ExperimentMetric =
    parsed.data.primaryMetric ??
    (parsed.data.goalEvent ? { ...currentPrimary, event: parsed.data.goalEvent } : currentPrimary);

  // Capture the split the flag serves when the experiment starts, or when a started
  // experiment moves to another flag. Otherwise keep the captured split (unrelated edits must
  // not freeze a flag config the experiment never ran with).
  const flagChanged = Boolean(flag && flag.flagId !== row.featureFlagId);
  const starting = !row.startedAt && Boolean(dates.startedAt);
  let allocation: ExperimentAllocation | null = parseAllocation(row.allocation);
  if (dates.startedAt && (starting || flagChanged)) {
    const source = flag ?? (await getFlag(c.env, website!.websiteId, row.featureFlagId));
    allocation = source ? allocationFromFlag(source) : allocation;
  }

  const db = createDb(c.env.DB);
  await db
    .update(schema.experiment)
    .set({
      featureFlagId: flag?.flagId ?? row.featureFlagId,
      name: parsed.data.name ?? row.name,
      description: parsed.data.description ?? row.description,
      status: nextStatus,
      goalEvent: primaryMetric.event,
      primaryMetric,
      secondaryMetrics: parsed.data.secondaryMetrics ?? parseMetrics(row.secondaryMetrics),
      minimumDetectableEffect:
        parsed.data.minimumDetectableEffect === undefined
          ? row.minimumDetectableEffect
          : parsed.data.minimumDetectableEffect,
      allocation,
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

  const result = await computeResults(c.env, website!.websiteId, row);
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

  const result = await computeResults(c.env, website!.websiteId, row);
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
      conditionGroups: fullRolloutConditionGroups(flag),
      updatedAt: now,
    })
    .where(eq(schema.featureFlag.flagId, flag.flagId));
  await db
    .update(schema.experiment)
    .set({
      status: 'completed',
      endedAt: row.endedAt ? toDate(row.endedAt) : now,
      // Keep the split the experiment ran with: the flag now serves only the winner.
      allocation: parseAllocation(row.allocation) ?? allocationFromFlag(flag),
      updatedAt: now,
    })
    .where(eq(schema.experiment.experimentId, row.experimentId));
  await invalidateFeatureFlagCaches(c.env, website!.websiteId);

  const [updatedFlag] = await db.select().from(schema.featureFlag).where(eq(schema.featureFlag.flagId, flag.flagId)).limit(1);
  await recordFeatureFlagChange(c.env, c.get('user').userId, 'update', flag, updatedFlag ?? null, {
    experimentId: row.experimentId,
  });
  const updatedExperiment = await getExperiment(c.env, website!.websiteId, row.experimentId);
  return json({
    appliedVariant: winningVariant,
    experiment: serialize(updatedExperiment!),
    featureFlag: serializeFlag(updatedFlag!),
    summary: result.summary,
  });
}
