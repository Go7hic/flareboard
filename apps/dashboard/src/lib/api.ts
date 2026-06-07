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

export type ApiInit = RequestInit & { token?: string };

/** Paths where 401 means invalid credentials, not an expired session. */
const AUTH_FORM_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
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

export interface MetricRow {
  x: string;
  y: number;
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

export interface RealtimeData {
  visitors: number;
  sessions: RealtimeSession[];
  pageviews: Array<{ id: string; sessionId: string; urlPath: string; createdAt: number }>;
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
