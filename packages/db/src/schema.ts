import { sqliteTable, text, integer, real, blob, index, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', {
  userId: text('user_id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: text('role').notNull(),
  email: text('email'),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp_ms' }),
  logoUrl: text('logo_url'),
  displayName: text('display_name'),
  // Bumped on password change to invalidate every previously issued token.
  tokenVersion: integer('token_version').notNull().default(0),
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
    /** Members without two-factor authentication lose access to the team until they enroll. */
    requireTwoFactor: integer('require_two_factor', { mode: 'boolean' }).notNull().default(false),
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
    // Null keeps raw event data forever; a positive value purges rows older than N days.
    retentionDays: integer('retention_days'),
    timezone: text('timezone').notNull().default('UTC'),
    // Tracker settings (migration 0047). Autocapture is on for new websites only.
    autocapture: integer('autocapture', { mode: 'boolean' }).notNull().default(true),
    // Opt-in: a random localStorage visitor id replaces the monthly IP + user agent hash.
    persistVisitors: integer('persist_visitors', { mode: 'boolean' }).notNull().default(false),
    respectDnt: integer('respect_dnt', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('website_user_idx').on(t.userId),
    index('website_team_idx').on(t.teamId),
    index('website_created_at_idx').on(t.createdAt),
    index('website_created_by_idx').on(t.createdBy),
  ],
);

/** Public ingest key (`fb_pk_…`) of a website, accepted wherever ingest accepts the website id. */
export const websiteProjectKey = sqliteTable(
  'website_project_key',
  {
    websiteId: text('website_id')
      .primaryKey()
      .references(() => website.websiteId),
    projectKey: text('project_key').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    rotatedAt: integer('rotated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [uniqueIndex('website_project_key_key_idx').on(t.projectKey)],
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

/** OAuth account -> local user. Only an explicit link or first sign-up creates a row. */
export const userOauthIdentity = sqliteTable(
  'user_oauth_identity',
  {
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.userId, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerUserId] }), index('user_oauth_identity_user_idx').on(t.userId)],
);

/** TOTP second factor. The secret is AES-GCM encrypted; `enabledAt` is null while enrollment is pending. */
export const userTwoFactor = sqliteTable('user_two_factor', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.userId),
  secretEnc: text('secret_enc').notNull(),
  enabledAt: integer('enabled_at', { mode: 'timestamp_ms' }),
  /** Last accepted TOTP time step, so a code cannot be replayed within its window. */
  lastUsedStep: integer('last_used_step'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** One-time recovery codes, stored only as HMAC-SHA256 hashes and deleted when used. */
export const userRecoveryCode = sqliteTable(
  'user_recovery_code',
  {
    codeHash: text('code_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.userId),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('user_recovery_code_user_idx').on(t.userId)],
);

/** Dashboard sign-in session (`sid` in the session token). No IP address or full user agent. */
export const userSession = sqliteTable(
  'user_session',
  {
    sessionId: text('session_id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.userId),
    /** Coarse summary such as "Chrome on macOS". */
    device: text('device'),
    /** How the session was started: password, google, github, sso, email. */
    method: text('method').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('user_session_user_idx').on(t.userId), index('user_session_expires_idx').on(t.expiresAt)],
);

/** Personal API key (`fb_sk_…`): stored as a SHA-256 hash plus a display prefix, never in full. */
export const personalApiKey = sqliteTable(
  'personal_api_key',
  {
    keyId: text('key_id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.userId),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    /** Comma-separated subset of `read`, `write`. */
    scopes: text('scopes').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  },
  (t) => [uniqueIndex('personal_api_key_hash_idx').on(t.keyHash), index('personal_api_key_user_idx').on(t.userId)],
);

/** One row per link redirect or pixel view (not website events: no website_id). */
export const linkPixelHit = sqliteTable(
  'link_pixel_hit',
  {
    hitId: text('hit_id').primaryKey(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    visitorId: text('visitor_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('link_pixel_hit_source_idx').on(t.sourceType, t.sourceId, t.createdAt)],
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

/** "Ask Flareboard" conversations (apps/api/src/lib/assistant.ts). One owner per conversation. */
export const aiConversation = sqliteTable(
  'ai_conversation',
  {
    conversationId: text('conversation_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    userId: text('user_id')
      .notNull()
      .references(() => user.userId),
    title: text('title').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('ai_conversation_owner_idx').on(t.userId, t.websiteId, t.updatedAt),
    index('ai_conversation_updated_idx').on(t.updatedAt),
  ],
);

export const aiMessage = sqliteTable(
  'ai_message',
  {
    messageId: text('message_id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => aiConversation.conversationId),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    userId: text('user_id')
      .notNull()
      .references(() => user.userId),
    /** `user` | `assistant` */
    role: text('role').notNull(),
    /** JSON: user text, or the assistant answer with its tool calls and rendered results. */
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('ai_message_conversation_idx').on(t.conversationId, t.createdAt)],
);

/** Per-account daily assistant usage (hosted-mode cap). Counts only. */
export const aiUsageDaily = sqliteTable(
  'ai_usage_daily',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.userId),
    day: text('day').notNull(),
    requests: integer('requests').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
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
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
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
    clickCount: integer('click_count').notNull().default(0),
    inputCount: integer('input_count').notNull().default(0),
    consoleLogCount: integer('console_log_count').notNull().default(0),
    consoleWarnCount: integer('console_warn_count').notNull().default(0),
    consoleErrorCount: integer('console_error_count').notNull().default(0),
    networkErrorCount: integer('network_error_count').notNull().default(0),
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

export const rollupSeriesBucket = sqliteTable(
  'rollup_series_bucket',
  {
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    unit: text('unit').notNull(),
    bucket: text('bucket').notNull(),
    sessionId: text('session_id').notNull(),
    visitId: text('visit_id').notNull(),
  },
  (t) => [index('rollup_series_bucket_lookup_idx').on(t.websiteId, t.unit, t.bucket)],
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
    clickCount: integer('click_count').notNull().default(0),
    inputCount: integer('input_count').notNull().default(0),
    consoleLogCount: integer('console_log_count').notNull().default(0),
    consoleWarnCount: integer('console_warn_count').notNull().default(0),
    consoleErrorCount: integer('console_error_count').notNull().default(0),
    networkErrorCount: integer('network_error_count').notNull().default(0),
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

/** LLM analytics: whether AI events keep prompt/response content (no row = yes). */
export const llmWebsiteSetting = sqliteTable('llm_website_setting', {
  websiteId: text('website_id')
    .primaryKey()
    .references(() => website.websiteId),
  captureContent: integer('capture_content', { mode: 'boolean' }).notNull().default(true),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/** LLM analytics: per-website model prices (USD per 1M tokens) replacing the built-in table. */
export const llmModelPrice = sqliteTable(
  'llm_model_price',
  {
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    model: text('model').notNull(),
    inputPerMillion: real('input_per_million').notNull(),
    outputPerMillion: real('output_per_million').notNull(),
    cacheReadPerMillion: real('cache_read_per_million'),
    cacheWritePerMillion: real('cache_write_per_million'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.websiteId, t.model] })],
);

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
    /** @deprecated mirror of the first condition group, kept for older readers (migration 0045). */
    rollout: integer('rollout').notNull().default(100),
    /** Variants with weights and optional per-variant `payload`. */
    variants: text('variants', { mode: 'json' }),
    /** @deprecated mirror of the first condition group, kept for older readers (migration 0045). */
    targetingRules: text('targeting_rules', { mode: 'json' }),
    /** OR-ed release condition groups; NULL means "derive one group from the legacy columns". */
    conditionGroups: text('condition_groups', { mode: 'json' }),
    /** Raw JSON payload of a boolean flag (see parsePayloadColumn). */
    payload: text('payload'),
    earlyAccess: integer('early_access', { mode: 'boolean' }).notNull().default(false),
    earlyAccessName: text('early_access_name').notNull().default(''),
    earlyAccessDescription: text('early_access_description').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('feature_flag_website_idx').on(t.websiteId),
    index('feature_flag_website_key_idx').on(t.websiteId, t.key),
    index('feature_flag_website_early_access_idx').on(t.websiteId, t.earlyAccess),
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
    /** Event of the primary metric, kept in sync for older readers. */
    goalEvent: text('goal_event').notNull(),
    /** ExperimentMetric JSON (null only on rows created before migration 0044). */
    primaryMetric: text('primary_metric', { mode: 'json' }),
    secondaryMetrics: text('secondary_metrics', { mode: 'json' }).notNull().default([]),
    /** Relative lift in percent the sample-size guidance plans for (null = default). */
    minimumDetectableEffect: real('minimum_detectable_effect'),
    /** ExperimentAllocation JSON captured when the experiment starts. */
    allocation: text('allocation', { mode: 'json' }),
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
    /** JSON array of questions (packages/shared/src/surveys.ts). NULL = legacy columns only. */
    questions: text('questions', { mode: 'json' }).$type<unknown[]>(),
    appearance: text('appearance', { mode: 'json' }).$type<Record<string, unknown>>(),
    sampleRate: integer('sample_rate').notNull().default(100),
    responseLimit: integer('response_limit'),
    startsAt: integer('starts_at'),
    endsAt: integer('ends_at'),
    repeatIntervalDays: integer('repeat_interval_days'),
    hostedEnabled: integer('hosted_enabled', { mode: 'boolean' }).notNull().default(false),
    slug: text('slug'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('survey_website_idx').on(t.websiteId),
    index('survey_website_enabled_idx').on(t.websiteId, t.enabled),
    uniqueIndex('survey_slug_unique').on(t.slug),
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
    /** JSON object keyed by question id. NULL on rows written before migration 0049's backfill. */
    answers: text('answers', { mode: 'json' }).$type<Record<string, unknown>>(),
    completed: integer('completed', { mode: 'boolean' }).notNull().default(true),
    source: text('source').notNull().default('widget'),
    distinctId: text('distinct_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('survey_response_survey_idx').on(t.surveyId),
    index('survey_response_survey_created_idx').on(t.surveyId, t.createdAt),
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
    /** Summary of the first action step, kept for older readers (see migration 0050). */
    actionType: text('action_type').notNull().default('record'),
    actionConfig: text('action_config', { mode: 'json' }),
    description: text('description').notNull().default(''),
    /** JSON array of AND-ed trigger conditions (WorkflowCondition in @flareboard/shared). */
    triggerFilters: text('trigger_filters'),
    /** JSON array of ordered flow steps (WorkflowStep in @flareboard/shared). */
    steps: text('steps'),
    /** HMAC key for the X-Flareboard-Signature webhook header. Never returned after creation. */
    signingSecret: text('signing_secret'),
    signingSecretRotatedAt: integer('signing_secret_rotated_at', { mode: 'timestamp_ms' }),
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
    distinctId: text('distinct_id'),
    currentStep: integer('current_step'),
    attempts: integer('attempts').notNull().default(0),
    responseCode: integer('response_code'),
    nextRetryAt: integer('next_retry_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('workflow_execution_workflow_idx').on(t.workflowId),
    index('workflow_execution_website_created_idx').on(t.websiteId, t.createdAt),
    index('workflow_execution_session_idx').on(t.sessionId),
    index('workflow_execution_created_idx').on(t.createdAt),
    index('workflow_execution_workflow_created_idx').on(t.workflowId, t.createdAt),
  ],
);

/** One row per step outcome of an execution: delivery attempts, condition results, delays. */
export const workflowExecutionAttempt = sqliteTable(
  'workflow_execution_attempt',
  {
    attemptId: text('attempt_id').primaryKey(),
    executionId: text('execution_id')
      .notNull()
      .references(() => workflowExecution.executionId),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflow.workflowId),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    stepIndex: integer('step_index').notNull(),
    stepType: text('step_type').notNull(),
    attempt: integer('attempt').notNull().default(1),
    status: text('status').notNull(),
    responseCode: integer('response_code'),
    error: text('error'),
    responseBody: text('response_body'),
    durationMs: integer('duration_ms'),
    nextRetryAt: integer('next_retry_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('workflow_execution_attempt_execution_idx').on(t.executionId, t.createdAt),
    index('workflow_execution_attempt_website_created_idx').on(t.websiteId, t.createdAt),
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
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    regressedAt: integer('regressed_at', { mode: 'timestamp_ms' }),
    regressionCheckedAt: integer('regression_checked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    primaryKey({ columns: [t.websiteId, t.fingerprint] }),
    index('error_issue_state_website_status_idx').on(t.websiteId, t.status),
  ],
);

/** Merging issue B into A stores B -> A; events keep their fingerprint and are mapped at query time. */
export const errorIssueMerge = sqliteTable(
  'error_issue_merge',
  {
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    sourceFingerprint: text('source_fingerprint').notNull(),
    targetFingerprint: text('target_fingerprint').notNull(),
    sourceName: text('source_name'),
    sourceMessage: text('source_message'),
    mergedBy: text('merged_by').references(() => user.userId),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    primaryKey({ columns: [t.websiteId, t.sourceFingerprint] }),
    index('error_issue_merge_target_idx').on(t.websiteId, t.targetFingerprint),
  ],
);

/** One row per time a resolved issue occurred again. */
export const errorIssueRegression = sqliteTable(
  'error_issue_regression',
  {
    regressionId: text('regression_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    fingerprint: text('fingerprint').notNull(),
    eventId: text('event_id'),
    release: text('release'),
    environment: text('environment'),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    detectedAt: integer('detected_at', { mode: 'timestamp_ms' }).notNull(),
    notifiedAt: integer('notified_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('error_issue_regression_issue_idx').on(t.websiteId, t.fingerprint, t.detectedAt)],
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
    /** Legacy inline map; '' once the content lives in R2 under `objectKey`. */
    content: text('content').notNull(),
    objectKey: text('object_key'),
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
    notifyRegressions: integer('notify_regressions', { mode: 'boolean' }).notNull().default(true),
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
  // Must stay unique to match migration 0030 (upserts rely on this constraint).
  (t) => [uniqueIndex('person_website_distinct_idx').on(t.websiteId, t.distinctId)],
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

/** Connector secrets (Stripe restricted keys), encrypted with a key derived from APP_SECRET. */
export const warehouseCredential = sqliteTable(
  'warehouse_credential',
  {
    dataSourceId: text('data_source_id').primaryKey(),
    websiteId: text('website_id').notNull(),
    kind: text('kind').notNull(),
    ciphertext: text('ciphertext').notNull(),
    hint: text('hint'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('warehouse_credential_website_idx').on(t.websiteId)],
);

/** Incremental sync cursor of a data source (lib/stripe-connector.ts). */
export const warehouseSyncState = sqliteTable(
  'warehouse_sync_state',
  {
    dataSourceId: text('data_source_id').primaryKey(),
    websiteId: text('website_id').notNull(),
    stateJson: text('state_json').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('warehouse_sync_state_website_idx').on(t.websiteId)],
);

/*
 * Stripe connector tables (SITE_TABLES: website store, or D1 in legacy mode). Timestamps are
 * milliseconds, amounts Stripe minor units, *_major columns decimal units in `currency`.
 */
export const stripeCustomer = sqliteTable(
  'stripe_customer',
  {
    websiteId: text('website_id').notNull(),
    dataSourceId: text('data_source_id').notNull(),
    customerId: text('customer_id').notNull(),
    email: text('email'),
    name: text('name'),
    distinctId: text('distinct_id'),
    deleted: integer('deleted').notNull().default(0),
    metadataJson: text('metadata_json'),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at'),
    syncedAt: integer('synced_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dataSourceId, t.customerId] }),
    index('stripe_customer_website_idx').on(t.websiteId, t.createdAt),
    index('stripe_customer_distinct_idx').on(t.websiteId, t.distinctId),
  ],
);

export const stripeCharge = sqliteTable(
  'stripe_charge',
  {
    websiteId: text('website_id').notNull(),
    dataSourceId: text('data_source_id').notNull(),
    chargeId: text('charge_id').notNull(),
    customerId: text('customer_id'),
    invoiceId: text('invoice_id'),
    status: text('status'),
    paid: integer('paid').notNull().default(0),
    amount: integer('amount').notNull().default(0),
    amountRefunded: integer('amount_refunded').notNull().default(0),
    currency: text('currency').notNull(),
    amountMajor: real('amount_major').notNull().default(0),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
    syncedAt: integer('synced_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dataSourceId, t.chargeId] }),
    index('stripe_charge_website_created_idx').on(t.websiteId, t.createdAt),
    index('stripe_charge_customer_idx').on(t.websiteId, t.customerId),
  ],
);

export const stripeRefund = sqliteTable(
  'stripe_refund',
  {
    websiteId: text('website_id').notNull(),
    dataSourceId: text('data_source_id').notNull(),
    refundId: text('refund_id').notNull(),
    chargeId: text('charge_id'),
    status: text('status'),
    amount: integer('amount').notNull().default(0),
    currency: text('currency').notNull(),
    amountMajor: real('amount_major').notNull().default(0),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
    syncedAt: integer('synced_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dataSourceId, t.refundId] }),
    index('stripe_refund_website_created_idx').on(t.websiteId, t.createdAt),
  ],
);

export const stripeInvoice = sqliteTable(
  'stripe_invoice',
  {
    websiteId: text('website_id').notNull(),
    dataSourceId: text('data_source_id').notNull(),
    invoiceId: text('invoice_id').notNull(),
    customerId: text('customer_id'),
    subscriptionId: text('subscription_id'),
    status: text('status'),
    currency: text('currency').notNull(),
    total: integer('total').notNull().default(0),
    amountPaid: integer('amount_paid').notNull().default(0),
    amountPaidMajor: real('amount_paid_major').notNull().default(0),
    periodStart: integer('period_start'),
    periodEnd: integer('period_end'),
    paidAt: integer('paid_at'),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
    syncedAt: integer('synced_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dataSourceId, t.invoiceId] }),
    index('stripe_invoice_website_created_idx').on(t.websiteId, t.createdAt),
  ],
);

export const stripeInvoiceLine = sqliteTable(
  'stripe_invoice_line',
  {
    websiteId: text('website_id').notNull(),
    dataSourceId: text('data_source_id').notNull(),
    invoiceId: text('invoice_id').notNull(),
    lineId: text('line_id').notNull(),
    customerId: text('customer_id'),
    subscriptionId: text('subscription_id'),
    priceId: text('price_id'),
    interval: text('interval'),
    intervalCount: integer('interval_count'),
    quantity: integer('quantity'),
    proration: integer('proration').notNull().default(0),
    amount: integer('amount').notNull().default(0),
    currency: text('currency').notNull(),
    amountMajor: real('amount_major').notNull().default(0),
    mrrMajor: real('mrr_major').notNull().default(0),
    periodStart: integer('period_start'),
    periodEnd: integer('period_end'),
    syncedAt: integer('synced_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dataSourceId, t.invoiceId, t.lineId] }),
    index('stripe_invoice_line_period_idx').on(t.websiteId, t.periodEnd),
  ],
);

export const stripeSubscription = sqliteTable(
  'stripe_subscription',
  {
    websiteId: text('website_id').notNull(),
    dataSourceId: text('data_source_id').notNull(),
    subscriptionId: text('subscription_id').notNull(),
    customerId: text('customer_id'),
    status: text('status'),
    currency: text('currency'),
    mrrMajor: real('mrr_major').notNull().default(0),
    startDate: integer('start_date'),
    canceledAt: integer('canceled_at'),
    endedAt: integer('ended_at'),
    cancelAtPeriodEnd: integer('cancel_at_period_end').notNull().default(0),
    currentPeriodStart: integer('current_period_start'),
    currentPeriodEnd: integer('current_period_end'),
    trialEnd: integer('trial_end'),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
    syncedAt: integer('synced_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dataSourceId, t.subscriptionId] }),
    index('stripe_subscription_website_idx').on(t.websiteId, t.createdAt),
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

/** Public, revocable link to one replay (token in the URL, optional expiry). */
export const sessionReplayShare = sqliteTable(
  'session_replay_share',
  {
    shareId: text('share_id').primaryKey(),
    websiteId: text('website_id')
      .notNull()
      .references(() => website.websiteId),
    visitId: text('visit_id').notNull(),
    token: text('token').notNull(),
    createdBy: text('created_by').references(() => user.userId),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('session_replay_share_token_idx').on(t.token),
    index('session_replay_share_visit_idx').on(t.websiteId, t.visitId),
  ],
);

export const deadEvent = sqliteTable(
  'dead_event',
  {
    deadEventId: text('dead_event_id').primaryKey(),
    queue: text('queue').notNull(),
    messageType: text('message_type'),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('dead_event_created_idx').on(t.createdAt)],
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
export type WorkflowExecutionAttempt = typeof workflowExecutionAttempt.$inferSelect;
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
