import type { Context } from 'hono';
import type { Env } from '../env';
import { getWebsiteById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';

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
  const flags = await c.env.DB.prepare(
    `SELECT key, enabled, rollout, variants, targeting_rules as targetingRules
     FROM feature_flag
     WHERE website_id = ?1 AND enabled = 1
     ORDER BY created_at ASC`,
  )
    .bind(websiteId)
    .all<{
      key: string;
      enabled: number;
      rollout: number;
      variants: string | null;
      targetingRules: string | null;
    }>();
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
    heatmapSampleRate: Math.min(1, Math.max(0, sampleRate)),
    heatmapEnabled: heatmapConfig.enabled !== false,
    featureFlags: (flags.results ?? []).map((flag) => {
      let variants: Array<{ key: string; name: string; weight: number }> = [];
      let targetingRules: Array<{ field: string; operator: string; value: string }> = [];
      if (flag.variants) {
        try {
          const parsed = JSON.parse(flag.variants);
          if (Array.isArray(parsed)) {
            variants = parsed
              .filter((item) => item && typeof item.key === 'string')
              .map((item) => ({
                key: item.key,
                name: typeof item.name === 'string' ? item.name : item.key,
                weight: Math.min(100, Math.max(0, Number(item.weight ?? 0))),
              }));
          }
        } catch {
          variants = [];
        }
      }
      if (flag.targetingRules) {
        try {
          const parsed = JSON.parse(flag.targetingRules);
          if (Array.isArray(parsed)) {
            targetingRules = parsed
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
              }));
          }
        } catch {
          targetingRules = [];
        }
      }
      return {
        key: flag.key,
        enabled: Boolean(flag.enabled),
        rollout: Math.min(100, Math.max(0, Number(flag.rollout ?? 100))),
        variants,
        targetingRules,
      };
    }),
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
