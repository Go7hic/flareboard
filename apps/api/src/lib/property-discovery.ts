/**
 * Observed property keys and values for the property-filter builder. Every query is bounded:
 * event data by date range, people by a sample of rows.
 */
import type { PropertyFilterType } from '@flareboard/shared';
import type { Env } from '../env';
import { dimensionColumn, likeContainsPattern, SqlParams } from './property-filters';
import { sessionJoinSql } from './insight-sql';
import { siteDb } from './site-db';

export type PropertyKey = { key: string; count: number; numeric: boolean };
export type PropertyValue = { value: string; count: number };

/** People sampled for person-property discovery. */
const PERSON_SAMPLE = 2000;
const MAX_KEYS = 200;
const MAX_VALUES = 50;

const PERSON_JSON = `json_each(CASE WHEN json_valid(p.properties_json) THEN p.properties_json ELSE '{}' END)`;

export async function listPropertyKeys(
  env: Env,
  websiteId: string,
  type: Exclude<PropertyFilterType, 'dimension'>,
  startAt: number,
  endAt: number,
): Promise<PropertyKey[]> {
  const db = siteDb(env, websiteId);
  if (type === 'event') {
    const rows = await db
      .prepare(
        `SELECT data_key AS key, COUNT(*) AS count, MAX(number_value IS NOT NULL) AS numeric
         FROM event_data
         WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3
         GROUP BY data_key
         ORDER BY count DESC, key
         LIMIT ${MAX_KEYS}`,
      )
      .bind(websiteId, startAt, endAt)
      .all<{ key: string; count: number; numeric: number }>();
    return (rows.results ?? []).map((row) => ({ key: row.key, count: row.count, numeric: Boolean(row.numeric) }));
  }
  const rows = await db
    .prepare(
      `SELECT j.key AS key, COUNT(*) AS count, MAX(j.type IN ('integer', 'real')) AS numeric
       FROM (SELECT properties_json FROM person WHERE website_id = ?1 LIMIT ${PERSON_SAMPLE}) p, ${PERSON_JSON} j
       WHERE j.type != 'null'
       GROUP BY j.key
       ORDER BY count DESC, key
       LIMIT ${MAX_KEYS}`,
    )
    .bind(websiteId)
    .all<{ key: string; count: number; numeric: number }>();
  return (rows.results ?? []).map((row) => ({ key: row.key, count: row.count, numeric: Boolean(row.numeric) }));
}

export async function listPropertyValues(
  env: Env,
  websiteId: string,
  type: PropertyFilterType,
  key: string,
  startAt: number,
  endAt: number,
  search?: string,
): Promise<PropertyValue[]> {
  const db = siteDb(env, websiteId);
  const params = new SqlParams();
  const like = search?.trim() ? likeContainsPattern(search.trim()) : null;
  let sql: string;
  if (type === 'event') {
    const text = `COALESCE(d.string_value, CASE WHEN d.number_value = CAST(d.number_value AS INTEGER)
      THEN CAST(CAST(d.number_value AS INTEGER) AS TEXT) ELSE CAST(d.number_value AS TEXT) END)`;
    sql = `SELECT ${text} AS value, COUNT(*) AS count
      FROM event_data d
      WHERE d.website_id = ${params.add(websiteId)} AND d.data_key = ${params.add(key)}
        AND d.created_at >= ${params.add(startAt)} AND d.created_at <= ${params.add(endAt)}
        ${like ? `AND ${text} LIKE ${params.add(like)} ESCAPE '\\'` : ''}
      GROUP BY value`;
  } else if (type === 'person') {
    const text = `CASE j.type WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE CAST(j.value AS TEXT) END`;
    sql = `SELECT ${text} AS value, COUNT(*) AS count
      FROM (SELECT properties_json FROM person WHERE website_id = ${params.add(websiteId)} LIMIT ${PERSON_SAMPLE}) p,
        ${PERSON_JSON} j
      WHERE j.key = ${params.add(key)} AND j.type NOT IN ('null', 'object', 'array')
        ${like ? `AND ${text} LIKE ${params.add(like)} ESCAPE '\\'` : ''}
      GROUP BY value`;
  } else {
    const column = dimensionColumn(key);
    sql = `SELECT ${column.sql} AS value, COUNT(*) AS count
      FROM website_event e${sessionJoinSql(column.needsSession)}
      WHERE e.website_id = ${params.add(websiteId)}
        AND e.created_at >= ${params.add(startAt)} AND e.created_at <= ${params.add(endAt)}
        AND ${column.sql} IS NOT NULL AND ${column.sql} != ''
        ${like ? `AND ${column.sql} LIKE ${params.add(like)} ESCAPE '\\'` : ''}
      GROUP BY value`;
  }
  const rows = await db
    .prepare(`${sql} ORDER BY count DESC, value LIMIT ${MAX_VALUES}`)
    .bind(...params.values)
    .all<PropertyValue>();
  return (rows.results ?? []).filter((row) => row.value !== null && row.value !== '');
}
