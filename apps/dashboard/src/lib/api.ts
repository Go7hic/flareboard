import type { InsightQuery as InsightQueryV2, InsightType as InsightTypeV2 } from '@flareboard/shared/insight-query';
import type { SurveyAnswers, SurveyAppearance, SurveyQuestion } from '@flareboard/shared/survey-flow';
import { apiReturnedHtmlError, apiUrlConfigError, resolveApiUrl } from './api-url';

const LEGACY_TOKEN_KEY = 'flareboard_token';

/**
 * Collection endpoint used in tracking snippets. Only local dev falls back to the local
 * ingest worker; a production build without VITE_INGEST_URL gets '' (callers show a
 * configuration hint) rather than handing customers a localhost snippet.
 */
export const INGEST_URL = (
  import.meta.env.VITE_INGEST_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')
).replace(/\/$/, '');

/** Placeholder origin for docs/marketing snippets when no ingest URL is configured. */
export const INGEST_URL_FOR_DOCS = INGEST_URL || 'https://YOUR_INGEST_HOST';

export const API_URL = resolveApiUrl();

let sessionActive: boolean | null = null;
let sessionCheck: Promise<boolean> | null = null;

function assertApiUrl(): void {
  if (API_URL) return;
  if (import.meta.env.DEV) return;
  throw new Error(apiUrlConfigError());
}

function clearLegacyTokenStorage() {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

export function hasSession(): boolean {
  return sessionActive === true;
}

export function markSession(active: boolean) {
  sessionActive = active;
}

export async function bootstrapSession(): Promise<boolean> {
  clearLegacyTokenStorage();
  if (sessionActive !== null) return sessionActive;
  // Concurrent callers (nav + page) share one /verify round trip.
  sessionCheck ??= api('/api/auth/verify')
    .then(() => true)
    .catch(() => false)
    .then((active) => {
      sessionActive = active;
      sessionCheck = null;
      return active;
    });
  return sessionCheck;
}

export async function logoutSession(): Promise<void> {
  if (API_URL || import.meta.env.DEV) {
    try {
      await fetch(`${API_URL || ''}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // Network errors should not block local sign-out.
    }
  }
  sessionActive = false;
  demoSession = false;
  clearLegacyTokenStorage();
}

/**
 * Signs this browser in as the shared read-only demo account (short session cookie) and
 * returns the demo website to open. Throws when the demo is unavailable.
 */
export async function startDemoSession(): Promise<{ websiteId: string }> {
  const result = await api<{ websiteId: string }>('/api/demo/session', { method: 'POST', body: '{}' });
  sessionActive = true;
  demoSession = true;
  return result;
}

export type ApiInit = RequestInit;

/** Paths where 401 means invalid credentials, not an expired session. */
const AUTH_FORM_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/logout',
  '/api/auth/verify',
  // Re-authenticated account actions: 401 means a wrong password, not a lost session.
  '/api/me/password',
  '/api/me/delete',
  // Two-factor: 401 means a wrong code or an expired sign-in challenge.
  '/api/auth/login/2fa',
  '/api/me/2fa/setup',
  '/api/me/2fa/enable',
  '/api/me/2fa/disable',
  '/api/me/2fa/recovery-codes',
]);

let sessionRedirectPending = false;

function normalizeApiPath(path: string): string {
  if (path.startsWith('http')) {
    try {
      return new URL(path).pathname;
    } catch {
      return path;
    }
  }
  return path;
}

/** Set while the read-only demo account is signed in: an expired session reopens the demo. */
let demoSession = false;

export function markDemoSession(active: boolean) {
  demoSession = active;
}

export function clearSessionAndRedirectToLogin(): void {
  if (sessionRedirectPending) return;
  const { pathname, search } = window.location;
  if (pathname === '/login') return;

  sessionRedirectPending = true;
  sessionActive = false;
  clearLegacyTokenStorage();
  if (demoSession) {
    demoSession = false;
    window.location.replace('/demo');
    return;
  }
  const next = encodeURIComponent(pathname + search);
  window.location.replace(`/login?next=${next}`);
}

/** Returns true when a 401 triggered session cleanup and redirect. */
export function handleUnauthorizedIfNeeded(path: string, status: number): boolean {
  if (status !== 401) return false;
  if (AUTH_FORM_PATHS.has(normalizeApiPath(path))) return false;
  clearSessionAndRedirectToLogin();
  return true;
}

export class ApiError extends Error {
  readonly status: number;
  /** Parsed JSON error body, for endpoints that return a machine-readable `code` and details. */
  readonly data: Record<string, unknown> | undefined;

  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/** Authenticated fetch with shared 401 handling. */
export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  assertApiUrl();
  const headers = new Headers(init.headers);

  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const res = await fetch(url, { ...init, headers, credentials: 'include' });
  handleUnauthorizedIfNeeded(path, res.status);
  return res;
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  assertApiUrl();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const res = await fetch(url, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    handleUnauthorizedIfNeeded(path, res.status);
    const err = await parseJsonBody<{ message?: string } & Record<string, unknown>>(res).catch(() => ({
      message: res.statusText,
    }));
    throw new ApiError(err.message || 'Request failed', res.status, err);
  }
  if (res.status === 204) return undefined as T;
  return parseJsonBody<T>(res);
}

async function parseJsonBody<T>(res: Response): Promise<T> {
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    return res.json() as Promise<T>;
  }
  const text = await res.text();
  if (text.trimStart().startsWith('<!')) {
    throw new Error(apiReturnedHtmlError());
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      text.slice(0, 120) || res.statusText || 'Invalid API response (expected JSON)',
    );
  }
}

export interface LoginResponse {
  user: { id: string; username: string; role: string };
  token?: string;
  /** Returned by `/api/auth/login/2fa` when a recovery code was used. */
  recoveryCodesRemaining?: number;
}

/** Returned instead of a session (HTTP 200, no cookie) when the account has two-factor on. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challenge: string;
}

/** `GET /api/me` (cached under the `['me']` query key). */
export interface MeResponse {
  id: string;
  username: string;
  role?: string;
  displayName?: string | null;
  /** False for accounts created through Google/GitHub: they have no password to confirm. */
  passwordRequired?: boolean;
  twoFactorEnabled?: boolean;
  /** Teams that require two-factor authentication, which the user cannot reach without it. */
  twoFactorRequiredBy?: Array<{ id: string; name: string }>;
  /** The shared read-only demo account ("Explore the demo"): the API refuses every change. */
  isDemo?: boolean;
}

/** Result of `/api/auth/login`,`/api/auth/oauth/exchange` and `/api/auth/verify-email`. */
export type LoginResult = LoginResponse | TwoFactorChallenge;

export function isTwoFactorChallenge(res: LoginResult | null | undefined): res is TwoFactorChallenge {
  return Boolean(res && 'twoFactorRequired' in res && res.twoFactorRequired && typeof res.challenge === 'string');
}

export interface Website {
  id: string;
  name: string;
  domain?: string;
  userId?: string;
  createdAt?: string | number;
  replayEnabled?: boolean;
  goalConfig?: { goals: Array<{ event: string; target: number; period: string }> };
  timezone?: string;
  /** Tracker: autocapture clicks, submits, field changes and page leaves. */
  autocapture?: boolean;
  /** Tracker: remember visitors across sessions with a random localStorage id. */
  persistVisitors?: boolean;
  /** Tracker: send nothing from browsers with Do Not Track / Global Privacy Control. */
  respectDnt?: boolean;
  /** Raw-data retention in days; null = the plan maximum (hosted) or keep forever (self-hosted). */
  retentionDays?: number | null;
}

/** Hosted plan ids, cheapest first (mirrors `PLAN_IDS` in packages/shared/src/billing.ts). */
export const BILLING_PLAN_IDS = ['free', 'cloud', 'business'] as const;
export type BillingPlanId = (typeof BILLING_PLAN_IDS)[number];
/** Plans a customer can buy (`POST /api/billing/checkout`). */
export type PaidPlanId = Exclude<BillingPlanId, 'free'>;

export function isPaidPlanId(id: string | null | undefined): id is PaidPlanId {
  return id === 'cloud' || id === 'business';
}

/** Position in `BILLING_PLAN_IDS`; unknown ids sort first, like Free. */
export function planRank(id: string): number {
  return Math.max(0, BILLING_PLAN_IDS.indexOf(id as BillingPlanId));
}

/**
 * `POST /api/billing/checkout`: a Stripe Checkout URL for a new subscription, or, when the
 * account already pays, the plan switched in place (prorated by Stripe).
 */
export type BillingCheckoutResponse = { url: string } | { switched: true; planId: PaidPlanId };

/** A hosted plan as `/api/billing/plans` and `/api/billing/subscription` return it. */
export interface BillingPlan {
  id: BillingPlanId;
  name: string;
  maxWebsites: number | null;
  maxEventsPerMonth: number;
  /** Session replays (recordings) per month; 0 when the plan has no replay. */
  maxReplaysPerMonth: number;
  /** OpenTelemetry log records and spans per month, counted apart from events. */
  maxOtelRowsPerMonth: number;
  /** Longest raw-data retention a website keeps on this plan (also the default). */
  maxRetentionDays: number;
  /** Past an allowance, collection continues up to this multiple of it; 1 = stops at it. */
  usageGraceMultiple: number;
  replayEnabled: boolean;
  emailReportsEnabled: boolean;
  heatmapsEnabled: boolean;
  teamsEnabled: boolean;
  dataPortabilityEnabled?: boolean;
  warehouseEnabled: boolean;
  experimentationEnabled: boolean;
  surveysEnabled: boolean;
  monthlyPriceUsd?: number | null;
}

export interface BillingUsage {
  eventsThisMonth: number;
  replaysThisMonth: number;
  otelRowsThisMonth: number;
}

/** `/api/billing/subscription`: `hosted: false` on self-hosted installs (no plan, no usage). */
export interface BillingSubscription {
  hosted: boolean;
  plan?: BillingPlan;
  status?: string;
  currentPeriodEnd?: string | number | null;
  usage?: BillingUsage;
  /** A Stripe customer exists, so "Manage billing" can open the Stripe portal. */
  billingAccount?: boolean;
}

export interface StatValue {
  value: number;
  change?: number;
}

export interface WebsiteStats {
  pageviews: StatValue;
  visitors: StatValue;
  visits: StatValue;
  bounces: StatValue;
  totaltime: StatValue;
}

export interface TrackingStatus {
  hasRecentData: boolean;
  lastEventAt: number | null;
  pageviews24h: number;
}

export interface EventCatalogRow {
  eventName: string;
  events: number;
  sessions: number;
  visits: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  propertyCount: number;
  propertyKeys: string[];
  paths: number;
}

export interface EventCatalogResponse {
  events: EventCatalogRow[];
  startAt: number;
  endAt: number;
}

export interface EventCatalogDetailResponse {
  summary: {
    eventName: string;
    events: number;
    sessions: number;
    visits: number;
    firstSeenAt: number | null;
    lastSeenAt: number | null;
  };
  properties: Array<{ key: string; count: number; valuesCount: number }>;
  paths: Array<{ path: string | null; events: number; sessions: number; lastSeenAt: number | null }>;
  recent: Array<{
    id: string;
    sessionId: string;
    visitId: string;
    urlPath: string | null;
    createdAt: number;
    properties?: Array<{ key: string; value: string | null }>;
  }>;
}

export type ActionRule = {
  field: 'event_name' | 'url_path' | 'property';
  key?: string;
  operator: 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'not_equals' | 'not_contains';
  value: string;
};

export interface ActionSummary {
  events: number;
  sessions: number;
  visits: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  trend: Array<{ date: string; events: number; sessions: number }>;
  paths: Array<{ path: string | null; events: number; sessions: number; lastSeenAt: number | null }>;
  recent: Array<{
    id: string;
    sessionId: string;
    visitId: string;
    eventName: string | null;
    urlPath: string | null;
    createdAt: number;
  }>;
}

export interface ActionDefinition {
  id: string;
  websiteId: string;
  name: string;
  description: string;
  rules: ActionRule[];
  summary?: ActionSummary;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface GroupRow {
  groupKey: string;
  latestName: string | null;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  sessions: number;
  people: number;
  visits: number;
  pageviews: number;
  events: number;
  country: string | null;
  city: string | null;
}

export interface GroupsResponse {
  groupType: string;
  groups: GroupRow[];
  startAt: number;
  endAt: number;
}

export interface GroupDetailResponse {
  groupType: string;
  groupKey: string;
  properties: Array<{ key: string; value: string | null; updatedAt: number | null }>;
  sessions: Array<{
    id: string;
    distinctId: string | null;
    browser: string | null;
    os: string | null;
    device: string | null;
    country: string | null;
    city: string | null;
    createdAt: number | null;
    events: number;
    lastSeenAt: number | null;
  }>;
  events: Array<{
    id: string;
    sessionId: string;
    visitId: string;
    urlPath: string | null;
    eventName: string | null;
    eventType: number;
    createdAt: number;
  }>;
}

export interface Annotation {
  id: string;
  websiteId: string;
  userId: string;
  title: string;
  description: string;
  category: 'note' | 'release' | 'campaign' | 'incident' | 'experiment';
  happenedAt: number;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface AnnotationsResponse {
  annotations: Annotation[];
  startAt: number;
  endAt: number;
}


export type {
  InsightQuery,
  InsightResult,
  InsightType,
  PropertyFilter,
  TrendResult,
  FunnelResult,
  RetentionResult,
  LifecycleResult,
  StickinessResult,
} from '@flareboard/shared/insight-query';

export interface Insight {
  id: string;
  websiteId: string;
  userId: string;
  type: InsightTypeV2;
  name: string;
  description: string;
  /** Always the v2 shape (the API upgrades legacy rows on read). */
  query: InsightQueryV2;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface Board {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  userId: string | null;
  teamId: string | null;
  canEdit?: boolean;
  createdAt: number | string | null;
  updatedAt: number | string | null;
}

export type BoardTemplateSummary = {
  id: 'product-analytics' | 'web-analytics' | 'revenue';
  name: string;
  description: string;
  rangePreset: string;
  widgets: Array<{ key: string; name: string; type: InsightTypeV2; size: string }>;
};

export type ReportSubscription = {
  id: string;
  targetType: 'board' | 'insight';
  targetId: string;
  title: string;
  frequency: 'daily' | 'weekly';
  weekday: number;
  hour: number;
  timezone: string;
  recipients: string[];
  enabled: boolean;
  nextRunAt: number;
  lastSentAt: number | null;
  lastError: string | null;
};

export type InsightAlertCondition = 'value_above' | 'value_below' | 'increase_above' | 'decrease_above';

export type InsightAlert = {
  id: string;
  insightId: string;
  name: string;
  condition: InsightAlertCondition;
  threshold: number;
  seriesKey: string;
  checkInterval: 'hour' | 'day' | 'week';
  channel: 'email' | 'webhook';
  target: string | null;
  enabled: boolean;
  snoozedUntil: number | null;
  lastCheckedAt: number | null;
  lastState: 'firing' | 'ok' | 'error' | null;
};

export type InsightAlertCheck = {
  id: string;
  intervalStart: number;
  intervalEnd: number;
  value: number | null;
  previousValue: number | null;
  state: 'firing' | 'ok' | 'error';
  delivered: boolean;
  error: string | null;
};

export type NotebookBlock =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'insight'; insightId: string; rangePreset?: '24h' | '7d' | '30d' | '90d' }
  | { id: string; type: 'replay'; sessionId: string; label?: string };

export type NotebookSummary = {
  id: string;
  websiteId: string;
  title: string;
  blockCount: number;
  updatedAt: number | null;
};

export type Notebook = {
  id: string;
  websiteId: string;
  title: string;
  content: { blocks: NotebookBlock[] };
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export type PropertyKeyRow = { key: string; count: number; numeric: boolean };
export type PropertyValueRow = { value: string; count: number };

export interface ErrorEvent {
  id: string;
  sessionId: string;
  visitId: string;
  urlPath: string;
  eventName: string | null;
  createdAt: number;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  message: string | null;
  name: string | null;
  severity: string | null;
  handled: string | null;
  release: string | null;
  environment: string | null;
  /** Issue the event belongs to (after merges). */
  fingerprint: string;
}

export type ErrorIssueStatus = 'open' | 'resolved' | 'ignored' | 'regressed';

export interface ErrorIssueComment {
  id: string;
  userId: string | null;
  body: string;
  createdAt: number;
}

export interface ErrorIssue {
  fingerprint: string;
  message: string | null;
  name: string | null;
  severity: string | null;
  events: number;
  sessions: number;
  users: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  latestEventId: string | null;
  status: ErrorIssueStatus;
  note: string | null;
  assigneeUserId: string | null;
  stateUpdatedAt: number | null;
  resolvedAt: number | null;
  regressedAt: number | null;
  mergedCount: number;
  /** Event counts in equal slices of the selected range. */
  trend: number[];
  comments: ErrorIssueComment[];
  samples: ErrorEvent[];
}

export interface ErrorEventsResponse {
  stats: {
    errors: number;
    sessions: number;
    users: number;
    firstSeenAt: number | null;
    lastSeenAt: number | null;
    releases: Array<{ release: string; errors: number }>;
    environments: Array<{ environment: string; errors: number }>;
    trend: Array<{ date: string; errors: number; sessions: number }>;
    severities: Array<{ severity: string; errors: number }>;
  };
  issues: ErrorIssue[];
  errors: ErrorEvent[];
}

export interface ResolvedStackFrame {
  raw: string;
  functionName: string | null;
  file: string;
  line: number | null;
  column: number | null;
  inApp: boolean;
  source: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
  resolved: boolean;
  context: { startLine: number; lines: string[] } | null;
}

export interface ErrorEventDetail extends ErrorEvent {
  properties: Array<{ key: string; value: string | null }>;
  resolvedStack?: ResolvedStackFrame[];
  grouping?: {
    method: 'custom' | 'stack' | 'message';
    frames: Array<{ file: string; function: string }>;
  };
}

export interface ErrorIssueRegression {
  id: string;
  fingerprint: string;
  eventId: string | null;
  release: string | null;
  environment: string | null;
  resolvedAt: number | null;
  occurredAt: number;
  detectedAt: number;
  notifiedAt: number | null;
}

export interface ErrorIssueDetail {
  fingerprint: string;
  name: string | null;
  message: string | null;
  severity: string | null;
  status: ErrorIssueStatus;
  note: string | null;
  assigneeUserId: string | null;
  stateUpdatedAt: number | null;
  resolvedAt: number | null;
  regressedAt: number | null;
  events: number;
  sessions: number;
  users: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  trend: number[];
  trendStartAt: number;
  trendEndAt: number;
  samples: ErrorEvent[];
  latestEvent: ErrorEventDetail | null;
  comments: ErrorIssueComment[];
  mergedIssues: Array<{
    fingerprint: string;
    name: string | null;
    message: string | null;
    mergedAt: number | null;
    mergedBy: string | null;
    events: number;
    lastSeenAt: number | null;
  }>;
  regressions: ErrorIssueRegression[];
}

export type ErrorIssueDetailResponse = { issue: ErrorIssueDetail } | { mergedInto: string };

export type LogSeverity = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogSource = 'otlp' | 'browser';

/** One log line: OpenTelemetry (`otlp`) or the tracker's flareboard.log() (`browser`). */
export interface LogEvent {
  id: string;
  source: LogSource;
  createdAt: number;
  timeUs: number;
  level: LogSeverity;
  severityText: string | null;
  message: string | null;
  service: string | null;
  release: string | null;
  environment: string | null;
  scope: string | null;
  traceId: string | null;
  spanId: string | null;
  sessionId: string | null;
  visitId: string | null;
  urlPath: string | null;
  attributes: Record<string, unknown> | null;
  resource: Record<string, unknown> | null;
}

export interface LogEventsResponse {
  stats: {
    logs: number;
    sessions: number;
    lastSeenAt: number | null;
    levels: Array<{ level: LogSeverity; logs: number }>;
    trend: Array<{ date: string; logs: number; sessions: number }>;
    releases: Array<{ release: string; logs: number }>;
    environments: Array<{ environment: string; logs: number }>;
    services: Array<{ service: string; logs: number }>;
  };
  logs: LogEvent[];
  /** Pass as `before` for the next page; null on the last page. */
  nextBefore: string | null;
  /** False when OpenTelemetry ingestion is unavailable (legacy D1 storage). */
  otlpEnabled: boolean;
}

export interface LogHistogramResponse {
  bucketMs: number;
  buckets: Array<{ t: number; total: number } & Record<LogSeverity, number>>;
}

export interface LogTailResponse {
  cursor: number;
  seq: string;
  logs: LogEvent[];
}

export type AiCostSource = 'reported' | 'override' | 'builtin';

export interface AiObservationEvent {
  id: string;
  sessionId: string;
  distinctId: string | null;
  urlPath: string;
  createdAt: number;
  kind: string;
  traceId: string;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  /** Null when the model has no known price. */
  costUsd: number | null;
  costSource: AiCostSource | null;
  latencyMs: number | null;
  status: string | null;
  quality: string | null;
  release: string | null;
  environment: string | null;
}

export interface AiTally {
  calls: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpricedCalls: number;
  errors: number;
  errorRate: number;
  avgLatencyMs: number | null;
}

export interface AiObservabilityResponse {
  stats: AiTally & {
    unit: 'hour' | 'day';
    sessions: number;
    users: number;
    traces: number;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    truncated: boolean;
    models: Array<AiTally & { model: string; provider: string | null; priceSource: 'override' | 'builtin' | null }>;
    statuses: Array<{ status: string; calls: number }>;
    providers: Array<AiTally & { provider: string }>;
    qualities: Array<{ quality: string; calls: number }>;
    releases: Array<{ release: string; calls: number; costUsd: number; errors: number }>;
    environments: Array<{ environment: string; calls: number; costUsd: number; errors: number }>;
    /** `date` is an ISO hour (UTC) when unit is hour, else a site-local YYYY-MM-DD. */
    trend: Array<AiTally & { date: string; sessions: number; p50LatencyMs: number | null; p95LatencyMs: number | null }>;
  };
  events: AiObservationEvent[];
}

export interface AiTraceSummary {
  traceId: string;
  name: string | null;
  startedAt: number;
  lastAt: number;
  latencyMs: number;
  generations: number;
  spans: number;
  errors: number;
  tokens: number;
  costUsd: number;
  unpricedCalls: number;
  models: string[];
  providers: string[];
  distinctId: string | null;
  sessionId: string;
}

export interface AiTraceEvent {
  id: string;
  kind: string;
  eventName: string | null;
  createdAt: number;
  startMs: number;
  endMs: number;
  spanId: string | null;
  parentId: string | null;
  name: string | null;
  model: string | null;
  provider: string | null;
  status: string;
  isError: boolean;
  error: string | null;
  httpStatus: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  tokens: number;
  costUsd: number | null;
  costSource: AiCostSource | null;
  input: string | null;
  output: string | null;
  inputTruncated: boolean;
  outputTruncated: boolean;
  contentOmitted: boolean;
  properties: Record<string, string | number | null>;
}

export interface AiTraceNode {
  id: string;
  event: AiTraceEvent | null;
  depth: number;
  startMs: number;
  endMs: number;
  totals: { costUsd: number; tokens: number; errors: number; generations: number };
  children: AiTraceNode[];
}

export interface AiTraceDetail {
  traceId: string;
  name: string | null;
  distinctId: string | null;
  sessionId: string;
  startedAt: number;
  endedAt: number;
  latencyMs: number;
  costUsd: number;
  tokens: number;
  errors: number;
  generations: number;
  unpricedCalls: number;
  truncated: boolean;
  tree: AiTraceNode;
}

export interface AiUserRow {
  distinctId: string | null;
  sessionId: string;
  calls: number;
  traces: number;
  errors: number;
  tokens: number;
  costUsd: number;
  unpricedCalls: number;
  firstAt: number;
  lastAt: number;
  models: string[];
}

export interface AiModelPrice {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number | null;
  cacheWritePerMillion: number | null;
}

export interface AiSettings {
  captureContent: boolean;
  priceOverrides: AiModelPrice[];
  builtInPrices: Array<AiModelPrice & { provider: string }>;
  pricesReviewedAt: string;
}

export interface WorkflowSummary {
  executions: number;
  lastExecutionAt: number | null;
  failures: number;
  successes: number;
  inProgress: number;
  successRate: number;
  statuses: Array<{ status: string; executions: number; percentage: number }>;
  events: Array<{ eventName: string; executions: number; lastExecutionAt: number | null }>;
  trend: Array<{
    date: string;
    executions: number;
    failures: number;
    successes: number;
    successRate: number;
  }>;
}

export type WorkflowConditionField = 'property' | 'person' | 'path' | 'url' | 'hostname';
export type WorkflowConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'exists'
  | 'not_exists'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal';

export interface WorkflowCondition {
  field: WorkflowConditionField;
  key: string;
  operator: WorkflowConditionOperator;
  value: string;
}

export type WorkflowWebhookMethod = 'POST' | 'PUT' | 'PATCH' | 'GET' | 'DELETE';

/** Mirrors WorkflowStep in packages/shared/src/workflow-definition.ts. */
export type WorkflowStep =
  | { id: string; type: 'delay'; minutes: number }
  | { id: string; type: 'condition'; conditions: WorkflowCondition[] }
  | {
      id: string;
      type: 'webhook';
      url: string;
      method: WorkflowWebhookMethod;
      headers: Array<{ key: string; value: string }>;
      body: string;
    }
  | { id: string; type: 'email'; to: string; subject: string; body: string }
  | { id: string; type: 'slack'; webhookUrl: string; message: string };

export type WorkflowStepType = WorkflowStep['type'];

export interface Workflow {
  id: string;
  websiteId: string;
  name: string;
  description: string;
  triggerEvent: string;
  enabled: boolean;
  filters: WorkflowCondition[];
  steps: WorkflowStep[];
  stepsValid: boolean;
  signingSecretPreview: string | null;
  signingSecretRotatedAt?: string | number | null;
  /** Only in the create response. */
  signingSecret?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  summary?: WorkflowSummary;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  sessionId: string | null;
  visitId: string | null;
  eventId: string | null;
  eventName: string | null;
  distinctId: string | null;
  status: string;
  error: string | null;
  currentStep: number | null;
  attempts: number;
  responseCode: number | null;
  nextRetryAt: number | null;
  createdAt: number;
  updatedAt: number | null;
  completedAt: number | null;
}

export interface WorkflowExecutionAttempt {
  id: string;
  stepIndex: number;
  stepType: string;
  attempt: number;
  status: string;
  responseCode: number | null;
  error: string | null;
  responseBody: string | null;
  durationMs: number | null;
  nextRetryAt: number | null;
  createdAt: number;
}

export interface WorkflowExecutionDetail {
  execution: WorkflowExecution;
  attempts: WorkflowExecutionAttempt[];
}

export interface WorkflowExecutionsResponse {
  workflow: Workflow;
  summary: WorkflowSummary;
  executions: WorkflowExecution[];
}

export type WorkflowTestRequest =
  | { type: 'webhook' | 'slack'; method: string; url: string; headers: Array<{ key: string; value: string }>; body: string | null }
  | { type: 'email'; to: string[]; subject: string; text: string };

export interface WorkflowTestResult {
  matched: boolean;
  sent: boolean;
  steps: Array<{
    index: number;
    type: WorkflowStepType;
    status: 'skipped' | 'passed' | 'stopped' | 'rendered' | 'sent' | 'failed' | 'not_reached';
    detail: string | null;
    request: WorkflowTestRequest | null;
    response: { statusCode: number | null; body: string | null; durationMs: number } | null;
    error: string | null;
  }>;
}

export interface WorkflowSampleEvent {
  event: {
    name: string;
    hostname: string | null;
    urlPath: string | null;
    urlQuery: string | null;
    distinctId: string | null;
    properties: Record<string, unknown>;
  } | null;
}

export interface WarehouseQueryResponse {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  cost: {
    rowsRead: number;
    durationMs: number;
  };
  analysis: {
    valid: boolean;
    normalizedSql: string;
    executableSql: string | null;
    hasLimit: boolean;
    autoLimit: number | null;
    diagnostics: Array<{
      code: string;
      level: 'error' | 'warning' | 'success';
      message: string;
    }>;
  };
}

export interface WarehouseSchemaResponse {
  tables: Array<{ name: string; description: string; columns: string[] }>;
  examples: Array<{ name: string; category?: string; sql: string }>;
  /** Server-side query limits (lib/warehouse.ts WAREHOUSE_QUERY_LIMITS). */
  limits?: {
    defaultLimit: number;
    maxUserLimit: number;
    maxRowsRead: number;
    timeoutMs: number;
    exportRowCap: number;
  };
  /** What each data source has imported (row counts, payload fields for HTTP sources). */
  importedSources?: Array<{
    id: string;
    name: string;
    type: string;
    tables: Array<{ name: string; rowCount: number; columns: string[] }>;
    exampleSql: string | null;
  }>;
}

export interface RevenueReportResponse {
  byDay: Array<{ date: string; currency: string; total: number; transactions: number }>;
  byEvent: Array<{ eventName: string; source: 'event' | 'stripe'; currency: string; total: number; transactions: number }>;
  totals: Array<{ currency: string; total: number; transactions: number }>;
}

export interface RevenueMrrPoint {
  period: string;
  at: number;
  currency: string;
  mrr: number;
  arr: number;
  subscribers: number;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnedMrr: number;
  newSubscribers: number;
  churnedSubscribers: number;
  churnRate: number | null;
  arpu: number | null;
}

export interface RevenueSubscriptionsResponse {
  currencies: string[];
  latest: RevenueMrrPoint[];
  series: RevenueMrrPoint[];
}

export type RevenueAttributionDimension = 'utm_source' | 'utm_medium' | 'utm_campaign' | 'referrer_domain';

export interface RevenueAttributionResponse {
  dimension: RevenueAttributionDimension;
  rows: Array<{ value: string | null; currency: string; total: number; transactions: number; customers: number }>;
}

export type FeatureFlagJson =
  | null
  | boolean
  | number
  | string
  | FeatureFlagJson[]
  | { [key: string]: FeatureFlagJson };

export type FeatureFlagConditionField =
  | 'path'
  | 'url'
  | 'hostname'
  | 'referrer'
  | 'language'
  | 'userAgent'
  | 'distinctId'
  | 'userId'
  | 'environment'
  | 'release'
  | 'group'
  | 'property'
  | 'person'
  | 'group_property'
  | 'cohort';

export type FeatureFlagConditionOperator =
  | 'equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'not_equals'
  | 'not_contains'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'exists'
  | 'not_exists'
  | 'in_cohort'
  | 'not_in_cohort';

export interface FeatureFlagCondition {
  field: FeatureFlagConditionField;
  key?: string;
  groupType?: string;
  operator: FeatureFlagConditionOperator;
  value: string;
}

export interface FeatureFlagConditionGroup {
  conditions: FeatureFlagCondition[];
  rollout: number;
  variant?: string | null;
  description?: string;
}

export interface FeatureFlagVariant {
  key: string;
  name: string;
  weight: number;
  payload?: FeatureFlagJson;
}

export interface FeatureFlag {
  id: string;
  websiteId: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  /** First condition group's rollout (legacy mirror). */
  rollout: number;
  variants: FeatureFlagVariant[];
  /** First condition group's conditions (legacy mirror). */
  targetingRules: FeatureFlagCondition[];
  conditionGroups: FeatureFlagConditionGroup[];
  payload: FeatureFlagJson;
  earlyAccess: { name: string; description: string } | null;
  summary?: {
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
  createdAt?: string | number;
  updatedAt?: string | number;
}

export type ExperimentMetricType = 'conversion' | 'count' | 'property_sum' | 'property_mean';

export interface ExperimentMetric {
  type: ExperimentMetricType;
  event: string;
  property?: string;
  name?: string;
}

export interface Experiment {
  id: string;
  websiteId: string;
  featureFlagId: string;
  featureFlagKey?: string;
  featureFlagName?: string;
  name: string;
  description: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
  /** Event of the primary metric. */
  goalEvent: string;
  primaryMetric: ExperimentMetric;
  secondaryMetrics: ExperimentMetric[];
  /** Relative lift in percent the sample-size guidance plans for; null = default. */
  minimumDetectableEffect: number | null;
  startedAt?: string | number | null;
  endedAt?: string | number | null;
  createdAt?: string | number;
  updatedAt?: string | number;
}

export type ExperimentInterval = [number, number];

export interface ExperimentMetricVariantResult {
  variant: string;
  baseline: boolean;
  /** Units contributing a value (for property_mean: units with the property). */
  sampleSize: number;
  /** Conversion rate (fraction) or mean per unit. */
  value: number | null;
  total: number;
  standardDeviation: number | null;
  confidenceInterval: ExperimentInterval | null;
  credibleInterval: ExperimentInterval | null;
  comparison: {
    /** Relative lift as a fraction. */
    lift: number | null;
    difference: number;
    frequentist: {
      pValue: number | null;
      significant: boolean;
      liftInterval: ExperimentInterval | null;
      differenceInterval: ExperimentInterval | null;
    };
    bayesian: { probabilityToBeatControl: number | null; liftInterval: ExperimentInterval | null };
  } | null;
}

export type ExperimentDecision = 'no_data' | 'fix_setup' | 'keep_collecting' | 'ship_variant' | 'keep_control';

export interface ExperimentResults {
  experiment: Experiment;
  window: { startAt: number; endAt: number };
  variants: Array<{
    variant: string;
    baseline: boolean;
    units: number;
    share: number;
    expectedShare: number | null;
  }>;
  srm: {
    status: 'ok' | 'mismatch' | 'insufficient_data' | 'not_applicable';
    reason: 'unexpected_variant' | 'single_arm' | 'targeting_rules' | null;
    pValue: number | null;
    chiSquare: number | null;
    degreesOfFreedom: number | null;
    expectedShares: Record<string, number>;
  } | null;
  metrics: Array<{
    role: 'primary' | 'secondary';
    metric: ExperimentMetric;
    variants: ExperimentMetricVariantResult[];
  }>;
  guidance: {
    metricType: ExperimentMetricType;
    baseline: number | null;
    /** Fraction. */
    minimumDetectableEffect: number;
    requiredUnitsPerVariant: number | null;
    currentUnitsPerVariant: number;
    detectableEffect: number | null;
    estimatedDaysRemaining: number | null;
    alpha: number;
    power: number;
  } | null;
  summary: {
    totalUnits: number;
    excludedUnits: number;
    controlVariant: string | null;
    leaderVariant: string | null;
    leaderLift: number | null;
    significantVariant: string | null;
    bayesianLeader: string | null;
    bayesianLeaderProbability: number | null;
    minimumSampleReached: boolean;
    plannedSampleReached: boolean;
    decision: ExperimentDecision;
    diagnostics: Array<{
      code:
        | 'no_exposures'
        | 'missing_control'
        | 'sample_ratio_mismatch'
        | 'low_sample'
        | 'significant_variant'
        | 'variant_worse'
        | 'no_significant_winner';
      level: 'info' | 'warning' | 'success' | 'error';
    }>;
  };
  recent: Array<{
    id: string;
    sessionId: string;
    variant: string;
    urlPath: string | null;
    exposedAt: number;
    converted: boolean;
    convertedAt: number | null;
  }>;
  trend: Array<{
    date: string;
    variant: string;
    /** Units first exposed that day. */
    units: number;
    /** Primary metric for that day's cohort. */
    value: number | null;
  }>;
}

export interface ExperimentApplyResult {
  appliedVariant: string;
  experiment: Experiment;
  featureFlag: FeatureFlag;
  summary: ExperimentResults['summary'];
}

export interface SurveySummary {
  responses: number;
  sessions: number;
  lastResponseAt: number | null;
  averageRating: number | null;
  breakdown: Array<{ answer: string; responses: number; percentage: number }>;
  sentiment: Array<{
    sentiment: 'positive' | 'negative' | 'neutral';
    responses: number;
    percentage: number;
  }>;
  themes: Array<{ theme: string; responses: number; percentage: number }>;
  pages: Array<{
    urlPath: string;
    responses: number;
    sessions: number;
    lastResponseAt: number | null;
  }>;
  trend: Array<{
    date: string;
    responses: number;
    sessions: number;
    averageRating: number | null;
  }>;
}

export interface Survey {
  id: string;
  websiteId: string;
  name: string;
  /** Legacy mirror of the first question. */
  question: string;
  type: 'text' | 'rating' | 'choice';
  options: string[];
  questions: SurveyQuestion[];
  appearance: SurveyAppearance;
  enabled: boolean;
  triggerPath?: string | null;
  triggerEvent?: string | null;
  displayDelaySeconds: number;
  displayRules?: SurveyDisplayRule[];
  sampleRate: number;
  responseLimit: number | null;
  startsAt: number | null;
  endsAt: number | null;
  repeatIntervalDays: number | null;
  hostedEnabled: boolean;
  slug: string | null;
  createdAt?: string | number;
  updatedAt?: string | number;
  summary?: SurveySummary;
}

export interface SurveyResponse {
  id: string;
  sessionId: string | null;
  visitId: string | null;
  distinctId: string | null;
  answer: string;
  answers: SurveyAnswers;
  completed: boolean;
  source: string;
  urlPath: string | null;
  createdAt: number;
}

type SurveyCountRow = { value: string; count: number; percentage: number };
type SurveySentimentName = 'positive' | 'negative' | 'neutral';

export interface SurveyQuestionResult {
  id: string;
  type: SurveyQuestion['type'];
  question: string;
  answered: number;
  droppedAfter: number;
  rating?: {
    min: number;
    max: number;
    average: number | null;
    distribution: SurveyCountRow[];
    nps: { score: number | null; promoters: number; passives: number; detractors: number } | null;
  };
  choices?: Array<SurveyCountRow & { other: boolean }>;
  otherAnswers?: Array<{ value: string; count: number }>;
  text?: {
    sentiment: Array<{ sentiment: SurveySentimentName; responses: number; percentage: number }>;
    themes: Array<{ theme: string; responses: number; percentage: number }>;
    items: Array<{ responseId: string; value: string; sentiment: SurveySentimentName; createdAt: number }>;
  };
  link?: { clicks: number };
}

export interface SurveyResults {
  total: number;
  completed: number;
  partial: number;
  completionRate: number;
  sampled: boolean;
  trend: Array<{ date: string; responses: number; completed: number; partial: number }>;
  questions: SurveyQuestionResult[];
}

export interface SurveyResponsesResponse {
  survey: Survey;
  summary: SurveySummary;
  results: SurveyResults;
  responses: SurveyResponse[];
}

export interface PersonSummary {
  personId: string;
  latestEmail: string | null;
  latestName: string | null;
  latestAlias: string | null;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  sessions: number;
  visits: number;
  pageviews: number;
  events: number;
  country: string | null;
  city: string | null;
}

export interface PeopleResponse {
  people: PersonSummary[];
  startAt: number;
  endAt: number;
}

export interface PersonDetailResponse {
  personId: string;
  properties: Array<{ key: string; value: string | null; updatedAt: number | null }>;
  sessions: Array<{
    id: string;
    browser: string | null;
    os: string | null;
    device: string | null;
    country: string | null;
    city: string | null;
    createdAt: number | null;
    events: number;
    lastSeenAt: number | null;
  }>;
  events: Array<{
    id: string;
    sessionId: string;
    visitId: string;
    urlPath: string | null;
    eventName: string | null;
    eventType: number;
    createdAt: number;
  }>;
}

export interface MetricRow {
  x: string;
  y: number;
  visitors?: number;
  avgTime?: number;
}

export interface Team {
  id: string;
  name: string;
  accessCode?: string;
  role?: string;
  createdAt?: string | number;
  /** Members must have two-factor authentication on to reach the team's websites. */
  requireTwoFactor?: boolean;
}

/** One row of `/api/me/audit-log` and `/api/teams/:teamId/audit-log`. */
export interface AuditLogEntry {
  id: string;
  userId: string | null;
  username: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | number | null;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ShareLink {
  id: string;
  name: string;
  slug: string;
  entityId: string;
  /** 1 website, 4 board, 5 insight. */
  shareType?: number;
  expiresAt?: string | number | null;
  createdAt?: string | number;
}

export interface RealtimeSession {
  sessionId: string;
  urlPath: string;
  referrerDomain: string | null;
  country: string | null;
  createdAt: number;
}

export interface RealtimeWindow30 {
  visitors: number;
  pageviews: number;
  visits: number;
}

export interface RealtimeData {
  visitors: number;
  sessions: RealtimeSession[];
  pageviews: Array<{ id: string; sessionId: string; urlPath: string; createdAt: number }>;
  window30?: RealtimeWindow30;
}

export interface LinkStats {
  clicks: number;
  visitors: number;
  series: MetricRow[];
  startAt?: number;
  endAt?: number;
}

export interface Segment {
  id: string;
  websiteId: string;
  type: string;
  name: string;
  parameters: Record<string, unknown>;
}

export interface RevenueSummary {
  summary: Array<{ currency: string; total: number; transactions: number }>;
  sessions: Array<{
    sessionId: string;
    currency: string;
    revenue: number;
    transactions: number;
  }>;
}

export interface TrackingLink {
  id: string;
  name: string;
  url: string;
  slug: string;
  teamId?: string;
}

export interface TrackingPixel {
  id: string;
  name: string;
  slug: string;
  teamId?: string;
}

export interface UtmBreakdownRow {
  name: string;
  pageviews: number;
}

export interface UtmReportResponse {
  campaign: UtmBreakdownRow[];
  content: UtmBreakdownRow[];
  medium: UtmBreakdownRow[];
  source: UtmBreakdownRow[];
  term: UtmBreakdownRow[];
  segmentId: string | null;
  startAt: number;
  endAt: number;
}

export interface AdminUser {
  id: string;
  username: string;
  role: string;
}

export type WebsiteModule =
  | 'analytics'
  | 'boards'
  | 'featureFlags'
  | 'experiments'
  | 'errors'
  | 'logs'
  | 'surveys'
  | 'warehouse'
  | 'settings'
  | 'team';

export interface WebsitePermissions {
  role: string;
  canView: boolean;
  canEdit: boolean;
  canManageTeam: boolean;
  capabilities: {
    viewAnalytics: boolean;
    editWebsite: boolean;
    manageMembers: boolean;
    manageWebsites: boolean;
  };
  modules: Record<WebsiteModule, { canView: boolean; canEdit: boolean }>;
}

export interface WarehouseSavedQuery {
  id: string;
  websiteId: string;
  name: string;
  description: string;
  sql: string;
  analysis?: WarehouseQueryResponse['analysis'];
  createdAt?: number;
  updatedAt?: number;
}

export interface WarehouseQueryHistoryEntry {
  id: string;
  sql: string;
  status: 'success' | 'failed';
  rowCount: number;
  error: string | null;
  durationMs: number;
  createdAt: number;
}

export interface WarehouseScheduledQuery {
  id: string;
  websiteId: string;
  name: string;
  description: string;
  sql: string;
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: number;
  lastRunAt: number | null;
  lastStatus: 'success' | 'failed' | null;
  lastRowCount: number | null;
  lastError: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface WarehouseDataSource {
  id: string;
  websiteId: string;
  name: string;
  /** Supported connectors; sources of removed types (postgres, mysql, …) can still be listed and deleted. */
  type: 'http_json' | 'http_csv' | 'stripe' | (string & {});
  enabled: boolean;
  config: Record<string, unknown>;
  lastSyncAt: number | null;
  lastStatus: 'connected' | 'failed' | 'syncing' | null;
  lastError: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface LogTraceSummary {
  traceId: string;
  spans: number;
  services: number;
  rootName: string | null;
  rootService: string | null;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  maxSpanDurationMs: number;
  hasError: boolean;
  sessionId: string | null;
}

export interface LogTraceSpan {
  id: string;
  source: LogSource;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  service: string | null;
  release: string | null;
  environment: string | null;
  createdAt: number;
  startUs: number;
  durationUs: number;
  durationMs: number;
  status: 'unset' | 'ok' | 'error';
  statusMessage: string | null;
  sessionId: string | null;
  attributes: Record<string, unknown> | null;
  resource: Record<string, unknown> | null;
  events: Array<{ name: string; timeUs: number; attributes: Record<string, unknown> }>;
  links: Array<{ traceId: string; spanId: string; attributes: Record<string, unknown> }>;
}

export interface LogTraceDetail {
  traceId: string;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number;
  services: string[];
  sessionId: string | null;
  spans: LogTraceSpan[];
  logs: LogEvent[];
}

export interface LogAttributeFilter {
  key: string;
  value?: string;
}

export interface LogSavedFilter {
  id: string;
  websiteId: string;
  name: string;
  filters: {
    level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    search?: string;
    release?: string;
    environment?: string;
    service?: string;
    traceId?: string;
    sessionId?: string;
    source?: LogSource;
    attributes?: LogAttributeFilter[];
  };
  isDefault: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface LogAlertRule {
  id: string;
  websiteId: string;
  name: string;
  enabled: boolean;
  threshold: number;
  windowMinutes: number;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | null;
  service: string | null;
  search: string | null;
  release: string | null;
  environment: string | null;
  attributeKey: string | null;
  attributeValue: string | null;
  channel: 'record' | 'email' | 'webhook';
  target: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface ErrorSourceMap {
  id: string;
  release: string;
  file: string;
  size: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface ErrorAlertRule {
  id: string;
  websiteId: string;
  name: string;
  enabled: boolean;
  threshold: number;
  windowMinutes: number;
  severity: 'fatal' | 'error' | 'warning' | 'info' | null;
  release: string | null;
  environment: string | null;
  channel: 'record' | 'email' | 'webhook';
  target: string | null;
  /** Also notify when a resolved issue occurs again. */
  notifyRegressions: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface SurveyDisplayRule {
  field: 'path' | 'event' | 'property' | 'language' | 'country' | 'device';
  key?: string;
  operator:
    | 'equals'
    | 'contains'
    | 'starts_with'
    | 'ends_with'
    | 'not_equals'
    | 'not_contains'
    | 'exists'
    | 'not_exists';
  value: string;
}

export interface FeatureFlagEvaluateResult {
  key: string;
  enabled: boolean;
  variant: string | boolean | null;
  reason: string;
  conditionGroup?: number | null;
  payload?: FeatureFlagJson;
}

export interface FeatureFlagHistoryEntry {
  id: string;
  userId: string;
  username: string;
  action: 'create' | 'update' | 'delete';
  metadata: {
    key?: string;
    changes?: string[];
    before?: Partial<FeatureFlag> | null;
    after?: Partial<FeatureFlag> | null;
    experimentId?: string;
  } | null;
  createdAt: string | number;
}

export interface FeatureFlagHistoryPage {
  items: FeatureFlagHistoryEntry[];
  page: number;
  pageSize: number;
  total: number;
}
