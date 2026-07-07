import type { Context } from 'hono';
import type { FeatureFlagEvaluationContext } from '@flareboard/shared';
import type { Env } from '../env';
import { evaluateFlagRow, getEnabledFlagsByKeys } from '../lib/feature-flags';
import { getWebsiteById } from '../lib/queries';
import { checkIpRateLimit, getTrustedClientIp } from '../lib/rate-limit';
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
  };
}

export async function handleEvaluate(c: Context<{ Bindings: Env }>) {
  const rl = await checkIpRateLimit(c.env, 'feature-flag-evaluate', getTrustedClientIp(c.req.raw), 120, 60);
  if (!rl.allowed) {
    return json({ message: 'Rate limit exceeded' }, 429);
  }

  const body = (await c.req.json().catch(() => null)) as EvaluateBody | null;
  const websiteId = cleanText(body?.website);
  if (!websiteId) return badRequest('website is required');

  const keys = Array.isArray(body?.keys)
    ? body.keys.map((key) => cleanText(key)).filter((key): key is string => Boolean(key))
    : [];
  if (!keys.length) return badRequest('keys is required');

  const website = await getWebsiteById(c.env, websiteId);
  if (!website) return notFound();

  const context = parseContext(body?.context);
  const rows = await getEnabledFlagsByKeys(c.env, websiteId, keys);
  const results: Record<string, string | boolean> = {};

  for (const key of keys) {
    const row = rows.find((item) => item.key === key);
    if (!row) {
      results[key] = false;
      continue;
    }
    const evaluation = evaluateFlagRow(row, context);
    results[key] = evaluation.variant;
  }

  return json({ results });
}
