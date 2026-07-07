import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';

export type FeatureFlagExposureSummary = {
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

function percentage(count: number, total: number) {
  return total ? Math.round((count / total) * 10000) / 100 : 0;
}

export async function getFeatureFlagExposureSummary(
  env: Env,
  websiteId: string,
  flagKey: string,
): Promise<FeatureFlagExposureSummary> {
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) as exposures,
       COUNT(DISTINCT e.session_id) as sessions,
       MAX(e.created_at) as lastCalledAt
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     WHERE e.website_id = ?1
       AND e.event_type = ?3
       AND e.event_name = '$feature_flag_called'`,
  )
    .bind(websiteId, flagKey, EVENT_TYPE.customEvent)
    .first<{ exposures: number; sessions: number; lastCalledAt: number | null }>();

  const variantRows = await env.DB.prepare(
    `SELECT
       response.string_value as variant,
       COUNT(*) as exposures,
       COUNT(DISTINCT e.session_id) as sessions
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     INNER JOIN event_data response
       ON response.website_event_id = e.event_id
      AND response.data_key = '$feature_flag_response'
     WHERE e.website_id = ?1
       AND e.event_type = ?3
       AND e.event_name = '$feature_flag_called'
     GROUP BY response.string_value
     ORDER BY exposures DESC, response.string_value ASC`,
  )
    .bind(websiteId, flagKey, EVENT_TYPE.customEvent)
    .all<{ variant: string; exposures: number; sessions: number }>();

  const recentRows = await env.DB.prepare(
    `SELECT e.event_id as id,
            e.session_id as sessionId,
            e.url_path as urlPath,
            e.created_at as createdAt,
            response.string_value as variant,
            release.string_value as release,
            environment.string_value as environment
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     LEFT JOIN event_data response
       ON response.website_event_id = e.event_id
      AND response.data_key = '$feature_flag_response'
     LEFT JOIN event_data release
       ON release.website_event_id = e.event_id
      AND release.data_key = 'release'
     LEFT JOIN event_data environment
       ON environment.website_event_id = e.event_id
      AND environment.data_key = 'environment'
     WHERE e.website_id = ?1
       AND e.event_type = ?3
       AND e.event_name = '$feature_flag_called'
     ORDER BY e.created_at DESC
     LIMIT 10`,
  )
    .bind(websiteId, flagKey, EVENT_TYPE.customEvent)
    .all<{
      id: string;
      sessionId: string;
      urlPath: string | null;
      createdAt: number;
      variant: string | null;
      release: string | null;
      environment: string | null;
    }>();

  const trendRows = await env.DB.prepare(
    `SELECT date(e.created_at / 1000, 'unixepoch') as date,
            COUNT(*) as exposures,
            COUNT(DISTINCT e.session_id) as sessions
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     WHERE e.website_id = ?1
       AND e.event_type = ?3
       AND e.event_name = '$feature_flag_called'
     GROUP BY date(e.created_at / 1000, 'unixepoch')
     ORDER BY date ASC
     LIMIT 90`,
  )
    .bind(websiteId, flagKey, EVENT_TYPE.customEvent)
    .all<{ date: string; exposures: number; sessions: number }>();

  const releaseRows = await env.DB.prepare(
    `SELECT COALESCE(release.string_value, 'unknown') as release,
            COUNT(*) as exposures,
            COUNT(DISTINCT e.session_id) as sessions
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     LEFT JOIN event_data release
       ON release.website_event_id = e.event_id
      AND release.data_key = 'release'
     WHERE e.website_id = ?1
       AND e.event_type = ?3
       AND e.event_name = '$feature_flag_called'
     GROUP BY COALESCE(release.string_value, 'unknown')
     ORDER BY exposures DESC, release ASC
     LIMIT 10`,
  )
    .bind(websiteId, flagKey, EVENT_TYPE.customEvent)
    .all<{ release: string; exposures: number; sessions: number }>();

  const environmentRows = await env.DB.prepare(
    `SELECT COALESCE(environment.string_value, 'unknown') as environment,
            COUNT(*) as exposures,
            COUNT(DISTINCT e.session_id) as sessions
     FROM website_event e
     INNER JOIN event_data flag
       ON flag.website_event_id = e.event_id
      AND flag.data_key = '$feature_flag'
      AND flag.string_value = ?2
     LEFT JOIN event_data environment
       ON environment.website_event_id = e.event_id
      AND environment.data_key = 'environment'
     WHERE e.website_id = ?1
       AND e.event_type = ?3
       AND e.event_name = '$feature_flag_called'
     GROUP BY COALESCE(environment.string_value, 'unknown')
     ORDER BY exposures DESC, environment ASC
     LIMIT 10`,
  )
    .bind(websiteId, flagKey, EVENT_TYPE.customEvent)
    .all<{ environment: string; exposures: number; sessions: number }>();

  const exposures = row?.exposures ?? 0;
  const variants = (variantRows.results ?? []).map((variant) => ({
    ...variant,
    percentage: percentage(variant.exposures, exposures),
  }));
  const dominantVariant = variants[0] ?? null;
  const issues: FeatureFlagExposureSummary['health']['issues'] = [];
  if (!exposures) {
    issues.push('no_exposures');
  } else if (!variants.length) {
    issues.push('missing_variant_data');
  }
  if (variants.length >= 2 && (dominantVariant?.percentage ?? 0) >= 90) {
    issues.push('traffic_concentrated');
  }
  const status: FeatureFlagExposureSummary['health']['status'] = !exposures
    ? 'inactive'
    : issues.length
      ? 'needs_attention'
      : 'healthy';

  return {
    exposures,
    sessions: row?.sessions ?? 0,
    lastCalledAt: row?.lastCalledAt ?? null,
    health: {
      status,
      dominantVariant: dominantVariant?.variant ?? null,
      dominantShare: dominantVariant?.percentage ?? null,
      issues,
    },
    variants,
    trend: trendRows.results ?? [],
    releases: (releaseRows.results ?? []).map((release) => ({
      ...release,
      percentage: percentage(release.exposures, exposures),
    })),
    environments: (environmentRows.results ?? []).map((environment) => ({
      ...environment,
      percentage: percentage(environment.exposures, exposures),
    })),
    recent: recentRows.results ?? [],
  };
}
