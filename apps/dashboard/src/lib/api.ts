import { apiReturnedHtmlError, apiUrlConfigError, resolveApiUrl } from './api-url';

const TOKEN_KEY = 'flareboard_token';

export const INGEST_URL =
  (import.meta.env.VITE_INGEST_URL ?? 'http://localhost:8787').replace(/\/$/, '');

export const API_URL = resolveApiUrl();

function assertApiUrl(): void {
  if (API_URL) return;
  if (import.meta.env.DEV) return;
  throw new Error(apiUrlConfigError());
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function logoutSession(): Promise<void> {
  const token = getToken();
  if (token && API_URL) {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    } catch {
      // Network errors should not block local sign-out.
    }
  }
  setToken(null);
}

export type ApiInit = RequestInit & { token?: string };

/** Paths where 401 means invalid credentials, not an expired session. */
const AUTH_FORM_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/logout',
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

export function clearSessionAndRedirectToLogin(): void {
  if (sessionRedirectPending) return;
  const { pathname, search } = window.location;
  if (pathname === '/login') return;

  sessionRedirectPending = true;
  setToken(null);
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

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Authenticated fetch with shared 401 handling. */
export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  assertApiUrl();
  const headers = new Headers(init.headers);
  const auth = getToken();
  if (auth) headers.set('Authorization', `Bearer ${auth}`);

  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const res = await fetch(url, { ...init, headers });
  handleUnauthorizedIfNeeded(path, res.status);
  return res;
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  assertApiUrl();
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const auth = token ?? getToken();
  if (auth) headers.set('Authorization', `Bearer ${auth}`);

  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const res = await fetch(url, { ...rest, headers });
  if (!res.ok) {
    handleUnauthorizedIfNeeded(path, res.status);
    const err = await parseJsonBody<{ message?: string }>(res).catch(() => ({
      message: res.statusText,
    }));
    throw new ApiError(err.message || 'Request failed', res.status);
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
  token: string;
  user: { id: string; username: string; role: string };
}

export interface Website {
  id: string;
  name: string;
  domain?: string;
  userId?: string;
  createdAt?: string | number;
  replayEnabled?: boolean;
  goalConfig?: { goals: Array<{ event: string; target: number; period: string }> };
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

export type InsightType = 'trend' | 'funnel' | 'retention' | 'path' | 'stickiness' | 'table';

export type InsightQuery = {
  event?: string | null;
  events?: string[];
  path?: string | null;
  steps?: string[];
  metric?: 'pageviews' | 'visitors' | 'visits' | 'events';
  dimension?: string;
  actor?: 'person' | 'session';
  unit?: 'hour' | 'day' | 'week' | 'month';
  limit?: number;
};

export interface Insight {
  id: string;
  websiteId: string;
  userId: string;
  type: InsightType;
  name: string;
  description: string;
  query: InsightQuery;
  createdAt: number | null;
  updatedAt: number | null;
}

export type InsightResult =
  | { kind: 'trend'; series: Array<{ x: string; y: number }>; startAt: number; endAt: number; event?: string; metric?: string }
  | { kind: 'funnel'; steps: Array<{ step: string; count: number; rate: number }>; conversion: number; startAt: number; endAt: number }
  | { kind: 'retention'; cohorts: Array<{ cohortWeek: string; weekOffset: number; users: number }>; startAt: number; endAt: number }
  | { kind: 'path'; prefix: string[]; depth: number; total: number; next: Array<{ path: string; count: number }>; paths: Array<{ path: string; count: number }>; startAt: number; endAt: number }
  | { kind: 'stickiness'; distribution: Array<{ activeDays: number; actors: number; events: number; percentage: number }>; totalActors: number; actorDays: number; averageActiveDays: number; startAt: number; endAt: number }
  | { kind: 'table'; dimension: string; rows: MetricRow[]; startAt: number; endAt: number };

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
}

export interface ErrorIssue {
  fingerprint: string;
  message: string | null;
  name: string | null;
  severity: string | null;
  events: number;
  sessions: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  latestEventId: string | null;
  status: 'open' | 'resolved' | 'ignored';
  note: string | null;
  stateUpdatedAt: number | null;
  samples: ErrorEvent[];
}

export interface ErrorEventsResponse {
  stats: {
    errors: number;
    sessions: number;
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

export interface ErrorEventDetail extends ErrorEvent {
  properties: Array<{ key: string; value: string | null }>;
  resolvedStack?: Array<{
    raw: string;
    functionName: string | null;
    file: string;
    line: number;
    column: number;
    source: string | null;
    sourceLine: number | null;
    sourceColumn: number | null;
    resolved: boolean;
  }>;
}

export interface LogEvent {
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
  level: string | null;
  release: string | null;
  environment: string | null;
}

export interface LogEventsResponse {
  stats: {
    logs: number;
    sessions: number;
    lastSeenAt: number | null;
    levels: Array<{ level: string; logs: number }>;
    trend: Array<{ date: string; logs: number; sessions: number }>;
    releases: Array<{ release: string; logs: number }>;
    environments: Array<{ environment: string; logs: number }>;
  };
  logs: LogEvent[];
}

export interface AiObservationEvent {
  id: string;
  sessionId: string;
  visitId: string;
  urlPath: string;
  createdAt: number;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  status: string | null;
  quality: string | null;
  release: string | null;
  environment: string | null;
}

export interface AiObservabilityResponse {
  stats: {
    calls: number;
    sessions: number;
    tokens: number;
    costUsd: number;
    errors: number;
    avgLatencyMs: number | null;
    models: Array<{
      model: string;
      calls: number;
      tokens: number;
      costUsd: number;
      errors: number;
      avgLatencyMs: number | null;
      errorRate: number;
    }>;
    statuses: Array<{ status: string; calls: number }>;
    providers: Array<{ provider: string; calls: number; costUsd: number; errors: number }>;
    qualities: Array<{ quality: string; calls: number }>;
    releases: Array<{ release: string; calls: number; costUsd: number; errors: number }>;
    environments: Array<{ environment: string; calls: number; costUsd: number; errors: number }>;
    trend: Array<{
      date: string;
      calls: number;
      sessions: number;
      tokens: number;
      costUsd: number;
      errors: number;
      avgLatencyMs: number | null;
    }>;
  };
  events: AiObservationEvent[];
}

export interface WorkflowSummary {
  executions: number;
  lastExecutionAt: number | null;
  failures: number;
  successes: number;
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

export interface Workflow {
  id: string;
  websiteId: string;
  name: string;
  triggerEvent: string;
  enabled: boolean;
  actionType: 'record' | 'webhook' | 'email';
  actionConfig: { note?: string; url?: string; email?: string };
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
  status: string;
  error: string | null;
  createdAt: number;
}

export interface WorkflowExecutionsResponse {
  workflow: Workflow;
  summary: WorkflowSummary;
  executions: WorkflowExecution[];
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
}

export interface FeatureFlag {
  id: string;
  websiteId: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rollout: number;
  variants: Array<{ key: string; name: string; weight: number }>;
  targetingRules: Array<{
    field:
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
      | 'property';
    key?: string;
    operator:
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
      | 'not_exists';
    value: string;
  }>;
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

export interface Experiment {
  id: string;
  websiteId: string;
  featureFlagId: string;
  featureFlagKey?: string;
  featureFlagName?: string;
  name: string;
  description: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
  goalEvent: string;
  startedAt?: string | number | null;
  endedAt?: string | number | null;
  createdAt?: string | number;
  updatedAt?: string | number;
}

export interface ExperimentResults {
  experiment: Experiment;
  summary: {
    totalExposures: number;
    totalConversions: number;
    conversionRate: number;
    controlVariant: string | null;
    controlConversionRate: number | null;
    leaderVariant: string | null;
    leaderConversionRate: number | null;
    leaderLift: number | null;
    significantVariant: string | null;
    maxConfidence: number | null;
    trafficImbalanced: boolean;
    sampleReady: boolean;
    sampleSize: {
      minimumExposuresPerVariant: number;
      minimumConversions: number;
      currentMinExposures: number;
      remainingExposures: number;
      remainingConversions: number;
      ready: boolean;
    };
    decision: 'no_data' | 'fix_setup' | 'keep_collecting' | 'ship_variant' | 'keep_control';
    recommendation: 'no_data' | 'collect_more_data' | 'variant_leading' | 'control_leading' | 'no_control';
    conclusion: {
      status: 'no_data' | 'setup_issue' | 'collecting' | 'winner' | 'keep_control';
      variant: string | null;
      action: 'no_data' | 'fix_setup' | 'keep_collecting' | 'ship_variant' | 'keep_control';
      confidence: number | null;
    };
    diagnostics: Array<{
      code:
        | 'no_exposures'
        | 'missing_control'
        | 'low_sample'
        | 'traffic_imbalanced'
        | 'significant_variant'
        | 'no_significant_winner';
      level: 'info' | 'warning' | 'success';
    }>;
  };
  variants: Array<{
    variant: string;
    exposures: number;
    conversions: number;
    conversionRate: number;
    lift: number | null;
    baseline: boolean;
    confidenceIntervalLow: number;
    confidenceIntervalHigh: number;
    pValue: number | null;
    confidence: number | null;
    significant: boolean;
  }>;
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
    exposures: number;
    conversions: number;
    conversionRate: number;
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
  question: string;
  type: 'text' | 'rating' | 'choice';
  options: string[];
  enabled: boolean;
  triggerPath?: string | null;
  triggerEvent?: string | null;
  displayDelaySeconds: number;
  displayRules?: SurveyDisplayRule[];
  createdAt?: string | number;
  updatedAt?: string | number;
  summary?: SurveySummary;
}

export interface SurveyResponse {
  id: string;
  sessionId: string | null;
  visitId: string | null;
  answer: string;
  urlPath: string | null;
  createdAt: number;
}

export interface SurveyResponsesResponse {
  survey: Survey;
  summary: SurveySummary;
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
}

export interface ShareLink {
  id: string;
  name: string;
  slug: string;
  entityId: string;
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

/** @deprecated Use UtmReportResponse — legacy flat rows removed from API. */
export interface UtmRow {
  source: string;
  medium: string;
  campaign: string;
  pageviews: number;
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
  type: 'http_json' | 'http_csv' | 'r2_json' | 'd1' | 'postgres' | 'mysql';
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
  hasError: boolean;
  durationMs: number | null;
  startedAt: number | null;
  lastSeenAt: number | null;
}

export interface LogTraceSpan {
  id: string;
  spanId: string;
  parentSpanId: string | null;
  service: string;
  operation: string | null;
  level: string | null;
  message: string | null;
  durationMs: number | null;
  status: string | null;
  createdAt: number;
}

export interface LogTraceDetail {
  traceId: string;
  spans: LogTraceSpan[];
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
  variant: string | null;
  reason: string;
}
