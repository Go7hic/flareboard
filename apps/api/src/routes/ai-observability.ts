import type { Context } from 'hono';
import { LLM_PRICE_TABLE, LLM_PRICES_REVIEWED_AT, llmSettingsSchema } from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { parseStatsRange } from '../lib/parse-range';
import { requireWebsite } from '../lib/website';
import { getAiEvents, getAiStats, getAiTrace, getAiTraces, getAiUsers, type AiFilters } from '../lib/ai-observability';
import { getLlmSettings, loadPriceOverrides, saveLlmSettings } from '../lib/llm-settings';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

const DAY = 24 * 60 * 60 * 1000;

function normalizeOptionalParam(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

function numberParam(value: string | undefined) {
  if (value == null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function filtersFrom(c: Ctx): AiFilters {
  return {
    model: normalizeOptionalParam(c.req.query('model')),
    status: normalizeOptionalParam(c.req.query('status')),
    provider: normalizeOptionalParam(c.req.query('provider')),
    quality: normalizeOptionalParam(c.req.query('quality')),
    release: normalizeOptionalParam(c.req.query('release')),
    environment: normalizeOptionalParam(c.req.query('environment')),
    distinctId: normalizeOptionalParam(c.req.query('distinctId')),
  };
}

function limitFrom(c: Ctx, fallback: number) {
  return Math.round(numberParam(c.req.query('limit')) ?? fallback);
}

/** Overview: stats (cost, tokens, latency percentiles, errors, trend, breakdowns) and recent calls. */
export async function handleList(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  const filters = filtersFrom(c);
  const overrides = await loadPriceOverrides(c.env, website.websiteId);
  const options = { timezone: website.timezone, overrides };
  const [stats, events] = await Promise.all([
    getAiStats(c.env, website.websiteId, startAt, endAt, filters, options),
    getAiEvents(c.env, website.websiteId, startAt, endAt, filters, 100, options),
  ]);
  return json({ stats, events });
}

export async function handleTraces(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  const error = c.req.query('error');
  const result = await getAiTraces(
    c.env,
    website.websiteId,
    startAt,
    endAt,
    {
      ...filtersFrom(c),
      error: error === 'true' ? true : error === 'false' ? false : undefined,
      minCostUsd: numberParam(c.req.query('minCost')),
      maxCostUsd: numberParam(c.req.query('maxCost')),
    },
    limitFrom(c, 100),
  );
  return json(result);
}

/**
 * One trace. `at` (ms, a time inside the trace, e.g. its start from the list) narrows the search
 * to a day either side; without it the last 30 days are searched.
 */
export async function handleTrace(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const traceId = c.req.param('traceId')?.trim();
  if (!traceId || traceId.length > 200) return notFound();
  const at = numberParam(c.req.query('at'));
  const now = Date.now();
  const startAt = at != null ? at - DAY : now - 30 * DAY;
  const endAt = at != null ? at + DAY : now;
  const trace = await getAiTrace(c.env, website.websiteId, traceId, startAt, endAt);
  if (!trace) return notFound('Trace not found');
  return json(trace);
}

export async function handleUsers(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  return json(await getAiUsers(c.env, website.websiteId, startAt, endAt, filtersFrom(c), limitFrom(c, 100)));
}

function builtInPrices() {
  return LLM_PRICE_TABLE.map((entry) => ({
    model: entry.model,
    provider: entry.provider,
    inputPerMillion: entry.input,
    outputPerMillion: entry.output,
    cacheReadPerMillion: entry.cacheRead ?? null,
    cacheWritePerMillion: entry.cacheWrite ?? null,
  }));
}

export async function handleSettingsGet(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  return json({
    ...(await getLlmSettings(c.env, website.websiteId)),
    builtInPrices: builtInPrices(),
    pricesReviewedAt: LLM_PRICES_REVIEWED_AT,
  });
}

export async function handleSettingsUpdate(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const parsed = llmSettingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.message);
  const settings = await saveLlmSettings(c.env, website.websiteId, parsed.data);
  return json({ ...settings, builtInPrices: builtInPrices(), pricesReviewedAt: LLM_PRICES_REVIEWED_AT });
}
