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
