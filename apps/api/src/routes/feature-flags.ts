import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createDb, patchPersonProperties, schema } from '@flareboard/db';
import {
  createFeatureFlagSchema,
  featureEnrollmentProperty,
  featureEnrollmentSchema,
  featureFlagEvaluateAllSchema,
  featureFlagTargetingNeeds,
  legacyFeatureFlagColumns,
  serializePayloadColumn,
  updateFeatureFlagSchema,
  uuid,
  type FeatureFlagConditionGroup,
  type FeatureFlagEvaluationContext,
  type FeatureFlagJsonValue,
  type FeatureFlagVariantConfig,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { listEntityAuditLog } from '../lib/audit';
import {
  evaluateAllFeatureFlags,
  evaluateFeatureFlagConfigs,
  flagConfigFromRow,
  getFeatureFlagExposureSummary,
  getFlagDefinitions,
  invalidateFeatureFlagCaches,
  listEarlyAccessFeatures,
  recordFeatureFlagChange,
  recordFeatureFlagEvaluation,
  serializeFeatureFlag,
  type FeatureFlagRow,
} from '../lib/feature-flags';
import { badRequest, json, notFound } from '../lib/response';
import { siteDb } from '../lib/site-db';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

type FlagSummary = Awaited<ReturnType<typeof getFeatureFlagExposureSummary>>;

function serialize(row: FeatureFlagRow, summary?: FlagSummary) {
  return { ...serializeFeatureFlag(row), summary };
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

function firstIssue(error: { issues: Array<{ message: string; path: Array<string | number> }> }) {
  const [issue] = error.issues;
  if (!issue) return 'Invalid request';
  return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

/** Variants as stored: payload kept only when set. */
function storedVariants(variants: FeatureFlagVariantConfig[]): FeatureFlagVariantConfig[] {
  return variants.map((variant) => {
    const stored: FeatureFlagVariantConfig = { key: variant.key, name: variant.name, weight: variant.weight };
    if (variant.payload !== undefined && variant.payload !== null) stored.payload = variant.payload;
    return stored;
  });
}

/** Groups as stored: no empty overrides or descriptions. */
function storedGroups(groups: FeatureFlagConditionGroup[]): FeatureFlagConditionGroup[] {
  return groups.map((group) => {
    const stored: FeatureFlagConditionGroup = { conditions: group.conditions, rollout: group.rollout };
    if (group.variant) stored.variant = group.variant;
    if (group.description?.trim()) stored.description = group.description.trim();
    return stored;
  });
}

/**
 * Checks that only make sense for the whole flag: variant overrides must name a variant, a
 * boolean payload cannot sit next to variants, and cohort conditions must point at a cohort
 * of this website.
 */
async function validateFlagShape(
  env: Env,
  websiteId: string,
  flag: {
    variants: FeatureFlagVariantConfig[];
    conditionGroups: FeatureFlagConditionGroup[];
    payload: FeatureFlagJsonValue | null;
    payloadChanged: boolean;
  },
): Promise<string | null> {
  const variantKeys = new Set(flag.variants.map((variant) => variant.key));
  for (const [index, group] of flag.conditionGroups.entries()) {
    if (group.variant && !variantKeys.has(group.variant)) {
      return `conditionGroups.${index}.variant: unknown variant "${group.variant}"`;
    }
  }
  if (flag.variants.length && flag.payloadChanged && flag.payload !== null) {
    return 'payload: multivariate flags use a payload per variant';
  }
  const cohortIds = featureFlagTargetingNeeds([{ key: '', enabled: true, conditionGroups: flag.conditionGroups }])
    .cohortIds;
  if (cohortIds.length) {
    const rows = await env.DB.prepare(`SELECT cohort_id AS id FROM cohort WHERE website_id = ?1`)
      .bind(websiteId)
      .all<{ id: string }>();
    const found = new Set((rows.results ?? []).map((row) => row.id));
    const missing = cohortIds.find((id) => !found.has(id));
    if (missing) return `Unknown cohort "${missing}"`;
  }
  return null;
}

function evaluationContext(body: Record<string, unknown> | null): FeatureFlagEvaluationContext {
  return {
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
    personProperties: cleanRecord(body?.personProperties),
    groupProperties: cleanRecord(body?.groupProperties) as Record<string, Record<string, unknown>>,
  };
}

async function requireEditor(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return { website: null, response };
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return { website: null, response: json({ message: 'Read-only access' }, 403) };
  }
  return { website: website!, response: null };
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
  const { website, response } = await requireEditor(c);
  if (response) return response;

  const body = await c.req.json().catch(() => null);
  const parsed = createFeatureFlagSchema.safeParse(body);
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  if (await keyExists(c.env, website.websiteId, parsed.data.key)) {
    return badRequest('Feature flag key already exists.');
  }

  const conditionGroups = storedGroups(
    parsed.data.conditionGroups ?? [{ conditions: parsed.data.targetingRules, rollout: parsed.data.rollout }],
  );
  const variants = storedVariants(parsed.data.variants);
  const payload = parsed.data.payload ?? null;
  const invalid = await validateFlagShape(c.env, website.websiteId, {
    variants,
    conditionGroups,
    payload,
    payloadChanged: parsed.data.payload !== undefined,
  });
  if (invalid) return badRequest(invalid);

  const legacy = legacyFeatureFlagColumns(conditionGroups);
  const earlyAccess = parsed.data.earlyAccess ?? null;
  const now = new Date();
  const flagId = uuid();
  const db = createDb(c.env.DB);
  await db.insert(schema.featureFlag).values({
    flagId,
    websiteId: website.websiteId,
    key: parsed.data.key,
    name: parsed.data.name,
    description: parsed.data.description,
    enabled: parsed.data.enabled,
    rollout: legacy.rollout,
    targetingRules: legacy.targetingRules,
    conditionGroups,
    variants,
    payload: serializePayloadColumn(payload),
    earlyAccess: Boolean(earlyAccess),
    earlyAccessName: earlyAccess?.name ?? '',
    earlyAccessDescription: earlyAccess?.description ?? '',
    createdAt: now,
    updatedAt: now,
  });

  const row = await getFlag(c.env, website.websiteId, flagId);
  await recordFeatureFlagChange(c.env, c.get('user').userId, 'create', null, row);
  await invalidateFeatureFlagCaches(c.env, website.websiteId);
  return json(serialize(row!), 201);
}

export async function handleEvaluate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;

  const body = cleanRecord(await c.req.json().catch(() => null));
  const key = cleanText(body.key);
  if (!key) return badRequest('Feature flag key is required.');

  const row = await getFlagByKey(c.env, website!.websiteId, key);
  if (!row) return notFound();

  const context = evaluationContext(body);
  const [result] = await evaluateFeatureFlagConfigs(c.env, website!.websiteId, [flagConfigFromRow(row)], context);

  const sessionId = context.sessionId ?? context.distinctId ?? context.anonymousId;
  if (sessionId) {
    await recordFeatureFlagEvaluation(c.env, website!.websiteId, {
      flagKey: row.key,
      variant: typeof result.variant === 'string' ? result.variant : null,
      sessionId,
      visitId: context.visitId,
      urlPath: context.path,
      release: context.release,
      environment: context.environment,
    });
  }

  return json(result);
}

/**
 * Evaluates every flag (or `keys`) for one distinct id, merging stored person properties
 * under the supplied ones. The API-key `/decide` endpoint wraps `evaluateAllFeatureFlags`.
 */
export async function handleEvaluateAll(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;

  const body = await c.req.json().catch(() => null);
  const parsed = featureFlagEvaluateAllSchema.safeParse(body);
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  return json(await evaluateAllFeatureFlags(c.env, website!.websiteId, parsed.data));
}

/** Flag definitions for SDK local evaluation. */
export async function handleDefinitions(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  return json(await getFlagDefinitions(c.env, website!.websiteId));
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
  const { website, response } = await requireEditor(c);
  if (response) return response;

  const row = await getFlag(c.env, website.websiteId, c.req.param('flagId') ?? '');
  if (!row) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateFeatureFlagSchema.safeParse(body);
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  if (parsed.data.key && (await keyExists(c.env, website.websiteId, parsed.data.key, row.flagId))) {
    return badRequest('Feature flag key already exists.');
  }

  const current = flagConfigFromRow(row);
  let conditionGroups = parsed.data.conditionGroups;
  if (!conditionGroups && (parsed.data.rollout !== undefined || parsed.data.targetingRules !== undefined)) {
    // Legacy single-group shorthand: only unambiguous while the flag has one group.
    if (current.conditionGroups.length > 1) {
      return badRequest('This flag has several condition groups. Update conditionGroups instead.');
    }
    const [first] = current.conditionGroups;
    conditionGroups = [
      {
        ...first,
        conditions: parsed.data.targetingRules ?? first.conditions,
        rollout: parsed.data.rollout ?? first.rollout,
      },
    ];
  }
  const nextGroups = storedGroups(conditionGroups ?? current.conditionGroups);
  const nextVariants = storedVariants(parsed.data.variants ?? current.variants);
  const nextPayload = parsed.data.payload === undefined ? current.payload : parsed.data.payload;
  const invalid = await validateFlagShape(c.env, website.websiteId, {
    variants: nextVariants,
    conditionGroups: nextGroups,
    payload: nextPayload,
    payloadChanged: parsed.data.payload !== undefined,
  });
  if (invalid) return badRequest(invalid);

  const legacy = legacyFeatureFlagColumns(nextGroups);
  const earlyAccess = parsed.data.earlyAccess;
  const db = createDb(c.env.DB);
  await db
    .update(schema.featureFlag)
    .set({
      key: parsed.data.key ?? row.key,
      name: parsed.data.name ?? row.name,
      description: parsed.data.description ?? row.description,
      enabled: parsed.data.enabled ?? row.enabled,
      rollout: legacy.rollout,
      targetingRules: legacy.targetingRules,
      conditionGroups: nextGroups,
      variants: nextVariants,
      payload: serializePayloadColumn(nextPayload),
      ...(earlyAccess === undefined
        ? {}
        : {
            earlyAccess: Boolean(earlyAccess),
            earlyAccessName: earlyAccess?.name ?? '',
            earlyAccessDescription: earlyAccess?.description ?? '',
          }),
      updatedAt: new Date(),
    })
    .where(eq(schema.featureFlag.flagId, row.flagId));

  const updated = await getFlag(c.env, website.websiteId, row.flagId);
  await recordFeatureFlagChange(c.env, c.get('user').userId, 'update', row, updated);
  await invalidateFeatureFlagCaches(c.env, website.websiteId);
  return json(serialize(updated!));
}

export async function handleDelete(c: Ctx) {
  const { website, response } = await requireEditor(c);
  if (response) return response;

  const row = await getFlag(c.env, website.websiteId, c.req.param('flagId') ?? '');
  if (!row) return notFound();

  const experiment = await c.env.DB.prepare(
    `SELECT name FROM experiment WHERE website_id = ?1 AND feature_flag_id = ?2 LIMIT 1`,
  )
    .bind(website.websiteId, row.flagId)
    .first<{ name: string }>();
  if (experiment) {
    return json({ message: `Used by the experiment "${experiment.name}". Delete the experiment first.` }, 409);
  }

  const db = createDb(c.env.DB);
  await db.delete(schema.featureFlag).where(eq(schema.featureFlag.flagId, row.flagId));
  await recordFeatureFlagChange(c.env, c.get('user').userId, 'delete', row, null);
  await invalidateFeatureFlagCaches(c.env, website.websiteId);
  return json({ ok: true });
}

function pageParam(value: string | undefined, fallback: number, max: number) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(number, max);
}

/** Change history of one flag, newest first. Deleted flags keep theirs until the website goes. */
export async function handleHistory(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;

  const flagId = c.req.param('flagId') ?? '';
  const page = pageParam(c.req.query('page'), 1, 10_000);
  const pageSize = pageParam(c.req.query('pageSize'), 20, 100);
  const history = await listEntityAuditLog(c.env, 'feature_flag', flagId, page, pageSize);

  // The flag may be gone; its history still names the website it belonged to.
  const owned =
    Boolean(await getFlag(c.env, website!.websiteId, flagId)) ||
    history.items.some((item) => cleanRecord(item.metadata).websiteId === website!.websiteId);
  if (!owned) return notFound();
  return json(history);
}

export async function handleEarlyAccessList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const distinctId = cleanText(c.req.query('distinctId'));
  return json({ features: await listEarlyAccessFeatures(c.env, website!.websiteId, distinctId) });
}

/**
 * Opts a person in or out of an early access feature. Stored as the person property
 * `$feature_enrollment/<flag key>`, which evaluation reads before the condition groups.
 */
export async function handleEarlyAccessEnrollment(c: Ctx) {
  const { website, response } = await requireEditor(c);
  if (response) return response;

  const row = await getFlagByKey(c.env, website.websiteId, c.req.param('flagKey') ?? '');
  if (!row || !row.earlyAccess) return notFound('Early access feature not found');

  const body = await c.req.json().catch(() => null);
  const parsed = featureEnrollmentSchema.safeParse(body);
  if (!parsed.success) return badRequest(firstIssue(parsed.error));

  const property = featureEnrollmentProperty(row.key);
  await patchPersonProperties(siteDb(c.env, website.websiteId), website.websiteId, parsed.data.distinctId, {
    [property]: parsed.data.enrolled,
  });
  return json({
    flagKey: row.key,
    distinctId: parsed.data.distinctId,
    enrolled: parsed.data.enrolled,
    property,
  });
}
