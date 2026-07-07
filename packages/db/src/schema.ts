import { sqliteTable, text, integer, real, blob, index, primaryKey } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', {
  userId: text('user_id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: text('role').notNull(),
  email: text('email'),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp_ms' }),
  logoUrl: text('logo_url'),
  displayName: text('display_name'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
});

export const userSubscription = sqliteTable('user_subscription', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.userId),
  planId: text('plan_id').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripePriceId: text('stripe_price_id'),
  status: text('status').notNull().default('active'),
  currentPeriodEnd: integer('current_period_end', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});

export const usageMonthly = sqliteTable(
  'usage_monthly',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.userId),
    monthKey: text('month_key').notNull(),
    eventsCount: integer('events_count').notNull().default(0),
  },
  (t) => [index('usage_monthly_user_idx').on(t.userId)],
);

export const team = sqliteTable(
  'team',
  {
    teamId: text('team_id').primaryKey(),
    name: text('name').notNull(),
    accessCode: text('access_code').unique(),
    logoUrl: text('logo_url'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('team_access_code_idx').on(t.accessCode)],
);

export const teamUser = sqliteTable(
  'team_user',
  {
    teamUserId: text('team_user_id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => team.teamId),
    userId: text('user_id')
      .notNull()
      .references(() => user.userId),
    role: text('role').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('team_user_team_idx').on(t.teamId), index('team_user_user_idx').on(t.userId)],
);

export const website = sqliteTable(
  'website',
  {
    websiteId: text('website_id').primaryKey(),
    name: text('name').notNull(),
    domain: text('domain'),
    resetAt: integer('reset_at', { mode: 'timestamp_ms' }),
    userId: text('user_id').references(() => user.userId),
    teamId: text('team_id').references(() => team.teamId),
    createdBy: text('created_by').references(() => user.userId),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    replayEnabled: integer('replay_enabled', { mode: 'boolean' }).default(false),
    replayConfig: text('replay_config', { mode: 'json' }),
    heatmapConfig: text('heatmap_config', { mode: 'json' }),
    goalConfig: text('goal_config', { mode: 'json' }),
  },
  (t) => [
    index('website_user_idx').on(t.userId),
    index('website_team_idx').on(t.teamId),
    index('website_created_at_idx').on(t.createdAt),
    index('website_created_by_idx').on(t.createdBy),
  ],
);

export const session = sqliteTable(
  'session',
  {
    sessionId: text('session_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    browser: text('browser'),
    os: text('os'),
    device: text('device'),
    screen: text('screen'),
    language: text('language'),
    country: text('country'),
    region: text('region'),
    city: text('city'),
    distinctId: text('distinct_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('session_created_at_idx').on(t.createdAt),
    index('session_website_idx').on(t.websiteId),
    index('session_website_created_idx').on(t.websiteId, t.createdAt),
  ],
);

export const websiteEvent = sqliteTable(
  'website_event',
  {
    eventId: text('event_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.sessionId),
    visitId: text('visit_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    urlPath: text('url_path').notNull(),
    urlQuery: text('url_query'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmContent: text('utm_content'),
    utmTerm: text('utm_term'),
    referrerPath: text('referrer_path'),
    referrerQuery: text('referrer_query'),
    referrerDomain: text('referrer_domain'),
    pageTitle: text('page_title'),
    gclid: text('gclid'),
    fbclid: text('fbclid'),
    msclkid: text('msclkid'),
    ttclid: text('ttclid'),
    lifatid: text('li_fat_id'),
    twclid: text('twclid'),
    eventType: integer('event_type').notNull().default(1),
    eventName: text('event_name'),
    tag: text('tag'),
    hostname: text('hostname'),
    lcp: real('lcp'),
    inp: real('inp'),
    cls: real('cls'),
    fcp: real('fcp'),
    ttfb: real('ttfb'),
  },
  (t) => [
    index('website_event_created_at_idx').on(t.createdAt),
    index('website_event_session_idx').on(t.sessionId),
    index('website_event_visit_idx').on(t.visitId),
    index('website_event_website_idx').on(t.websiteId),
    index('website_event_website_created_idx').on(t.websiteId, t.createdAt),
    index('website_event_website_type_created_idx').on(t.websiteId, t.eventType, t.createdAt),
    index('website_event_website_path_idx').on(t.websiteId, t.createdAt, t.urlPath),
    index('website_event_website_event_name_idx').on(t.websiteId, t.createdAt, t.eventName),
  ],
);

export const eventData = sqliteTable(
  'event_data',
  {
    eventDataId: text('event_data_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    websiteEventId: text('website_event_id')
      .notNull()
      .references(() => websiteEvent.eventId),
    dataKey: text('data_key').notNull(),
    stringValue: text('string_value'),
    numberValue: real('number_value'),
    dateValue: integer('date_value', { mode: 'timestamp_ms' }),
    dataType: integer('data_type').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('event_data_created_at_idx').on(t.createdAt),
    index('event_data_website_idx').on(t.websiteId),
    index('event_data_event_idx').on(t.websiteEventId),
    index('event_data_website_created_idx').on(t.websiteId, t.createdAt),
    index('event_data_website_key_created_idx').on(t.websiteId, t.dataKey, t.createdAt),
  ],
);

export const sessionData = sqliteTable(
  'session_data',
  {
    sessionDataId: text('session_data_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.sessionId),
    dataKey: text('data_key').notNull(),
    stringValue: text('string_value'),
    numberValue: real('number_value'),
    dateValue: integer('date_value', { mode: 'timestamp_ms' }),
    dataType: integer('data_type').notNull(),
    distinctId: text('distinct_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('session_data_created_at_idx').on(t.createdAt),
    index('session_data_website_idx').on(t.websiteId),
    index('session_data_session_idx').on(t.sessionId),
    index('session_data_session_created_idx').on(t.sessionId, t.createdAt),
    index('session_data_website_key_created_idx').on(t.websiteId, t.dataKey, t.createdAt),
  ],
);

export const report = sqliteTable(
  'report',
  {
    reportId: text('report_id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.userId),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    type: text('type').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    parameters: text('parameters', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('report_user_idx').on(t.userId),
    index('report_website_idx').on(t.websiteId),
    index('report_type_idx').on(t.type),
    index('report_name_idx').on(t.name),
  ],
);

export const segment = sqliteTable(
  'segment',
  {
    segmentId: text('segment_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    type: text('type').notNull(),
    name: text('name').notNull(),
    parameters: text('parameters', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('segment_website_idx').on(t.websiteId)],
);

export const revenue = sqliteTable(
  'revenue',
  {
    revenueId: text('revenue_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.sessionId),
    eventId: text('event_id').notNull(),
    eventName: text('event_name').notNull(),
    currency: text('currency').notNull(),
    revenue: real('revenue'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('revenue_website_idx').on(t.websiteId),
    index('revenue_session_idx').on(t.sessionId),
    index('revenue_website_created_idx').on(t.websiteId, t.createdAt),
  ],
);

export const link = sqliteTable(
  'link',
  {
    linkId: text('link_id').primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    slug: text('slug').notNull().unique(),
    userId: text('user_id').references(() => user.userId),
    teamId: text('team_id').references(() => team.teamId),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('link_slug_idx').on(t.slug),
    index('link_user_idx').on(t.userId),
    index('link_team_idx').on(t.teamId),
  ],
);

export const pixel = sqliteTable(
  'pixel',
  {
    pixelId: text('pixel_id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    userId: text('user_id').references(() => user.userId),
    teamId: text('team_id').references(() => team.teamId),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('pixel_slug_idx').on(t.slug),
    index('pixel_user_idx').on(t.userId),
    index('pixel_team_idx').on(t.teamId),
  ],
);

export const board = sqliteTable(
  'board',
  {
    boardId: text('board_id').primaryKey(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    parameters: text('parameters', { mode: 'json' }).notNull(),
    userId: text('user_id').references(() => user.userId),
    teamId: text('team_id').references(() => team.teamId),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('board_user_idx').on(t.userId),
    index('board_team_idx').on(t.teamId),
    index('board_created_at_idx').on(t.createdAt),
  ],
);

export const insight = sqliteTable(
  'insight',
  {
    insightId: text('insight_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    userId: text('user_id')
      .notNull()
      .references(() => user.userId),
    type: text('type').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    query: text('query', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('insight_website_idx').on(t.websiteId),
    index('insight_user_idx').on(t.userId),
    index('insight_type_idx').on(t.websiteId, t.type),
  ],
);

export const share = sqliteTable(
  'share',
  {
    shareId: text('share_id').primaryKey(),
    entityId: text('entity_id').notNull(),
    name: text('name').notNull(),
    shareType: integer('share_type').notNull(),
    slug: text('slug').notNull().unique(),
    parameters: text('parameters', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('share_entity_idx').on(t.entityId)],
);

export const sessionReplay = sqliteTable(
  'session_replay',
  {
    replayId: text('replay_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    sessionId: text('session_id').notNull(),
    visitId: text('visit_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    events: blob('events').notNull(),
    eventCount: integer('event_count').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('session_replay_website_idx').on(t.websiteId),
    index('session_replay_session_idx').on(t.sessionId),
    index('session_replay_visit_idx').on(t.visitId),
    index('session_replay_website_created_idx').on(t.websiteId, t.createdAt),
    index('session_replay_website_visit_chunk_idx').on(t.websiteId, t.visitId, t.chunkIndex),
  ],
);

export const rollupStatsDaily = sqliteTable(
  'rollup_stats_daily',
  {
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    day: text('day').notNull(),
    pageviews: integer('pageviews').notNull().default(0),
    visitors: integer('visitors').notNull().default(0),
    visits: integer('visits').notNull().default(0),
    bounces: integer('bounces').notNull().default(0),
    totaltimeSec: integer('totaltime_sec').notNull().default(0),
  },
  (t) => [index('rollup_stats_daily_website_day_idx').on(t.websiteId, t.day)],
);

export const rollupPageviewSeries = sqliteTable(
  'rollup_pageview_series',
  {
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    unit: text('unit').notNull(),
    bucket: text('bucket').notNull(),
    pageviews: integer('pageviews').notNull().default(0),
  },
  (t) => [],
);

export const rollupDimensionDaily = sqliteTable(
  'rollup_dimension_daily',
  {
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    day: text('day').notNull(),
    dimension: text('dimension').notNull(),
    value: text('value').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [index('rollup_dimension_daily_lookup_idx').on(t.websiteId, t.day, t.dimension)],
);

export const rollupEventDaily = sqliteTable(
  'rollup_event_daily',
  {
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    day: text('day').notNull(),
    eventName: text('event_name').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [],
);

export const rollupSessionDay = sqliteTable(
  'rollup_session_day',
  {
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    day: text('day').notNull(),
    sessionId: text('session_id').notNull(),
    visitId: text('visit_id').notNull(),
    pageviews: integer('pageviews').notNull().default(0),
    firstAt: integer('first_at').notNull(),
    lastAt: integer('last_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.websiteId, t.day, t.sessionId, t.visitId],
    }),
  ],
);

export const sessionReplaySummary = sqliteTable(
  'session_replay_summary',
  {
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    visitId: text('visit_id').notNull(),
    sessionId: text('session_id').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }).notNull(),
    eventCount: integer('event_count').notNull().default(0),
    chunks: integer('chunks').notNull().default(0),
  },
  (t) => [index('session_replay_summary_website_started_idx').on(t.websiteId, t.startedAt)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.userId),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadata: text('metadata', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('audit_log_user_idx').on(t.userId),
    index('audit_log_created_at_idx').on(t.createdAt),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
  ],
);

export const heatmapCell = sqliteTable(
  'heatmap_cell',
  {
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    urlPath: text('url_path').notNull(),
    day: text('day').notNull(),
    kind: text('kind').notNull(),
    normX: integer('norm_x').notNull(),
    normY: integer('norm_y').notNull(),
    deviceClass: text('device_class').notNull().default(''),
    viewportW: integer('viewport_w').notNull().default(0),
    viewportH: integer('viewport_h').notNull().default(0),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    index('heatmap_cell_lookup_idx').on(t.websiteId, t.urlPath, t.day),
    primaryKey({
      columns: [t.websiteId, t.urlPath, t.day, t.kind, t.normX, t.normY, t.deviceClass],
    }),
  ],
);

export const websiteEmailReport = sqliteTable('website_email_report', {
  websiteId: text('website_id')
    .primaryKey()
    .references(() => website.websiteId),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  frequency: text('frequency').notNull().default('weekly'),
  recipientEmail: text('recipient_email'),
  timezone: text('timezone').notNull().default('UTC'),
  lastSentAt: integer('last_sent_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});

export const cohort = sqliteTable(
  'cohort',
  {
    cohortId: text('cohort_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    name: text('name').notNull(),
    type: text('type').notNull(),
    value: text('value').notNull(),
    definition: text('definition', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('cohort_website_idx').on(t.websiteId)],
);

export const featureFlag = sqliteTable(
  'feature_flag',
  {
    flagId: text('flag_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    rollout: integer('rollout').notNull().default(100),
    variants: text('variants', { mode: 'json' }),
    targetingRules: text('targeting_rules', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('feature_flag_website_idx').on(t.websiteId),
    index('feature_flag_website_key_idx').on(t.websiteId, t.key),
  ],
);

export const experiment = sqliteTable(
  'experiment',
  {
    experimentId: text('experiment_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    featureFlagId: text('feature_flag_id')
      .notNull()
      .references(() => featureFlag.flagId),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('draft'),
    goalEvent: text('goal_event').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('experiment_website_idx').on(t.websiteId),
    index('experiment_flag_idx').on(t.featureFlagId),
    index('experiment_status_idx').on(t.websiteId, t.status),
  ],
);

export const actionDefinition = sqliteTable(
  'action_definition',
  {
    actionId: text('action_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    rules: text('rules', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('action_definition_website_idx').on(t.websiteId),
    index('action_definition_website_name_idx').on(t.websiteId, t.name),
  ],
);

export const annotation = sqliteTable(
  'annotation',
  {
    annotationId: text('annotation_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    userId: text('user_id')
      .notNull()
      .references(() => user.userId),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull().default('note'),
    happenedAt: integer('happened_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('annotation_website_idx').on(t.websiteId),
    index('annotation_website_happened_idx').on(t.websiteId, t.happenedAt),
    index('annotation_user_idx').on(t.userId),
  ],
);

export const survey = sqliteTable(
  'survey',
  {
    surveyId: text('survey_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    name: text('name').notNull(),
    question: text('question').notNull(),
    type: text('type').notNull().default('text'),
    options: text('options', { mode: 'json' }).$type<string[]>(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    triggerPath: text('trigger_path'),
    triggerEvent: text('trigger_event'),
    displayDelaySeconds: integer('display_delay_seconds').notNull().default(0),
    displayRules: text('display_rules', { mode: 'json' }).$type<
      Array<{ field: string; operator: string; value: string; key?: string }>
    >(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('survey_website_idx').on(t.websiteId),
    index('survey_website_enabled_idx').on(t.websiteId, t.enabled),
  ],
);

export const surveyResponse = sqliteTable(
  'survey_response',
  {
    responseId: text('response_id').primaryKey(),
    surveyId: text('survey_id')
      .notNull()
      .references(() => survey.surveyId),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    sessionId: text('session_id'),
    visitId: text('visit_id'),
    answer: text('answer').notNull(),
    urlPath: text('url_path'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('survey_response_survey_idx').on(t.surveyId),
    index('survey_response_website_created_idx').on(t.websiteId, t.createdAt),
    index('survey_response_session_idx').on(t.sessionId),
  ],
);

export const workflow = sqliteTable(
  'workflow',
  {
    workflowId: text('workflow_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    name: text('name').notNull(),
    triggerEvent: text('trigger_event').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    actionType: text('action_type').notNull().default('record'),
    actionConfig: text('action_config', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('workflow_website_idx').on(t.websiteId),
    index('workflow_website_enabled_idx').on(t.websiteId, t.enabled),
    index('workflow_trigger_idx').on(t.websiteId, t.triggerEvent),
  ],
);

export const workflowExecution = sqliteTable(
  'workflow_execution',
  {
    executionId: text('execution_id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.workflowId),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    sessionId: text('session_id'),
    visitId: text('visit_id'),
    eventId: text('event_id'),
    eventName: text('event_name'),
    status: text('status').notNull().default('recorded'),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('workflow_execution_workflow_idx').on(t.workflowId),
    index('workflow_execution_website_created_idx').on(t.websiteId, t.createdAt),
    index('workflow_execution_session_idx').on(t.sessionId),
  ],
);

export const errorIssueState = sqliteTable(
  'error_issue_state',
  {
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').notNull().default('open'),
    note: text('note'),
    assigneeUserId: text('assignee_user_id').references(() => user.userId),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    primaryKey({ columns: [t.websiteId, t.fingerprint] }),
    index('error_issue_state_website_status_idx').on(t.websiteId, t.status),
  ],
);

export const errorIssueComment = sqliteTable(
  'error_issue_comment',
  {
    commentId: text('comment_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    fingerprint: text('fingerprint').notNull(),
    userId: text('user_id').references(() => user.userId),
    body: text('body').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('error_issue_comment_issue_idx').on(t.websiteId, t.fingerprint, t.createdAt)],
);

export const errorSourceMap = sqliteTable(
  'error_source_map',
  {
    sourceMapId: text('source_map_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    release: text('release').notNull(),
    file: text('file').notNull(),
    content: text('content').notNull(),
    size: integer('size').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('error_source_map_unique_idx').on(t.websiteId, t.release, t.file),
    index('error_source_map_release_idx').on(t.websiteId, t.release),
  ],
);

export const errorAlertRule = sqliteTable(
  'error_alert_rule',
  {
    alertRuleId: text('alert_rule_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    threshold: integer('threshold').notNull(),
    windowMinutes: integer('window_minutes').notNull(),
    severity: text('severity'),
    release: text('release'),
    environment: text('environment'),
    channel: text('channel').notNull().default('record'),
    target: text('target'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('error_alert_rule_website_idx').on(t.websiteId, t.enabled)],
);

export const errorAlertEvent = sqliteTable(
  'error_alert_event',
  {
    alertEventId: text('alert_event_id').primaryKey(),
    alertRuleId: text('alert_rule_id')
      .notNull()
      .references(() => errorAlertRule.alertRuleId),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    count: integer('count').notNull(),
    threshold: integer('threshold').notNull(),
    windowStartAt: integer('window_start_at', { mode: 'timestamp_ms' }).notNull(),
    windowEndAt: integer('window_end_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('error_alert_event_rule_idx').on(t.websiteId, t.alertRuleId, t.createdAt)],
);

export const logSavedFilter = sqliteTable(
  'log_saved_filter',
  {
    filterId: text('filter_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    userId: text('user_id').references(() => user.userId),
    name: text('name').notNull(),
    filters: text('filters', { mode: 'json' }).notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('log_saved_filter_website_idx').on(t.websiteId, t.createdAt)],
);

export const logAlertRule = sqliteTable(
  'log_alert_rule',
  {
    alertRuleId: text('alert_rule_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    threshold: integer('threshold').notNull(),
    windowMinutes: integer('window_minutes').notNull(),
    level: text('level'),
    service: text('service'),
    search: text('search'),
    release: text('release'),
    environment: text('environment'),
    channel: text('channel').notNull().default('record'),
    target: text('target'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('log_alert_rule_website_idx').on(t.websiteId, t.enabled)],
);

export const logAlertEvent = sqliteTable(
  'log_alert_event',
  {
    alertEventId: text('alert_event_id').primaryKey(),
    alertRuleId: text('alert_rule_id')
      .notNull()
      .references(() => logAlertRule.alertRuleId),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    count: integer('count').notNull(),
    threshold: integer('threshold').notNull(),
    windowStartAt: integer('window_start_at', { mode: 'timestamp_ms' }).notNull(),
    windowEndAt: integer('window_end_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('log_alert_event_rule_idx').on(t.websiteId, t.alertRuleId, t.createdAt)],
);

export const warehouseSavedQuery = sqliteTable(
  'warehouse_saved_query',
  {
    savedQueryId: text('saved_query_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    userId: text('user_id').references(() => user.userId),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    sql: text('sql').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('warehouse_saved_query_website_idx').on(t.websiteId, t.createdAt)],
);

export const warehouseQueryHistory = sqliteTable(
  'warehouse_query_history',
  {
    historyId: text('history_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    userId: text('user_id').references(() => user.userId),
    sql: text('sql').notNull(),
    status: text('status').notNull(),
    rowCount: integer('row_count').notNull().default(0),
    error: text('error'),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('warehouse_query_history_website_idx').on(t.websiteId, t.createdAt)],
);

export const warehouseScheduledQuery = sqliteTable(
  'warehouse_scheduled_query',
  {
    scheduledQueryId: text('scheduled_query_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    userId: text('user_id').references(() => user.userId),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    sql: text('sql').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    intervalMinutes: integer('interval_minutes').notNull(),
    nextRunAt: integer('next_run_at', { mode: 'timestamp_ms' }).notNull(),
    lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
    lastStatus: text('last_status'),
    lastError: text('last_error'),
    lastRowCount: integer('last_row_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('warehouse_scheduled_query_due_idx').on(t.websiteId, t.enabled, t.nextRunAt)],
);

export const person = sqliteTable(
  'person',
  {
    personId: text('person_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    distinctId: text('distinct_id').notNull(),
    propertiesJson: text('properties_json').notNull().default('{}'),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('person_website_distinct_idx').on(t.websiteId, t.distinctId)],
);

export const personGroupMembership = sqliteTable(
  'person_group_membership',
  {
    membershipId: text('membership_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    personId: text('person_id')
      .notNull()
      .references(() => person.personId),
    groupType: text('group_type').notNull(),
    groupKey: text('group_key').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('person_group_membership_unique_idx').on(t.websiteId, t.personId, t.groupType, t.groupKey)],
);

export const warehouseDataSource = sqliteTable(
  'warehouse_data_source',
  {
    dataSourceId: text('data_source_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    userId: text('user_id').references(() => user.userId),
    name: text('name').notNull(),
    type: text('type').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    configJson: text('config_json').notNull(),
    lastSyncAt: integer('last_sync_at', { mode: 'timestamp_ms' }),
    lastStatus: text('last_status'),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('warehouse_data_source_website_idx').on(t.websiteId, t.createdAt)],
);

export const warehouseImport = sqliteTable(
  'warehouse_import',
  {
    importRowId: text('import_row_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    dataSourceId: text('data_source_id')
      .notNull()
      .references(() => warehouseDataSource.dataSourceId),
    primaryKey: text('primary_key').notNull(),
    payloadJson: text('payload_json').notNull(),
    importedAt: integer('imported_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('warehouse_import_source_key_idx').on(t.websiteId, t.dataSourceId, t.primaryKey),
    index('warehouse_import_website_idx').on(t.websiteId, t.importedAt),
  ],
);

export const sessionReplaySaved = sqliteTable(
  'session_replay_saved',
  {
    savedReplayId: text('saved_replay_id').primaryKey(),
    name: text('name').notNull(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    visitId: text('visit_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('session_replay_saved_website_idx').on(t.websiteId),
    index('session_replay_saved_visit_idx').on(t.visitId),
    index('session_replay_saved_website_created_idx').on(t.websiteId, t.createdAt),
  ],
);

export type User = typeof user.$inferSelect;
export type Website = typeof website.$inferSelect;
export type Session = typeof session.$inferSelect;
export type WebsiteEvent = typeof websiteEvent.$inferSelect;
export type ActionDefinition = typeof actionDefinition.$inferSelect;
export type Annotation = typeof annotation.$inferSelect;
export type FeatureFlag = typeof featureFlag.$inferSelect;
export type Experiment = typeof experiment.$inferSelect;
export type Survey = typeof survey.$inferSelect;
export type SurveyResponse = typeof surveyResponse.$inferSelect;
export type Workflow = typeof workflow.$inferSelect;
export type WorkflowExecution = typeof workflowExecution.$inferSelect;
export type ErrorIssueState = typeof errorIssueState.$inferSelect;
export type ErrorIssueComment = typeof errorIssueComment.$inferSelect;
export type ErrorSourceMap = typeof errorSourceMap.$inferSelect;
export type ErrorAlertRule = typeof errorAlertRule.$inferSelect;
export type ErrorAlertEvent = typeof errorAlertEvent.$inferSelect;
export type LogSavedFilter = typeof logSavedFilter.$inferSelect;
export type LogAlertRule = typeof logAlertRule.$inferSelect;
export type LogAlertEvent = typeof logAlertEvent.$inferSelect;
export type WarehouseSavedQuery = typeof warehouseSavedQuery.$inferSelect;
export type WarehouseQueryHistory = typeof warehouseQueryHistory.$inferSelect;
export type WarehouseScheduledQuery = typeof warehouseScheduledQuery.$inferSelect;
export type WarehouseDataSource = typeof warehouseDataSource.$inferSelect;
export type WarehouseImport = typeof warehouseImport.$inferSelect;
export type Person = typeof person.$inferSelect;
export type PersonGroupMembership = typeof personGroupMembership.$inferSelect;
export type Insight = typeof insight.$inferSelect;
