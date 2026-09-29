import { computeErrorFingerprint, ERROR_FINGERPRINT_PROPERTY } from '@flareboard/shared';
import type { Env } from '../env';
import { fetchApi } from './api-client';

type ErrorPayloadInput = {
  data?: Record<string, unknown> | null;
  message?: string;
  name?: string;
  errorName?: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  severity?: string;
  handled?: boolean;
  release?: string;
  environment?: string;
};

/**
 * Event properties stored for an error event, including the issue fingerprint
 * (`$exception_fingerprint`). A string or string array the caller put in
 * `data.$exception_fingerprint` is used as a custom grouping key.
 */
export function buildErrorEventDataPayload(input: ErrorPayloadInput) {
  const message = input.message ?? input.name ?? 'Unknown error';
  const errorName = input.errorName ?? 'Error';
  const { fingerprint } = computeErrorFingerprint({
    type: errorName,
    message,
    stack: input.stack,
    custom: input.data?.[ERROR_FINGERPRINT_PROPERTY],
  });
  return {
    ...(input.data ?? {}),
    message,
    name: errorName,
    stack: input.stack,
    source: input.source,
    lineno: input.lineno,
    colno: input.colno,
    severity: input.severity ?? 'error',
    handled: input.handled ?? false,
    release: input.release,
    environment: input.environment,
    [ERROR_FINGERPRINT_PROPERTY]: fingerprint,
  };
}

/** Written by the API for every fingerprint of a resolved issue (see apps/api error-issue-keys.ts). */
function resolvedIssueKvKey(websiteId: string, fingerprint: string) {
  return `error-resolved:${websiteId}:${fingerprint}`;
}

// An error storm on a freshly regressed issue must not turn into one API call per event while
// the KV entry is still cached at the edge: report each issue at most once a minute per isolate.
const REPORT_INTERVAL_MS = 60_000;
const recentReports = new Map<string, number>();

export type PossibleRegression = {
  websiteId: string;
  fingerprint: string;
  occurredAt: number;
  eventId: string;
  release?: string | null;
  environment?: string | null;
  severity?: string | null;
  title?: string | null;
};

/**
 * Regression fast path: one KV read per error event. When the fingerprint belongs to a resolved
 * issue resolved before this occurrence, ask the API to reopen it (the API decides atomically;
 * repeated reports are harmless). Returns true when a report was sent.
 */
export async function reportPossibleRegression(env: Env, input: PossibleRegression, now = Date.now()) {
  const entry = await env.CACHE.get<{ issue?: string; resolvedAt?: number }>(
    resolvedIssueKvKey(input.websiteId, input.fingerprint),
    { type: 'json', cacheTtl: 60 },
  );
  if (!entry?.issue || (entry.resolvedAt ?? 0) >= input.occurredAt) return false;

  const reportKey = `${input.websiteId}:${entry.issue}`;
  const last = recentReports.get(reportKey);
  if (last && now - last < REPORT_INTERVAL_MS) return false;
  recentReports.set(reportKey, now);
  if (recentReports.size > 1000) recentReports.delete(recentReports.keys().next().value!);

  const request = fetchApi(env, '/api/internal/errors/regressions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.APP_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, fingerprint: entry.issue, title: input.title?.slice(0, 1200) ?? null }),
  });
  if (!request) return false;
  const response = await request;
  if (!response.ok) {
    // Let the next event (or the API's hourly sweep) try again.
    recentReports.delete(reportKey);
    console.warn(JSON.stringify({ event: 'error_regression_report_failed', websiteId: input.websiteId, status: response.status }));
    return false;
  }
  return true;
}

/** Test hook: forget rate-limited reports. */
export function resetRegressionReports() {
  recentReports.clear();
}
