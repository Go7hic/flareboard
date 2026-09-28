import type { Context } from 'hono';
import { featureFlagNeedsServerEvaluation, type FeatureFlagJsonValue } from '@flareboard/shared';
import type { Env } from '../env';
import { flagConfig, getEnabledFlags, type FlagRow } from '../lib/feature-flags';
import { getWebsiteById } from '../lib/queries';
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

/**
 * Session replay privacy settings for recorder.js, normalized from website.replay_config
 * (saved by the dashboard's ReplayConfigWizard). Missing config means the safe defaults:
 * mask every input, record every visit, block nothing extra.
 */
export function replaySettings(raw: unknown) {
  const cfg = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rate = typeof cfg.sampleRate === 'number' && Number.isFinite(cfg.sampleRate) ? cfg.sampleRate : 1;
  const selector = typeof cfg.blockSelectors === 'string' ? cfg.blockSelectors.trim().slice(0, 1000) : '';
  return {
    sampleRate: Math.min(1, Math.max(0, rate)),
    maskInputs: cfg.maskInputs !== false,
    blockSelector: selector || null,
  };
}

export async function handleTrackerConfig(c: Context<{ Bindings: Env }>) {
  const websiteId = c.req.query('website');
  if (!websiteId) return badRequest('website query param required');

  const cacheKey = `tracker-config:${websiteId}`;
  const cached = await c.env.CACHE.get(cacheKey);
  if (cached) {
    return new Response(cached, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  const website = await getWebsiteById(c.env, websiteId);
  if (!website) return notFound();

  const heatmapConfig = (website.heatmapConfig ?? {}) as { sampleRate?: number; enabled?: boolean };
  const replayConfig = (website.replayConfig ?? {}) as { heatmapSampleRate?: number };
  const sampleRate = heatmapConfig.sampleRate ?? replayConfig.heatmapSampleRate ?? 0.1;
  const flags = await getEnabledFlags(c.env, websiteId);
  const surveys = await c.env.DB.prepare(
    `SELECT survey_id as id, name, question, type, options, trigger_path as triggerPath,
            trigger_event as triggerEvent, display_delay_seconds as displayDelaySeconds,
            display_rules as displayRules
     FROM survey
     WHERE website_id = ?1 AND enabled = 1
     ORDER BY created_at ASC
     LIMIT 5`,
  )
    .bind(websiteId)
    .all<{
      id: string;
      name: string;
      question: string;
      type: string;
      options: string | null;
      triggerPath: string | null;
      triggerEvent: string | null;
      displayDelaySeconds: number | null;
      displayRules: string | null;
    }>();

  const payload = {
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
    surveys: (surveys.results ?? []).map((survey) => {
      let options: string[] = [];
      if (survey.options) {
        try {
          const parsed = JSON.parse(survey.options);
          if (Array.isArray(parsed)) options = parsed.filter((item) => typeof item === 'string');
        } catch {
          options = [];
        }
      }
      let displayRules: Array<{ field: string; operator: string; value: string; key?: string }> = [];
      if (survey.displayRules) {
        try {
          const parsed = JSON.parse(survey.displayRules);
          if (Array.isArray(parsed)) {
            displayRules = parsed
              .filter(
                (item) =>
                  item &&
                  typeof item.field === 'string' &&
                  typeof item.operator === 'string' &&
                  typeof item.value === 'string',
              )
              .map((item) => ({
                field: item.field,
                operator: item.operator,
                value: item.value,
                ...(typeof item.key === 'string' ? { key: item.key } : {}),
              }));
          }
        } catch {
          displayRules = [];
        }
      }
      return {
        ...survey,
        displayDelaySeconds: Math.min(60, Math.max(0, Number(survey.displayDelaySeconds ?? 0))),
        displayRules,
        options,
      };
    }),
  };
  await c.env.CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 60 });
  return json(payload);
}
