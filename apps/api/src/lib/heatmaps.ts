import { HEATMAP_NORM_SIZE } from '@flareboard/shared';
import type { Env } from '../env';

export type HeatmapCell = {
  normX: number;
  normY: number;
  count: number;
};

export async function getHeatmapPaths(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
) {
  const startDay = new Date(startAt).toISOString().slice(0, 10);
  const endDay = new Date(endAt).toISOString().slice(0, 10);

  const rows = await env.DB.prepare(
    `SELECT url_path as urlPath, SUM(count) as total
     FROM heatmap_cell
     WHERE website_id = ?1 AND day >= ?2 AND day <= ?3
     GROUP BY url_path
     ORDER BY total DESC
     LIMIT 100`,
  )
    .bind(websiteId, startDay, endDay)
    .all<{ urlPath: string; total: number }>();

  return rows.results ?? [];
}

export async function getHeatmapData(
  env: Env,
  websiteId: string,
  urlPath: string,
  startAt: number,
  endAt: number,
  kind: 'click' | 'scroll',
  deviceClass?: string,
) {
  const startDay = new Date(startAt).toISOString().slice(0, 10);
  const endDay = new Date(endAt).toISOString().slice(0, 10);

  const deviceFilter = deviceClass ? ' AND device_class = ?6' : '';
  const bindArgs = deviceClass
    ? [websiteId, urlPath, kind, startDay, endDay, deviceClass]
    : [websiteId, urlPath, kind, startDay, endDay];

  const rows = await env.DB.prepare(
    `SELECT norm_x as normX, norm_y as normY, SUM(count) as count
     FROM heatmap_cell
     WHERE website_id = ?1 AND url_path = ?2 AND kind = ?3
       AND day >= ?4 AND day <= ?5${deviceFilter}
     GROUP BY norm_x, norm_y`,
  )
    .bind(...bindArgs)
    .all<HeatmapCell>();

  const viewport = await env.DB.prepare(
    `SELECT MAX(viewport_w) as viewportW, MAX(viewport_h) as viewportH
     FROM heatmap_cell
     WHERE website_id = ?1 AND url_path = ?2 AND kind = ?3
       AND day >= ?4 AND day <= ?5${deviceFilter}`,
  )
    .bind(...bindArgs)
    .first<{ viewportW: number; viewportH: number }>();

  const cells = rows.results ?? [];
  const maxCount = cells.reduce((m, c) => Math.max(m, c.count), 0);

  return {
    kind,
    normSize: HEATMAP_NORM_SIZE,
    urlPath,
    cells,
    maxCount,
    viewportW: viewport?.viewportW ?? 0,
    viewportH: viewport?.viewportH ?? 0,
    deviceClass: deviceClass ?? null,
    startAt,
    endAt,
  };
}
