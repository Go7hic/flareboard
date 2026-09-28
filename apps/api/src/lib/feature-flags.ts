import { and, asc, eq } from 'drizzle-orm';
import {
  createDb,
  loadFlagCohorts,
  loadFlagPerson,
  resolveFlagTargetingContext,
  schema,
} from '@flareboard/db';
import {
  DATA_TYPE,
  EVENT_TYPE,
  evaluateFeatureFlag,
  featureEnrollmentProperty,
  featureFlagTargetingNeeds,
  legacyFeatureFlagColumns,
  normalizeFeatureFlagConfig,
  parseFeatureEnrollment,
  uuid,
  type CohortDefinition,
  type FeatureFlagConditionGroup,
  type FeatureFlagEvaluationContext,
  type FeatureFlagEvaluationResult,
  type FeatureFlagJsonValue,
  type FeatureFlagVariantConfig,
  type NormalizedFeatureFlagConfig,
} from '@flareboard/shared';
import type { Env } from '../env';
import { logAdminAction } from './audit';
import { siteDb } from './site-db';

export type FeatureFlagEvaluationRecord = {
  flagKey: string;
  variant: string | null;
  sessionId: string;
  visitId?: string;
  urlPath?: string;
  release?: string;
  environment?: string;
};

/**
 * Persists a `$feature_flag_called` exposure event for server-side evaluations so
 * they show up in the same call history as client-side tracker exposures.
 */
export async function recordFeatureFlagEvaluation(
  env: Env,
  websiteId: string,
  record: FeatureFlagEvaluationRecord,
) {
  const now = Date.now();
  const eventId = uuid();
  const db = siteDb(env, websiteId);
  const statements = [
    db.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES (?1, ?2, ?3)`,
    ).bind(record.sessionId, websiteId, now),
    db.prepare(
      `INSERT INTO website_event
         (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '$feature_flag_called')`,
    ).bind(
      eventId,
      websiteId,
      record.sessionId,
      record.visitId ?? uuid(),
      now,
      record.urlPath ?? '',
      EVENT_TYPE.customEvent,
    ),
  ];

  const dataEntries: Array<[string, string]> = [['$feature_flag', record.flagKey]];
  if (record.variant) dataEntries.push(['$feature_flag_response', record.variant]);
  if (record.release) dataEntries.push(['release', record.release]);
  if (record.environment) dataEntries.push(['environment', record.environment]);
  for (const [dataKey, value] of dataEntries) {
    statements.push(
      db.prepare(
        `INSERT INTO event_data
           (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(uuid(), websiteId, eventId, dataKey, value, DATA_TYPE.string, now),
    );
  }

  await db.batch(statements);
}

export type FeatureFlagExposureSummary = {
  exposures: number;
  sessions: number;
  lastCalledAt: number | null;
  health: {
    status: 'inactive' | 'healthy' | 'needs_attention';
    dominantVariant: string | null;
    dominantShare: number | null;
    issues: Array<'no_exposures' | 'missing_variant_data' | 'traffic_concentrated'>;
  };
  variants: Array<{ variant: string; exposures: number; sessions: number; percentage: number }>;
  trend: Array<{ date: string; exposures: number; sessions: number }>;
  releases: Array<{ release: string; exposures: number; sessions: number; percentage: number }>;
  environments: Array<{ environment: string; exposures: number; sessions: number; percentage: number }>;
  recent: Array<{
    id: string;
    sessionId: string;
    variant: string | null;
    release: string | null;
    environment: string | null;
    urlPath: string | null;
    createdAt: number;
  }>;
};

function percentage(count: number, total: number) {
  return total ? Math.round((count / total) * 10000) / 100 : 0;
}

export async function getFeatureFlagExposureSummary(
  env: Env,
  websiteId: string,
  flagKey: string,
): Promise<FeatureFlagExposureSummary> {
  const db = siteDb(env, websiteId);
  const row = await db.prepare(
    `SELECT
       COUNT(*) as exposures,
       COUNT(DISTINCT e.session_id) as sessions,
       MAX(e.created_at) as lastCalledAt
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     WHERE e.website_id = ?1
       AND e.event_type = ?3
       AND e.event_name = '$feature_flag_called'`,
  )
    .bind(websiteId, flagKey, EVENT_TYPE.customEvent)
    .first<{ exposures: number; sessions: number; lastCalledAt: number | null }>();

  const variantRows = await db.prepare(
    `SELECT
       response.string_value as variant,
       COUNT(*) as exposures,
       COUNT(DISTINCT e.session_id) as sessions
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     INNER JOIN event_data response
       ON response.website_event_id = e.event_id
      AND response.data_key = '$feature_flag_response'
     WHERE e.website_id = ?1
       AND e.event_type = ?3
       AND e.event_name = '$feature_flag_called'
     GROUP BY response.string_value
     ORDER BY exposures DESC, response.string_value ASC`,
  )
    .bind(websiteId, flagKey, EVENT_TYPE.customEvent)
    .all<{ variant: string; exposures: number; sessions: number }>();

  const recentRows = await db.prepare(
    `SELECT e.event_id as id,
            e.session_id as sessionId,
            e.url_path as urlPath,
            e.created_at as createdAt,
            response.string_value as variant,
            release.string_value as release,
            environment.string_value as environment
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     LEFT JOIN event_data response
       ON response.website_event_id = e.event_id
      AND response.data_key = '$feature_flag_response'
     LEFT JOIN event_data release
       ON release.website_event_id = e.event_id
      AND release.data_key = 'release'
     LEFT JOIN event_data environment
       ON environment.website_event_id = e.event_id
      AND environment.data_key = 'environment'
     WHERE e.website_id = ?1
       AND e.event_type = ?3
       AND e.event_name = '$feature_flag_called'
     ORDER BY e.created_at DESC
     LIMIT 10`,
  )
    .bind(websiteId, flagKey, EVENT_TYPE.customEvent)
    .all<{
      id: string;
      sessionId: string;
      urlPath: string | null;
      createdAt: number;
      variant: string | null;
      release: string | null;
      environment: string | null;
    }>();

  const trendRows = await db.prepare(
    `SELECT date(e.created_at / 1000, 'unixepoch') as date,
            COUNT(*) as exposures,
            COUNT(DISTINCT e.session_id) as sessions
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     WHERE e.website_id = ?1
       AND e.event_type = ?3
       AND e.event_name = '$feature_flag_called'
     GROUP BY date(e.created_at / 1000, 'unixepoch')
     ORDER BY date ASC
     LIMIT 90`,
  )
    .bind(websiteId, flagKey, EVENT_TYPE.customEvent)
    .all<{ date: string; exposures: number; sessions: number }>();

  const releaseRows = await db.prepare(
    `SELECT COALESCE(release.string_value, 'unknown') as release,
            COUNT(*) as exposures,
            COUNT(DISTINCT e.session_id) as sessions
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     LEFT JOIN event_data release
       ON release.website_event_id = e.event_id
      AND release.data_key = 'release'
     WHERE e.website_id = ?1
       AND e.event_type = ?3
       AND e.event_name = '$feature_flag_called'
     GROUP BY COALESCE(release.string_value, 'unknown')
     ORDER BY exposures DESC, release ASC
     LIMIT 10`,
  )
    .bind(websiteId, flagKey, EVENT_TYPE.customEvent)
    .all<{ release: string; exposures: number; sessions: number }>();

  const environmentRows = await db.prepare(
    `SELECT COALESCE(environment.string_value, 'unknown') as environment,
            COUNT(*) as exposures,
            COUNT(DISTINCT e.session_id) as sessions
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     LEFT JOIN event_data environment
       ON environment.website_event_id = e.event_id
      AND environment.data_key = 'environment'
     WHERE e.website_id = ?1
       AND e.event_type = ?3
       AND e.event_name = '$feature_flag_called'
     GROUP BY COALESCE(environment.string_value, 'unknown')
     ORDER BY exposures DESC, environment ASC
     LIMIT 10`,
  )
    .bind(websiteId, flagKey, EVENT_TYPE.customEvent)
    .all<{ environment: string; exposures: number; sessions: number }>();

  const exposures = row?.exposures ?? 0;
  const variants = (variantRows.results ?? []).map((variant) => ({
    ...variant,
    percentage: percentage(variant.exposures, exposures),
  }));
  const dominantVariant = variants[0] ?? null;
  const issues: FeatureFlagExposureSummary['health']['issues'] = [];
  if (!exposures) {
    issues.push('no_exposures');
  } else if (!variants.length) {
    issues.push('missing_variant_data');
  }
  if (variants.length >= 2 && (dominantVariant?.percentage ?? 0) >= 90) {
    issues.push('traffic_concentrated');
  }
  const status: FeatureFlagExposureSummary['health']['status'] = !exposures
    ? 'inactive'
    : issues.length
      ? 'needs_attention'
      : 'healthy';

  return {
    exposures,
    sessions: row?.sessions ?? 0,
    lastCalledAt: row?.lastCalledAt ?? null,
    health: {
      status,
      dominantVariant: dominantVariant?.variant ?? null,
      dominantShare: dominantVariant?.percentage ?? null,
      issues,
    },
    variants,
    trend: trendRows.results ?? [],
    releases: (releaseRows.results ?? []).map((release) => ({
      ...release,
      percentage: percentage(release.exposures, exposures),
    })),
    environments: (environmentRows.results ?? []).map((environment) => ({
      ...environment,
      percentage: percentage(environment.exposures, exposures),
    })),
    recent: recentRows.results ?? [],
  };
}

export type FeatureFlagRow = typeof schema.featureFlag.$inferSelect;

/** Evaluation config of a stored flag (legacy rows resolve to one condition group). */
export function flagConfigFromRow(row: FeatureFlagRow): NormalizedFeatureFlagConfig {
  return normalizeFeatureFlagConfig({
    key: row.key,
    enabled: row.enabled,
    rollout: row.rollout,
    variants: row.variants,
    targetingRules: row.targetingRules,
    conditionGroups: row.conditionGroups,
    payload: row.payload,
    earlyAccess: row.earlyAccess,
  });
}

export type FeatureFlagEarlyAccess = { name: string; description: string };

/** A flag's configuration as the API returns it (and as the change history records it). */
export type SerializedFeatureFlag = {
  id: string;
  websiteId: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  conditionGroups: FeatureFlagConditionGroup[];
  variants: FeatureFlagVariantConfig[];
  payload: FeatureFlagJsonValue | null;
  earlyAccess: FeatureFlagEarlyAccess | null;
  /** @deprecated first condition group's rollout, for clients that predate condition groups. */
  rollout: number;
  /** @deprecated first condition group's conditions, for clients that predate condition groups. */
  targetingRules: FeatureFlagConditionGroup['conditions'];
  createdAt: Date | null;
  updatedAt: Date | null;
};

export function serializeFeatureFlag(row: FeatureFlagRow): SerializedFeatureFlag {
  const config = flagConfigFromRow(row);
  const legacy = legacyFeatureFlagColumns(config.conditionGroups);
  return {
    id: row.flagId,
    websiteId: row.websiteId,
    key: row.key,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    conditionGroups: config.conditionGroups,
    variants: config.variants,
    payload: config.payload,
    earlyAccess: row.earlyAccess
      ? { name: row.earlyAccessName || row.name, description: row.earlyAccessDescription }
      : null,
    rollout: legacy.rollout,
    targetingRules: legacy.targetingRules,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Condition groups once an experiment ships its winning variant: every group at 100% and no
 * variant overrides, so every targeted caller gets the variant the weights now select.
 */
export function fullRolloutConditionGroups(row: FeatureFlagRow): FeatureFlagConditionGroup[] {
  return flagConfigFromRow(row).conditionGroups.map((group) => ({
    conditions: group.conditions,
    rollout: 100,
    ...(group.description ? { description: group.description } : {}),
  }));
}

function flagDefinitionsCacheKey(websiteId: string) {
  return `flag-definitions:v1:${websiteId}`;
}

/**
 * Every write that changes what a flag serves must invalidate the caches built from flags:
 * the tracker config and the SDK definitions.
 */
export async function invalidateFeatureFlagCaches(env: Env, websiteId: string) {
  await Promise.all([
    env.CACHE.delete(`tracker-config:${websiteId}`),
    env.CACHE.delete(flagDefinitionsCacheKey(websiteId)),
  ]);
}

/** Fields whose change is recorded in the flag history (timestamps and legacy mirrors excluded). */
const HISTORY_FIELDS = [
  'key',
  'name',
  'description',
  'enabled',
  'conditionGroups',
  'variants',
  'payload',
  'earlyAccess',
] as const;

type FlagHistoryField = (typeof HISTORY_FIELDS)[number];
type FlagHistorySnapshot = Pick<SerializedFeatureFlag, FlagHistoryField>;

function historySnapshot(row: FeatureFlagRow | null): FlagHistorySnapshot | null {
  if (!row) return null;
  const flag = serializeFeatureFlag(row);
  return {
    key: flag.key,
    name: flag.name,
    description: flag.description,
    enabled: flag.enabled,
    conditionGroups: flag.conditionGroups,
    variants: flag.variants,
    payload: flag.payload,
    earlyAccess: flag.earlyAccess,
  };
}

/**
 * Records a flag create / update / delete in the audit log with the configuration before and
 * after. Updates that change nothing are skipped. The website id is kept in the metadata so the
 * history is erased together with the website (see data-deletion.ts).
 */
export async function recordFeatureFlagChange(
  env: Env,
  userId: string,
  action: 'create' | 'update' | 'delete',
  before: FeatureFlagRow | null,
  after: FeatureFlagRow | null,
  extra: Record<string, unknown> = {},
) {
  const row = after ?? before;
  if (!row) return;
  const beforeSnapshot = historySnapshot(before);
  const afterSnapshot = historySnapshot(after);
  const changes: FlagHistoryField[] = HISTORY_FIELDS.filter(
    (field) => JSON.stringify(beforeSnapshot?.[field] ?? null) !== JSON.stringify(afterSnapshot?.[field] ?? null),
  );
  if (action === 'update' && !changes.length) return;
  await logAdminAction(env, userId, action, 'feature_flag', row.flagId, {
    websiteId: row.websiteId,
    key: row.key,
    changes,
    before: beforeSnapshot,
    after: afterSnapshot,
    ...extra,
  });
}

/** A website's flags, oldest first. `keys` is applied in code (D1 caps bound parameters at 100). */
export async function loadWebsiteFlagRows(env: Env, websiteId: string, keys?: string[]) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.featureFlag)
    .where(eq(schema.featureFlag.websiteId, websiteId))
    .orderBy(asc(schema.featureFlag.createdAt));
  if (!keys?.length) return rows;
  const wanted = new Set(keys);
  return rows.filter((row) => wanted.has(row.key));
}

/** Evaluates flags after loading the person, group and cohort data they target. */
export async function evaluateFeatureFlagConfigs(
  env: Env,
  websiteId: string,
  flags: NormalizedFeatureFlagConfig[],
  context: FeatureFlagEvaluationContext,
): Promise<FeatureFlagEvaluationResult[]> {
  if (!flags.length) return [];
  const resolved = await resolveFlagTargetingContext(
    { db: env.DB, site: siteDb(env, websiteId), cache: env.CACHE },
    websiteId,
    flags,
    context,
  );
  return flags.map((flag) => evaluateFeatureFlag(flag, resolved));
}

export type FeatureFlagEvaluateAllInput = {
  distinctId: string;
  keys?: string[];
  personProperties?: Record<string, unknown>;
  groups?: Record<string, string>;
  groupProperties?: Record<string, Record<string, unknown>>;
  properties?: Record<string, unknown>;
  sessionId?: string;
  userId?: string;
  anonymousId?: string;
  path?: string;
  url?: string;
  hostname?: string;
  referrer?: string;
  language?: string;
  userAgent?: string;
  environment?: string;
  release?: string;
};

export type FeatureFlagDecision = {
  distinctId: string;
  /** PostHog-style values: the variant key for multivariate flags, true / false otherwise. */
  featureFlags: Record<string, string | boolean>;
  /** Payloads of the flags that are on and have one. */
  featureFlagPayloads: Record<string, FeatureFlagJsonValue>;
  /** Full result per flag, with the reason and the condition group that decided it. */
  flags: Record<string, FeatureFlagEvaluationResult>;
};

/**
 * Evaluates every flag of a website (or only `keys`) for one distinct id. Stored person
 * properties are merged under the supplied ones. No exposure events are recorded: SDKs report
 * `$feature_flag_called` when the code actually reads a flag.
 */
export async function evaluateAllFeatureFlags(
  env: Env,
  websiteId: string,
  input: FeatureFlagEvaluateAllInput,
): Promise<FeatureFlagDecision> {
  const keys = input.keys?.length ? [...new Set(input.keys)] : undefined;
  const rows = await loadWebsiteFlagRows(env, websiteId, keys);
  const configs = rows.map(flagConfigFromRow);
  const context: FeatureFlagEvaluationContext = {
    distinctId: input.distinctId,
    userId: input.userId,
    sessionId: input.sessionId,
    anonymousId: input.anonymousId,
    path: input.path,
    url: input.url,
    hostname: input.hostname,
    referrer: input.referrer,
    language: input.language,
    userAgent: input.userAgent,
    environment: input.environment,
    release: input.release,
    groups: input.groups,
    groupProperties: input.groupProperties,
    personProperties: input.personProperties,
    properties: input.properties,
  };
  const results = await evaluateFeatureFlagConfigs(env, websiteId, configs, context);

  const decision: FeatureFlagDecision = {
    distinctId: input.distinctId,
    featureFlags: {},
    featureFlagPayloads: {},
    flags: {},
  };
  results.forEach((result, index) => {
    const config = configs[index];
    decision.flags[config.key] = result;
    decision.featureFlags[config.key] = result.enabled ? (config.variants.length ? String(result.variant) : true) : false;
    if (result.enabled && result.payload !== null) decision.featureFlagPayloads[config.key] = result.payload;
  });
  for (const key of keys ?? []) {
    if (key in decision.flags) continue;
    decision.flags[key] = { ...evaluateFeatureFlag(null), key };
    decision.featureFlags[key] = false;
  }
  return decision;
}

export type FeatureFlagDefinition = {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  conditionGroups: FeatureFlagConditionGroup[];
  variants: FeatureFlagVariantConfig[];
  payload: FeatureFlagJsonValue | null;
  earlyAccess: boolean;
  /** Person property holding an early access opt-in (true) or opt-out (false). */
  enrollmentProperty: string | null;
  /** What local evaluation needs from the caller. */
  requires: { personProperties: boolean; groupTypes: string[]; cohorts: string[] };
  /** False when the flag targets cohorts: those need server evaluation (evaluate-all). */
  localEvaluation: boolean;
};

export type FeatureFlagDefinitions = {
  websiteId: string;
  generatedAt: number;
  /** How SDKs must bucket callers to agree with the server (packages/shared/src/flag-hash.ts). */
  bucketing: {
    hash: 'fnv1a32-mod100';
    bucketingId: string[];
    rollout: string;
    variant: string;
  };
  flags: FeatureFlagDefinition[];
  /** Cohorts referenced by flags. They are behavioural, so SDKs cannot evaluate them locally. */
  cohorts: Record<string, { id: string; name: string; type: 'behavioral'; definition: CohortDefinition }>;
};

/**
 * Definitions for SDK local evaluation: every flag of the website with its condition groups,
 * variants and payloads, plus the cohorts they reference. They contain targeting conditions,
 * so serve them only to authenticated / secret-key callers, never to browsers.
 */
export async function buildFlagDefinitions(env: Env, websiteId: string): Promise<FeatureFlagDefinitions> {
  const rows = await loadWebsiteFlagRows(env, websiteId);
  const configs = rows.map(flagConfigFromRow);
  const cohorts = await loadFlagCohorts(env.DB, websiteId, featureFlagTargetingNeeds(configs).cohortIds);
  return {
    websiteId,
    generatedAt: Date.now(),
    bucketing: {
      hash: 'fnv1a32-mod100',
      bucketingId: ['distinctId', 'userId', 'anonymousId', 'sessionId', 'visitId'],
      rollout: '{flagKey}:{bucketingId}',
      variant: '{flagKey}:variant:{bucketingId}',
    },
    flags: rows.map((row, index) => {
      const config = configs[index];
      const needs = featureFlagTargetingNeeds([config]);
      return {
        id: row.flagId,
        key: row.key,
        name: row.name,
        enabled: config.enabled,
        conditionGroups: config.conditionGroups,
        variants: config.variants,
        payload: config.payload,
        earlyAccess: config.earlyAccess,
        enrollmentProperty: config.earlyAccess ? featureEnrollmentProperty(row.key) : null,
        requires: {
          personProperties: needs.personProperties,
          groupTypes: needs.groupTypes,
          cohorts: needs.cohortIds,
        },
        localEvaluation: needs.cohortIds.length === 0,
      };
    }),
    cohorts: Object.fromEntries(
      [...cohorts.values()].map((cohort) => [
        cohort.id,
        { id: cohort.id, name: cohort.name, type: 'behavioral' as const, definition: cohort.definition },
      ]),
    ),
  };
}

/** Seconds SDK definitions stay cached in KV; flag writes invalidate them right away. */
export const FLAG_DEFINITIONS_CACHE_TTL_SECONDS = 60;

/** buildFlagDefinitions behind a short KV cache, for SDKs that poll definitions. */
export async function getFlagDefinitions(env: Env, websiteId: string): Promise<FeatureFlagDefinitions> {
  const cacheKey = flagDefinitionsCacheKey(websiteId);
  try {
    const cached = await env.CACHE.get<FeatureFlagDefinitions>(cacheKey, 'json');
    if (cached) return cached;
  } catch {
    // Fall through to a fresh build.
  }
  const definitions = await buildFlagDefinitions(env, websiteId);
  try {
    await env.CACHE.put(cacheKey, JSON.stringify(definitions), {
      expirationTtl: FLAG_DEFINITIONS_CACHE_TTL_SECONDS,
    });
  } catch {
    // Best effort.
  }
  return definitions;
}

export type EarlyAccessFeature = {
  flagId: string;
  flagKey: string;
  name: string;
  description: string;
  enabled: boolean;
  /** The person's choice when a distinct id is given: true / false, or null when not set. */
  enrolled?: boolean | null;
};

export async function listEarlyAccessFeatures(
  env: Env,
  websiteId: string,
  distinctId?: string,
): Promise<EarlyAccessFeature[]> {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.featureFlag)
    .where(and(eq(schema.featureFlag.websiteId, websiteId), eq(schema.featureFlag.earlyAccess, true)))
    .orderBy(asc(schema.featureFlag.createdAt));
  const person =
    distinctId && rows.length ? await loadFlagPerson(siteDb(env, websiteId), websiteId, distinctId) : null;
  return rows.map((row) => {
    const feature: EarlyAccessFeature = {
      flagId: row.flagId,
      flagKey: row.key,
      name: row.earlyAccessName || row.name,
      description: row.earlyAccessDescription,
      enabled: row.enabled,
    };
    if (distinctId) {
      feature.enrolled = parseFeatureEnrollment(person?.properties[featureEnrollmentProperty(row.key)]) ?? null;
    }
    return feature;
  });
}
