import type { Context } from 'hono';
import type { FeatureFlagEvaluationContext, FeatureFlagJsonValue } from '@flareboard/shared';
import type { Env } from '../env';
import { evaluateFlags, flagConfig, getEnabledFlagsByKeys } from '../lib/feature-flags';
import { getWebsiteById } from '../lib/queries';
import { checkIpRateLimit, checkProjectKeyRateLimit, getTrustedClientIp } from '../lib/rate-limit';
import { resolveWebsiteRef } from '../lib/project-keys';
import { badRequest, json, notFound } from '../lib/response';

type EvaluateBody = {
  website?: string;
  keys?: string[];
  context?: Record<string, unknown>;
};

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cleanRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function parseContext(raw: Record<string, unknown> | undefined): FeatureFlagEvaluationContext {
  return {
    distinctId: cleanText(raw?.distinctId),
    userId: cleanText(raw?.userId),
    sessionId: cleanText(raw?.sessionId),
    visitId: cleanText(raw?.visitId),
    anonymousId: cleanText(raw?.anonymousId),
    path: cleanText(raw?.path),
    url: cleanText(raw?.url),
    hostname: cleanText(raw?.hostname),
    referrer: cleanText(raw?.referrer),
    language: cleanText(raw?.language),
    userAgent: cleanText(raw?.userAgent),
    environment: cleanText(raw?.environment),
    release: cleanText(raw?.release),
    groups: cleanRecord(raw?.groups),
    properties: cleanRecord(raw?.properties),
    // Caller-supplied overrides, merged over the stored ones (as PostHog's /decide does).
    personProperties: cleanRecord(raw?.personProperties),
    groupProperties: cleanRecord(raw?.groupProperties) as Record<string, Record<string, unknown>> | undefined,
  };
}

export async function handleEvaluate(c: Context<{ Bindings: Env }>) {
  const body = (await c.req.json().catch(() => null)) as EvaluateBody | null;
  const websiteRef = cleanText(body?.website);
  if (!websiteRef) return badRequest('website is required');
  const ref = await resolveWebsiteRef(c.env, websiteRef);
  if (!ref) return notFound();
  const websiteId = ref.websiteId;

  const rl = ref.projectKey
    ? await checkProjectKeyRateLimit(c.env, ref.projectKey, 'flags')
    : await checkIpRateLimit(c.env, 'feature-flag-evaluate', getTrustedClientIp(c.req.raw), 120, 60);
  if (!rl.allowed) {
    return json({ message: 'Rate limit exceeded' }, 429);
  }

  const keys = Array.isArray(body?.keys)
    ? [...new Set(body.keys.map((key) => cleanText(key)).filter((key): key is string => Boolean(key)))].slice(0, 200)
    : [];
  if (!keys.length) return badRequest('keys is required');

  const website = await getWebsiteById(c.env, websiteId);
  if (!website) return notFound();

  const context = parseContext(body?.context);
  const rows = await getEnabledFlagsByKeys(c.env, websiteId, keys);
  const configs = rows.map(flagConfig);
  const evaluations = await evaluateFlags(c.env, websiteId, configs, context);
  const results: Record<string, string | boolean> = {};
  const payloads: Record<string, FeatureFlagJsonValue> = {};

  for (const key of keys) results[key] = false;
  evaluations.forEach((evaluation) => {
    results[evaluation.key] = evaluation.variant;
    if (evaluation.enabled && evaluation.payload !== null) payloads[evaluation.key] = evaluation.payload;
  });

  return json({ results, payloads });
}
