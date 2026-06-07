import type { Context } from 'hono';
import type { Env } from '../env';
import { getWebsiteById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';

export async function handleTrackerConfig(c: Context<{ Bindings: Env }>) {
  const websiteId = c.req.query('website');
  if (!websiteId) return badRequest('website query param required');

  const website = await getWebsiteById(c.env, websiteId);
  if (!website) return notFound();

  const heatmapConfig = (website.heatmapConfig ?? {}) as { sampleRate?: number; enabled?: boolean };
  const replayConfig = (website.replayConfig ?? {}) as { heatmapSampleRate?: number };
  const sampleRate = heatmapConfig.sampleRate ?? replayConfig.heatmapSampleRate ?? 0.1;

  return json({
    heatmapSampleRate: Math.min(1, Math.max(0, sampleRate)),
    heatmapEnabled: heatmapConfig.enabled !== false,
  });
}
