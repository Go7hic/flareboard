import type { Context } from 'hono';
import { featureFlagNeedsServerEvaluation, type FeatureFlagJsonValue } from '@flareboard/shared';
import type { Env } from '../env';
import { flagConfig, getEnabledFlags, type FlagRow } from '../lib/feature-flags';
import { getWebsiteById } from '../lib/queries';
import { resolveWebsiteRef } from '../lib/project-keys';
import { listActiveSurveys } from '../lib/surveys';
import { badRequest, json, notFound } from '../lib/response';

/**
 * What the tracker needs about one enabled flag. Conditions never leave the server: flags that
 * need them (`targeted`) are evaluated through POST /api/feature-flags/evaluate. `rollout` and
 * `variants[].weight` drive the tracker's local evaluation of untargeted flags. Payloads are
 * public by design (the dashboard says so); `payload` / `variants[i].payload` appear only when set.
 */
export function trackerFlag(row: FlagRow) {
  const config = flagConfig(row);
  const [firstGroup] = config.conditionGroups;
  const flag: {
    key: string;
    enabled: boolean;
    rollout: number;
    variants: Array<{ key: string; name: string; weight: number; payload?: FeatureFlagJsonValue }>;
    targeted: boolean;
    payload?: FeatureFlagJsonValue;
  } = {
    key: config.key,
    enabled: config.enabled,
    rollout: firstGroup?.rollout ?? 100,
    variants: config.variants.map((variant) => ({
      key: variant.key,
      name: variant.name ?? variant.key,
      weight: variant.weight ?? 0,
      ...(variant.payload !== undefined && variant.payload !== null ? { payload: variant.payload } : {}),
    })),
    targeted: featureFlagNeedsServerEvaluation(config),
  };
  if (!config.variants.length && config.payload !== null) flag.payload = config.payload;
  return flag;
}

/** Longest minimum duration the dashboard offers; longer values are clamped. */
export const MAX_REPLAY_MIN_DURATION_MS = 60_000;

/**
 * Selector list typed in the dashboard ("one per line or comma-separated"). Lines are joined with
 * commas: a newline inside a CSS selector would otherwise act as a descendant combinator.
 */
function selectorList(value: unknown) {
  if (typeof value !== 'string') return null;
  const joined = value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,$/, '').trim())
    .filter(Boolean)
    .join(', ');
  return joined.slice(0, 1000) || null;
}

/**
 * Session replay settings for recorder.js, normalized from website.replay_config (saved by the
 * dashboard's ReplayConfigWizard). Missing config means the safe defaults: mask every input,
 * record every visit, no console or network capture, block nothing beyond the built-in
 * `[data-fb-no-capture]` / `.ph-no-capture` elements (see src/tracker/recorder.ts).
 */
export function replaySettings(raw: unknown) {
  const cfg = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rate = typeof cfg.sampleRate === 'number' && Number.isFinite(cfg.sampleRate) ? cfg.sampleRate : 1;
  const minSeconds =
    typeof cfg.minDurationSeconds === 'number' && Number.isFinite(cfg.minDurationSeconds) ? cfg.minDurationSeconds : 0;
  return {
    sampleRate: Math.min(1, Math.max(0, rate)),
    maskInputs: cfg.maskInputs !== false,
    maskAllText: cfg.maskAllText === true,
    maskSelector: selectorList(cfg.maskSelectors),
    blockSelector: selectorList(cfg.blockSelectors),
    console: cfg.captureConsole === true,
    network: cfg.captureNetwork === true,
    minDurationMs: Math.min(MAX_REPLAY_MIN_DURATION_MS, Math.max(0, Math.round(minSeconds * 1000))),
  };
}

/**
 * The tracker config JSON for a website (KV-cached for 60s), or null when the website does not
 * exist. Shared by /api/tracker-config and the headless /api/surveys endpoint.
 */
export async function getTrackerConfigJson(env: Env, websiteId: string): Promise<string | null> {
  const cacheKey = `tracker-config:${websiteId}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) return cached;

  const website = await getWebsiteById(env, websiteId);
  if (!website) return null;

  const heatmapConfig = (website.heatmapConfig ?? {}) as { sampleRate?: number; enabled?: boolean };
  const replayConfig = (website.replayConfig ?? {}) as { heatmapSampleRate?: number };
  const sampleRate = heatmapConfig.sampleRate ?? replayConfig.heatmapSampleRate ?? 0.1;
  const [flags, surveys] = await Promise.all([getEnabledFlags(env, websiteId), listActiveSurveys(env, websiteId)]);

  const payload = {
    websiteId: website.websiteId,
    // Tracker behavior. script.js lets data-autocapture / data-persistence="false" /
    // data-respect-dnt on the script tag override these per page.
    autocapture: website.autocapture !== false,
    persistence: website.persistVisitors === true,
    respectDnt: website.respectDnt === true,
    replay: replaySettings(website.replayConfig),
    heatmapSampleRate: Math.min(1, Math.max(0, sampleRate)),
    heatmapEnabled: heatmapConfig.enabled !== false,
    featureFlags: flags.map(trackerFlag),
    earlyAccessFeatures: flags
      .filter((flag) => Boolean(flag.earlyAccess))
      .map((flag) => ({
        flagKey: flag.key,
        name: flag.earlyAccessName || flag.name,
        description: flag.earlyAccessDescription,
      })),
    surveys,
  };
  const body = JSON.stringify(payload);
  await env.CACHE.put(cacheKey, body, { expirationTtl: 60 });
  return body;
}

export async function handleTrackerConfig(c: Context<{ Bindings: Env }>) {
  // `key` is what script.js sends for data-project-key (and `website` accepts a key as well).
  const websiteRef = c.req.query('website') ?? c.req.query('key');
  if (!websiteRef) return badRequest('website query param required');
  const websiteId = (await resolveWebsiteRef(c.env, websiteRef))?.websiteId;
  if (!websiteId) return notFound();
  const body = await getTrackerConfigJson(c.env, websiteId);
  if (!body) return notFound();
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
