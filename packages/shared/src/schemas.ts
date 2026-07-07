import { z } from 'zod';

export const urlOrPathParam = z.string().max(500);

const vitalMetric = (max: number) => z.coerce.number().nonnegative().max(max).optional();

export type WebVitals = {
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
};

type VitalKey = keyof WebVitals;

function parseVitalValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Resolve Core Web Vitals from top-level payload fields with `data` fallback. */
export function extractWebVitals(payload: {
  lcp?: number;
  inp?: number;
  cls?: number;
  fcp?: number;
  ttfb?: number;
  data?: Record<string, unknown>;
}): WebVitals {
  const fromData = (key: VitalKey) => parseVitalValue(payload.data?.[key]);

  const pick = (key: VitalKey) => parseVitalValue(payload[key]) ?? fromData(key) ?? null;

  return {
    lcp: pick('lcp'),
    inp: pick('inp'),
    cls: pick('cls'),
    fcp: pick('fcp'),
    ttfb: pick('ttfb'),
  };
}

export const sendPayloadSchema = z
  .object({
    website: z.string().uuid().optional(),
    link: z.string().uuid().optional(),
    pixel: z.string().uuid().optional(),
    data: z.record(z.unknown()).optional(),
    hostname: z.string().max(100).optional(),
    language: z.string().max(35).optional(),
    referrer: urlOrPathParam.optional(),
    screen: z.string().max(11).optional(),
    width: z.string().max(20).optional(),
    title: z.string().optional(),
    url: urlOrPathParam.optional(),
    name: z.string().max(50).optional(),
    tag: z.string().max(50).optional(),
    ip: z.string().optional(),
    userAgent: z.string().optional(),
    timestamp: z.coerce.number().int().optional(),
    id: z.string().optional(),
    browser: z.string().optional(),
    os: z.string().optional(),
    device: z.string().optional(),
    lcp: vitalMetric(60000),
    inp: vitalMetric(60000),
    cls: vitalMetric(100),
    fcp: vitalMetric(60000),
    ttfb: vitalMetric(60000),
    revenue: z.coerce.number().optional(),
    currency: z.string().max(10).optional(),
    heatmapType: z.enum(['click', 'scroll']).optional(),
    x: z.coerce.number().int().min(0).max(10000).optional(),
    y: z.coerce.number().int().min(0).max(10000).optional(),
    viewportWidth: z.coerce.number().int().min(1).max(10000).optional(),
    viewportHeight: z.coerce.number().int().min(1).max(10000).optional(),
    scrollDepth: z.coerce.number().int().min(0).max(100).optional(),
    message: z.string().max(1000).optional(),
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
    traceId: z.string().max(200).optional(),
    spanId: z.string().max(200).optional(),
    parentSpanId: z.string().max(200).optional(),
    service: z.string().max(120).optional(),
    operation: z.string().max(200).optional(),
    durationMs: z.coerce.number().int().nonnegative().max(86400000).optional(),
    errorName: z.string().max(200).optional(),
    stack: z.string().max(12000).optional(),
    source: z.string().max(1000).optional(),
    lineno: z.coerce.number().int().min(0).max(10000000).optional(),
    colno: z.coerce.number().int().min(0).max(10000000).optional(),
    severity: z.enum(['fatal', 'error', 'warning', 'info']).optional(),
    handled: z.boolean().optional(),
    release: z.string().max(200).optional(),
    environment: z.string().max(100).optional(),
    provider: z.string().max(80).optional(),
    model: z.string().max(120).optional(),
    inputTokens: z.coerce.number().int().nonnegative().max(10000000).optional(),
    outputTokens: z.coerce.number().int().nonnegative().max(10000000).optional(),
    totalTokens: z.coerce.number().int().nonnegative().max(10000000).optional(),
    costUsd: z.coerce.number().nonnegative().max(1000000).optional(),
    latencyMs: z.coerce.number().int().nonnegative().max(86400000).optional(),
    status: z.enum(['success', 'error']).optional(),
    quality: z.string().max(80).optional(),
    groupType: z.string().min(1).max(80).optional(),
    groupKey: z.string().min(1).max(200).optional(),
  })
  .refine(
    (data) => {
      const keys = [data.website, data.link, data.pixel];
      return keys.filter(Boolean).length === 1;
    },
    { message: 'Exactly one of website, link, or pixel must be provided' },
  );

export const heatmapPayloadSchema = z
  .object({
    website: z.string().uuid(),
    url: urlOrPathParam.optional(),
    hostname: z.string().max(100).optional(),
    kind: z.enum(['click', 'scroll']),
    x: z.coerce.number().int().min(0).max(10000).optional(),
    y: z.coerce.number().int().min(0).max(10000).optional(),
    viewportWidth: z.coerce.number().int().min(1).max(10000).optional(),
    viewportHeight: z.coerce.number().int().min(1).max(10000).optional(),
    scrollDepth: z.coerce.number().int().min(0).max(100).optional(),
    timestamp: z.coerce.number().int().optional(),
  })
  .refine(
    (d) =>
      d.kind === 'scroll'
        ? d.scrollDepth != null
        : d.x != null && d.y != null && d.viewportWidth != null && d.viewportHeight != null,
    { message: 'Click heatmaps require x, y, viewportWidth, viewportHeight; scroll requires scrollDepth' },
  );

export const sendSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('event'), payload: sendPayloadSchema }),
  z.object({ type: z.literal('identify'), payload: sendPayloadSchema }),
  z.object({ type: z.literal('group'), payload: sendPayloadSchema }),
  z.object({ type: z.literal('performance'), payload: sendPayloadSchema }),
  z.object({ type: z.literal('heatmap'), payload: heatmapPayloadSchema }),
  z.object({ type: z.literal('error'), payload: sendPayloadSchema }),
  z.object({ type: z.literal('log'), payload: sendPayloadSchema }),
  z.object({ type: z.literal('ai'), payload: sendPayloadSchema }),
]);

export const batchSchema = z.array(z.record(z.unknown()));

export const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const registerSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  displayName: z.string().max(100).optional(),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const ssoSchema = z.object({
  token: z.string().min(1),
});

export const createTeamWebsiteSchema = z.object({
  name: z.string().max(100),
  domain: z.string().max(500),
});

export const createWebsiteSchema = z.object({
  name: z.string().max(100),
  domain: z.string().max(500),
  shareId: z.string().max(50).nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  id: z.string().uuid().nullable().optional(),
});

export const heatmapConfigSchema = z.object({
  sampleRate: z.number().min(0).max(1).optional(),
  enabled: z.boolean().optional(),
  previewUrl: z.string().max(2000).optional(),
});

export const goalEntrySchema = z.object({
  event: z.string().max(50),
  target: z.coerce.number().int().min(1),
  period: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
});

export const goalConfigSchema = z.object({
  goals: z.array(goalEntrySchema).max(20).default([]),
});

export const featureFlagKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z][a-zA-Z0-9_.:-]*$/, 'Use letters, numbers, dot, colon, underscore, or dash');

export const featureFlagVariantSchema = z.object({
  key: featureFlagKeySchema,
  name: z.string().min(1).max(120),
  weight: z.coerce.number().int().min(0).max(100),
});

const featureFlagVariantsSchema = z.array(featureFlagVariantSchema).max(8).default([]);

export const featureFlagTargetingRuleSchema = z.object({
  field: z.enum([
    'path',
    'url',
    'hostname',
    'referrer',
    'language',
    'userAgent',
    'distinctId',
    'userId',
    'environment',
    'release',
    'group',
    'property',
  ]),
  key: z.string().min(1).max(120).optional(),
  operator: z.enum([
    'equals',
    'contains',
    'starts_with',
    'ends_with',
    'not_equals',
    'not_contains',
    'greater_than',
    'greater_than_or_equal',
    'less_than',
    'less_than_or_equal',
    'exists',
    'not_exists',
  ]),
  value: z.string().max(200).default(''),
}).refine((rule) => (rule.field === 'group' || rule.field === 'property' ? Boolean(rule.key?.trim()) : true), {
  message: 'Group and property rules require a key',
});

const featureFlagTargetingRulesSchema = z.array(featureFlagTargetingRuleSchema).max(12).default([]);

export const createFeatureFlagSchema = z.object({
  key: featureFlagKeySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(''),
  enabled: z.boolean().optional().default(true),
  rollout: z.coerce.number().int().min(0).max(100).optional().default(100),
  variants: featureFlagVariantsSchema.optional().default([]),
  targetingRules: featureFlagTargetingRulesSchema.optional().default([]),
});

export const updateFeatureFlagSchema = z.object({
  key: featureFlagKeySchema.optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  rollout: z.coerce.number().int().min(0).max(100).optional(),
  variants: featureFlagVariantsSchema.optional(),
  targetingRules: featureFlagTargetingRulesSchema.optional(),
});

export const experimentStatusSchema = z.enum(['draft', 'running', 'paused', 'completed']);

export const createExperimentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(''),
  featureFlagId: z.string().uuid(),
  goalEvent: z.string().min(1).max(80),
  status: experimentStatusSchema.optional().default('draft'),
});

export const updateExperimentSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  featureFlagId: z.string().uuid().optional(),
  goalEvent: z.string().min(1).max(80).optional(),
  status: experimentStatusSchema.optional(),
});

export const actionRuleSchema = z.object({
  field: z.enum(['event_name', 'url_path', 'property']),
  key: z.string().min(1).max(120).optional(),
  operator: z.enum(['equals', 'contains', 'starts_with', 'ends_with', 'not_equals', 'not_contains']),
  value: z.string().min(1).max(500),
}).refine((rule) => rule.field !== 'property' || Boolean(rule.key?.trim()), {
  message: 'Property rules require a key',
});

export const actionRulesSchema = z.array(actionRuleSchema).min(1).max(12);

export const createActionSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(''),
  rules: actionRulesSchema,
});

export const updateActionSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  rules: actionRulesSchema.optional(),
});

export const patchPersonSchema = z.object({
  properties: z.record(z.unknown()),
});

export const annotationCategorySchema = z.enum(['note', 'release', 'campaign', 'incident', 'experiment']);

export const createAnnotationSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(1000).optional().default(''),
  category: annotationCategorySchema.optional().default('note'),
  happenedAt: z.coerce.number().int(),
});

export const updateAnnotationSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(1000).optional(),
  category: annotationCategorySchema.optional(),
  happenedAt: z.coerce.number().int().optional(),
});

export const surveyTypeSchema = z.enum(['text', 'rating', 'choice']);
export const surveyTemplateSchema = z.enum(['nps', 'csat']);

const surveyOptionsSchema = z.array(z.string().min(1).max(120)).max(10);
export const surveyDisplayRuleSchema = z.object({
  field: z.enum(['path', 'event', 'property', 'language', 'country', 'device']),
  key: z.string().trim().min(1).max(120).optional(),
  operator: z.enum(['equals', 'contains', 'starts_with', 'ends_with', 'not_equals', 'not_contains', 'exists', 'not_exists']),
  value: z.string().trim().max(500).default(''),
}).refine((rule) => (rule.field === 'property' ? Boolean(rule.key?.trim()) : true), {
  message: 'Property display rules require a key',
});

const surveyDisplayRulesSchema = z.array(surveyDisplayRuleSchema).max(12).default([]);

export const createSurveySchema = z.object({
  template: surveyTemplateSchema.optional(),
  name: z.string().min(1).max(120).optional(),
  question: z.string().min(1).max(500).optional(),
  type: surveyTypeSchema.optional().default('text'),
  options: surveyOptionsSchema.optional().default([]),
  enabled: z.boolean().optional().default(true),
  triggerPath: z.string().max(500).optional().nullable(),
  triggerEvent: z.string().min(1).max(80).optional().nullable(),
  displayDelaySeconds: z.coerce.number().int().min(0).max(60).optional().default(0),
  displayRules: surveyDisplayRulesSchema.optional().default([]),
}).refine((data) => data.type !== 'choice' || data.options.length >= 2, {
  message: 'Choice surveys require at least two options',
}).refine((data) => Boolean(data.template || (data.name && data.question)), {
  message: 'Survey name and question are required unless a template is used',
});

export const updateSurveySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  question: z.string().min(1).max(500).optional(),
  type: surveyTypeSchema.optional(),
  options: surveyOptionsSchema.optional(),
  enabled: z.boolean().optional(),
  triggerPath: z.string().max(500).optional().nullable(),
  triggerEvent: z.string().min(1).max(80).optional().nullable(),
  displayDelaySeconds: z.coerce.number().int().min(0).max(60).optional(),
  displayRules: surveyDisplayRulesSchema.optional(),
}).refine((data) => data.type !== 'choice' || data.options === undefined || data.options.length >= 2, {
  message: 'Choice surveys require at least two options',
});

export const submitSurveyResponseSchema = z.object({
  website: z.string().uuid(),
  surveyId: z.string(),
  sessionId: z.string().max(128).optional().nullable(),
  visitId: z.string().max(128).optional().nullable(),
  answer: z.string().min(1).max(2000),
  urlPath: z.string().max(500).optional().nullable(),
});

export const workflowActionConfigSchema = z
  .object({
    note: z.string().max(500).optional().default(''),
    url: z.string().url().max(500).optional().or(z.literal('')),
    email: z.string().email().max(200).optional().or(z.literal('')),
  })
  .default({});

export const workflowActionTypeSchema = z.enum(['record', 'webhook', 'email']);

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(120),
  triggerEvent: z.string().min(1).max(80),
  enabled: z.boolean().optional().default(true),
  actionType: workflowActionTypeSchema.optional().default('record'),
  actionConfig: workflowActionConfigSchema.optional().default({}),
});

export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  triggerEvent: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  actionType: workflowActionTypeSchema.optional(),
  actionConfig: workflowActionConfigSchema.optional(),
});

export const errorIssueStatusSchema = z.enum(['open', 'resolved', 'ignored']);

export const updateErrorIssueStateSchema = z.object({
  fingerprint: z.string().min(1).max(1000),
  status: errorIssueStatusSchema,
  note: z.string().max(1000).optional().nullable(),
  assigneeUserId: z.string().uuid().optional().nullable(),
});

export const createErrorIssueCommentSchema = z.object({
  fingerprint: z.string().min(1).max(1000),
  body: z.string().min(1).max(2000),
});

export const uploadErrorSourceMapSchema = z.object({
  release: z.string().trim().min(1).max(200),
  file: z.string().trim().min(1).max(1000),
  content: z.string().min(1).max(5_000_000),
});

export const errorAlertChannelSchema = z.enum(['record', 'email', 'webhook']);

export const createErrorAlertRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional().default(true),
  threshold: z.coerce.number().int().min(1).max(100000),
  windowMinutes: z.coerce.number().int().min(1).max(10080),
  severity: z.enum(['fatal', 'error', 'warning', 'info']).optional().nullable(),
  release: z.string().trim().max(200).optional().nullable(),
  environment: z.string().trim().max(100).optional().nullable(),
  channel: errorAlertChannelSchema.optional().default('record'),
  target: z.string().trim().max(500).optional().nullable(),
});

export const updateErrorAlertRuleSchema = createErrorAlertRuleSchema.partial();

export const logSavedFilterValueSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  search: z.string().trim().max(200).optional(),
  release: z.string().trim().max(200).optional(),
  environment: z.string().trim().max(100).optional(),
  service: z.string().trim().max(120).optional(),
  traceId: z.string().trim().max(200).optional(),
});

export const createLogSavedFilterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  filters: logSavedFilterValueSchema,
  isDefault: z.boolean().optional().default(false),
});

export const updateLogSavedFilterSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  filters: logSavedFilterValueSchema.optional(),
  isDefault: z.boolean().optional(),
});

export const createLogAlertRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional().default(true),
  threshold: z.coerce.number().int().min(1).max(100000),
  windowMinutes: z.coerce.number().int().min(1).max(10080),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional().nullable(),
  service: z.string().trim().max(120).optional().nullable(),
  search: z.string().trim().max(200).optional().nullable(),
  release: z.string().trim().max(200).optional().nullable(),
  environment: z.string().trim().max(100).optional().nullable(),
  channel: errorAlertChannelSchema.optional().default('record'),
  target: z.string().trim().max(500).optional().nullable(),
});

export const updateLogAlertRuleSchema = createLogAlertRuleSchema.partial();

export const warehouseQuerySchema = z.object({
  sql: z.string().min(1).max(8000),
});

export const createWarehouseSavedQuerySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().default(''),
  sql: z.string().min(1).max(8000),
});

export const updateWarehouseSavedQuerySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  sql: z.string().min(1).max(8000).optional(),
});

export const createWarehouseScheduledQuerySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().default(''),
  sql: z.string().min(1).max(8000),
  enabled: z.boolean().optional().default(true),
  intervalMinutes: z.coerce.number().int().min(5).max(43200),
  nextRunAt: z.coerce.number().int().optional(),
});

export const updateWarehouseScheduledQuerySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  sql: z.string().min(1).max(8000).optional(),
  enabled: z.boolean().optional(),
  intervalMinutes: z.coerce.number().int().min(5).max(43200).optional(),
  nextRunAt: z.coerce.number().int().optional(),
});

const warehouseDataSourceTypeSchema = z.enum(['http_json', 'http_csv', 'r2_json', 'd1', 'postgres', 'mysql']);
const warehouseDataSourceStatusSchema = z.enum(['connected', 'failed', 'syncing']).nullable();

export const createWarehouseDataSourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: warehouseDataSourceTypeSchema,
  enabled: z.boolean().optional().default(true),
  config: z.record(z.unknown()).optional().default({}),
});

export const updateWarehouseDataSourceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: warehouseDataSourceTypeSchema.optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  lastSyncAt: z.coerce.number().int().optional().nullable(),
  lastStatus: warehouseDataSourceStatusSchema.optional(),
  lastError: z.string().trim().max(1000).optional().nullable(),
});

export const updateWebsiteSchema = z.object({
  name: z.string().max(100).optional(),
  domain: z.string().max(500).optional(),
  resetAt: z.string().datetime().optional(),
  replayEnabled: z.boolean().optional(),
  replayConfig: z.record(z.unknown()).nullable().optional(),
  heatmapConfig: heatmapConfigSchema.nullable().optional(),
  goalConfig: goalConfigSchema.nullable().optional(),
});

export const updateProfileSchema = z.object({
  displayName: z.string().max(100).nullable().optional(),
  logoUrl: z.string().url().max(2000).nullable().optional(),
});

export const updateTeamUserSchema = z.object({
  role: z.enum(['team-owner', 'team-manager', 'team-member', 'team-view-only']),
});

export const updateAdminUserSchema = z.object({
  username: z.string().min(1).max(50).optional(),
  role: z.enum(['admin', 'user', 'view-only', 'team-view-only']).optional(),
  password: z.string().min(6).max(100).optional(),
});

export const updateShareSchema = z.object({
  name: z.string().max(100).optional(),
});

export const statsQuerySchema = z.object({
  startAt: z.coerce.number().optional(),
  endAt: z.coerce.number().optional(),
  unit: z.enum(['year', 'month', 'day', 'hour', 'minute']).optional(),
  timezone: z.string().optional(),
});

export const compareQuerySchema = statsQuerySchema.extend({
  compareStartAt: z.coerce.number().optional(),
  compareEndAt: z.coerce.number().optional(),
});

export const metricsQuerySchema = statsQuerySchema.extend({
  type: z
    .enum([
      'path',
      'url',
      'entry',
      'exit',
      'referrer',
      'channel',
      'browser',
      'os',
      'device',
      'country',
      'region',
      'city',
      'language',
      'event',
      'heatmap',
    ])
    .optional(),
  sortBy: z.enum(['views', 'visitors', 'time']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const eventsQuerySchema = statsQuerySchema.extend({
  event: z.string().max(50).optional(),
});

export const createTeamSchema = z.object({
  name: z.string().max(100),
});

export const updateTeamSchema = z.object({
  name: z.string().max(100).optional(),
});

export const joinTeamSchema = z.object({
  accessCode: z.string().min(4).max(50),
});

export const createShareSchema = z.object({
  websiteId: z.string().uuid(),
  name: z.string().max(100).optional(),
});

export const createSegmentSchema = z.object({
  type: z.string().max(50),
  name: z.string().max(100),
  parameters: z.record(z.unknown()),
});

export const updateSegmentSchema = createSegmentSchema.partial();

export const createLinkSchema = z.object({
  name: z.string().max(100),
  url: z.string().url().max(2000),
  slug: z.string().max(50).regex(/^[a-z0-9-]+$/i).optional(),
  teamId: z.string().uuid().optional(),
});

export const updateLinkSchema = z.object({
  name: z.string().max(100).optional(),
  url: z.string().url().max(2000).optional(),
  slug: z.string().max(50).regex(/^[a-z0-9-]+$/i).optional(),
});

export const createPixelSchema = z.object({
  name: z.string().max(100),
  slug: z.string().max(50).regex(/^[a-z0-9-]+$/i).optional(),
  teamId: z.string().uuid().optional(),
});

export const updatePixelSchema = z.object({
  name: z.string().max(100).optional(),
  slug: z.string().max(50).regex(/^[a-z0-9-]+$/i).optional(),
});

export const createReportSchema = z.object({
  websiteId: z.string().uuid(),
  type: z.string().max(50),
  name: z.string().max(100),
  description: z.string().max(500).optional(),
  parameters: z.record(z.unknown()),
});

export const updateReportSchema = z.object({
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  parameters: z.record(z.unknown()).optional(),
});

export const recordPayloadSchema = z.object({
  website: z.string().uuid(),
  sessionId: z.string().max(64),
  visitId: z.string().max(64),
  chunkIndex: z.coerce.number().int().min(0),
  events: z.array(z.unknown()),
  startedAt: z.coerce.number().int(),
  endedAt: z.coerce.number().int(),
});

export const recordSchema = z.object({
  type: z.literal('record'),
  payload: recordPayloadSchema,
});

export const createAdminUserSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(6).max(100),
  role: z.enum(['admin', 'user', 'view-only', 'team-view-only']).optional(),
});

export const createAdminWebsiteSchema = z.object({
  name: z.string().max(100),
  domain: z.string().max(500).optional(),
  userId: z.string().uuid(),
});

export const createBoardSchema = z.object({
  type: z.string().max(50).default('dashboard'),
  name: z.string().max(100),
  description: z.string().max(500).optional(),
  parameters: z.record(z.unknown()).default({}),
  teamId: z.string().uuid().nullable().optional(),
});

export const updateBoardSchema = z.object({
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  parameters: z.record(z.unknown()).optional(),
});

export const insightTypeSchema = z.enum(['trend', 'funnel', 'retention', 'path', 'stickiness', 'table']);

export const insightQuerySchema = z.object({
  event: z.string().max(120).optional().nullable(),
  events: z.array(z.string().min(1).max(120)).max(8).optional(),
  path: z.string().max(500).optional().nullable(),
  steps: z.array(z.string().min(1).max(500)).max(8).optional(),
  metric: z.enum(['pageviews', 'visitors', 'visits', 'events']).optional().default('pageviews'),
  dimension: z
    .enum(['path', 'url', 'referrer', 'channel', 'browser', 'os', 'device', 'country', 'region', 'city', 'language', 'event'])
    .optional()
    .default('path'),
  actor: z.enum(['person', 'session']).optional().default('person'),
  unit: z.enum(['hour', 'day', 'week', 'month']).optional().default('day'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
});

export const createInsightSchema = z.object({
  websiteId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(''),
  type: insightTypeSchema,
  query: insightQuerySchema,
});

export const updateInsightSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  type: insightTypeSchema.optional(),
  query: insightQuerySchema.optional(),
});

export const forgotPasswordSchema = z.object({
  username: z.string().min(1).max(100),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6).max(100),
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(100),
});

export const createSavedReplaySchema = z.object({
  name: z.string().max(100),
  visitId: z.string().max(64),
});

export const updateSavedReplaySchema = z.object({
  name: z.string().max(100).optional(),
});

export const cohortConditionSchema = z.object({
  field: z.enum(['event_name', 'url_path']),
  operator: z.enum(['equals', 'contains']),
  value: z.string().max(500),
});

export const cohortDefinitionSchema = z.object({
  conditions: z.array(cohortConditionSchema).min(1).max(10),
  windowStart: z.coerce.number().int().optional(),
  windowEnd: z.coerce.number().int().optional(),
});

export const createCohortSchema = z.object({
  name: z.string().max(100),
  definition: cohortDefinitionSchema,
});

export const updateCohortSchema = z.object({
  name: z.string().max(100).optional(),
  definition: cohortDefinitionSchema.optional(),
});

export const emailReportSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  recipientEmail: z.string().max(2000).optional(),
  timezone: z.string().max(64).optional(),
});

export const importCsvSchema = z.object({
  format: z.enum(['flareboard', 'ga4', 'plausible', 'matomo']).default('flareboard'),
  csv: z.string().min(1).max(10_000_000),
});

export const funnelQuerySchema = z.object({
  websiteId: z.string().uuid(),
  steps: z.string().min(1),
  startAt: z.coerce.number().optional(),
  endAt: z.coerce.number().optional(),
  segmentId: z.string().uuid().optional(),
});

export const stickinessQuerySchema = z.object({
  websiteId: z.string().uuid(),
  event: z.string().max(120).optional(),
  actor: z.enum(['session', 'person']).optional().default('person'),
  startAt: z.coerce.number().optional(),
  endAt: z.coerce.number().optional(),
  segmentId: z.string().uuid().optional(),
});

export const attributionQuerySchema = z.object({
  websiteId: z.string().uuid(),
  model: z.enum(['first', 'last']).default('last'),
  type: z.enum(['path', 'event']).optional(),
  step: z.string().min(1).max(500).optional(),
  dimension: z
    .enum(['referrer', 'paidAds', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'])
    .optional(),
  startAt: z.coerce.number().optional(),
  endAt: z.coerce.number().optional(),
  segmentId: z.string().uuid().optional(),
});

export type AttributionBreakdownRow = { name: string; value: number };

export type UtmBreakdownRow = { name: string; pageviews: number };

export type UtmReportResponse = {
  campaign: UtmBreakdownRow[];
  content: UtmBreakdownRow[];
  medium: UtmBreakdownRow[];
  source: UtmBreakdownRow[];
  term: UtmBreakdownRow[];
  segmentId: string | null;
  startAt: number;
  endAt: number;
};

export type AttributionLegacyResponse = {
  model: 'first' | 'last';
  sources: Array<{ source: string; sessions: number; pageviews: number }>;
};

export type AttributionConversionResponse = {
  model: 'first' | 'last';
  type: 'path' | 'event';
  step: string;
  segmentId: string | null;
  startAt: number;
  endAt: number;
  total: { visitors: number; visits: number; pageviews: number; conversions: number };
  referrer: AttributionBreakdownRow[];
  paidAds: AttributionBreakdownRow[];
  utm_source: AttributionBreakdownRow[];
  utm_medium: AttributionBreakdownRow[];
  utm_campaign: AttributionBreakdownRow[];
  utm_content: AttributionBreakdownRow[];
  utm_term: AttributionBreakdownRow[];
};

export type CohortDefinition = z.infer<typeof cohortDefinitionSchema>;
export type CohortCondition = z.infer<typeof cohortConditionSchema>;

export type SendPayload = z.infer<typeof sendPayloadSchema>;
export type SendBody = z.infer<typeof sendSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type CreateWebsiteBody = z.infer<typeof createWebsiteSchema>;
export type UpdateWebsiteBody = z.infer<typeof updateWebsiteSchema>;

export interface CacheToken {
  websiteId: string;
  sessionId: string;
  visitId: string;
  iat: number;
}

export interface AuthUser {
  userId: string;
  role: string;
}

export interface QueueSessionMessage {
  type: 'session';
  data: {
    id: string;
    websiteId: string;
    browser?: string | null;
    os?: string | null;
    device?: string | null;
    screen?: string | null;
    language?: string | null;
    country?: string | null;
    region?: string | null;
    city?: string | null;
    distinctId?: string | null;
    createdAt: number;
  };
}

export interface QueueEventMessage {
  type: 'event';
  data: {
    id: string;
    websiteId: string;
    sessionId: string;
    visitId: string;
    createdAt: number;
    urlPath: string;
    urlQuery?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    referrerPath?: string | null;
    referrerQuery?: string | null;
    referrerDomain?: string | null;
    pageTitle?: string | null;
    gclid?: string | null;
    fbclid?: string | null;
    msclkid?: string | null;
    ttclid?: string | null;
    lifatid?: string | null;
    twclid?: string | null;
    eventType: number;
    eventName?: string | null;
    tag?: string | null;
    hostname?: string | null;
    lcp?: number | null;
    inp?: number | null;
    cls?: number | null;
    fcp?: number | null;
    ttfb?: number | null;
  };
  eventData?: Array<{
    id: string;
    websiteId: string;
    websiteEventId: string;
    dataKey: string;
    stringValue?: string | null;
    numberValue?: number | null;
    dateValue?: number | null;
    dataType: number;
    createdAt: number;
  }>;
}

export interface QueueSessionDataMessage {
  type: 'session_data';
  data: Array<{
    id: string;
    websiteId: string;
    sessionId: string;
    dataKey: string;
    stringValue?: string | null;
    numberValue?: number | null;
    dateValue?: number | null;
    dataType: number;
    distinctId?: string | null;
    createdAt: number;
  }>;
}

export interface QueueRevenueMessage {
  type: 'revenue';
  data: {
    id: string;
    websiteId: string;
    sessionId: string;
    eventId: string;
    eventName: string;
    currency: string;
    revenue: number;
    createdAt: number;
  };
}

export interface QueueHeatmapMessage {
  type: 'heatmap';
  data: {
    websiteId: string;
    urlPath: string;
    kind: 'click' | 'scroll';
    normX: number;
    normY: number;
    deviceClass: string;
    viewportW: number;
    viewportH: number;
    createdAt: number;
  };
}

export type QueueMessage =
  | QueueSessionMessage
  | QueueEventMessage
  | QueueSessionDataMessage
  | QueueRevenueMessage
  | QueueHeatmapMessage;

export function flattenEventData(
  websiteId: string,
  websiteEventId: string,
  data: Record<string, unknown>,
  createdAt: number,
): QueueEventMessage['eventData'] {
  const result: NonNullable<QueueEventMessage['eventData']> = [];
  for (const [key, value] of Object.entries(data)) {
    const id = crypto.randomUUID();
    if (typeof value === 'string') {
      result.push({
        id,
        websiteId,
        websiteEventId,
        dataKey: key,
        stringValue: value,
        dataType: 1,
        createdAt,
      });
    } else if (typeof value === 'number') {
      result.push({
        id,
        websiteId,
        websiteEventId,
        dataKey: key,
        numberValue: value,
        dataType: 2,
        createdAt,
      });
    } else if (typeof value === 'boolean') {
      result.push({
        id,
        websiteId,
        websiteEventId,
        dataKey: key,
        stringValue: String(value),
        dataType: 3,
        createdAt,
      });
    }
  }
  return result;
}
