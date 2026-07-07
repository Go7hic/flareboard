import {
  actionMatchContextFromEvent,
  matchActionDefinitions,
  type ActionDefinitionLike,
  type ActionRule,
} from '@flareboard/shared';
import type { Env } from '../env';

export type ActionBackfillInput = {
  websiteId: string;
  startAt: number;
  endAt: number;
  limit?: number;
  dryRun?: boolean;
};

export type ActionBackfillResult = {
  scanned: number;
  tagged: number;
  skipped: number;
  dryRun: boolean;
};

async function loadActionDefinitions(env: Env, websiteId: string): Promise<ActionDefinitionLike[]> {
  const rows = await env.DB.prepare(
    `SELECT action_id as id, name, rules
     FROM action_definition
     WHERE website_id = ?1
     ORDER BY created_at ASC
     LIMIT 100`,
  )
    .bind(websiteId)
    .all<{ id: string; name: string; rules: string | ActionRule[] }>();

  const definitions: ActionDefinitionLike[] = [];
  for (const row of rows.results ?? []) {
    let rules: ActionRule[];
    if (typeof row.rules === 'string') {
      try {
        rules = JSON.parse(row.rules) as ActionRule[];
      } catch {
        continue; // Corrupt rules must not fail the whole backfill.
      }
    } else {
      rules = row.rules;
    }
    if (!Array.isArray(rules)) continue;
    definitions.push({ id: row.id, name: row.name, rules });
  }
  return definitions;
}

const PROPERTY_CHUNK_SIZE = 90;

async function loadEventProperties(env: Env, websiteId: string, eventIds: string[]) {
  const byEvent = new Map<string, Record<string, unknown>>();
  for (let offset = 0; offset < eventIds.length; offset += PROPERTY_CHUNK_SIZE) {
    const chunk = eventIds.slice(offset, offset + PROPERTY_CHUNK_SIZE);
    const placeholders = chunk.map((_, index) => `?${index + 2}`).join(', ');
    const rows = await env.DB.prepare(
      `SELECT website_event_id as eventId, data_key as dataKey, string_value as stringValue, number_value as numberValue
       FROM event_data
       WHERE website_id = ?1 AND website_event_id IN (${placeholders})`,
    )
      .bind(websiteId, ...chunk)
      .all<{ eventId: string; dataKey: string; stringValue: string | null; numberValue: number | null }>();
    for (const row of rows.results ?? []) {
      const data = byEvent.get(row.eventId) ?? {};
      data[row.dataKey] = row.stringValue ?? row.numberValue;
      byEvent.set(row.eventId, data);
    }
  }
  return byEvent;
}

export async function backfillActionTags(env: Env, input: ActionBackfillInput): Promise<ActionBackfillResult> {
  const definitions = await loadActionDefinitions(env, input.websiteId);
  if (!definitions.length) {
    return { scanned: 0, tagged: 0, skipped: 0, dryRun: Boolean(input.dryRun) };
  }

  const limit = Math.min(Math.max(input.limit ?? 500, 1), 5000);
  const events = await env.DB.prepare(
    `SELECT e.event_id as eventId,
            e.event_name as eventName,
            e.url_path as urlPath,
            e.created_at as createdAt
     FROM website_event e
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND NOT EXISTS (
         SELECT 1
         FROM event_data ed
         WHERE ed.website_event_id = e.event_id
           AND ed.data_key = '$flareboard_action_ids'
       )
     ORDER BY e.created_at ASC
     LIMIT ?4`,
  )
    .bind(input.websiteId, input.startAt, input.endAt, limit)
    .all<{
      eventId: string;
      eventName: string | null;
      urlPath: string | null;
      createdAt: number;
    }>();

  let tagged = 0;
  let skipped = 0;
  const rows = events.results ?? [];
  const propertiesByEvent = await loadEventProperties(
    env,
    input.websiteId,
    rows.map((event) => event.eventId),
  );

  for (const event of rows) {
    const data = propertiesByEvent.get(event.eventId) ?? {};

    const matched = matchActionDefinitions(
      definitions,
      actionMatchContextFromEvent({
        eventName: event.eventName,
        urlPath: event.urlPath,
        data,
      }),
    );

    if (!matched.length) {
      skipped++;
      continue;
    }

    tagged++;
    if (input.dryRun) continue;

    const now = event.createdAt;
    const actionIds = matched.map((row) => row.id).join(',');
    const actionNames = matched.map((row) => row.name).join(',');

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_data
         (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
         VALUES (?1, ?2, ?3, '$flareboard_action_ids', ?4, 1, ?5)`,
      ).bind(crypto.randomUUID(), input.websiteId, event.eventId, actionIds, now),
      env.DB.prepare(
        `INSERT INTO event_data
         (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
         VALUES (?1, ?2, ?3, '$flareboard_action_names', ?4, 1, ?5)`,
      ).bind(crypto.randomUUID(), input.websiteId, event.eventId, actionNames, now),
    ]);
  }

  return {
    scanned: rows.length,
    tagged,
    skipped,
    dryRun: Boolean(input.dryRun),
  };
}
