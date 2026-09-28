import { EVENT_TYPE } from '@flareboard/shared';
import { testSiteDb } from './site-db';

export type SeedSession = { id: string; distinctId?: string | null; createdAt: number };

export type SeedEvent = {
  id: string;
  sessionId: string;
  name: string;
  createdAt: number;
  data?: Record<string, string | number>;
};

/** Seeds sessions and custom events (with event_data) through the website's site database. */
export async function seedAnalytics(
  websiteId: string,
  { sessions = [], events = [] }: { sessions?: SeedSession[]; events?: SeedEvent[] },
) {
  const db = testSiteDb(websiteId);
  const statements: D1PreparedStatement[] = [];
  for (const session of sessions) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO session (session_id, website_id, distinct_id, created_at) VALUES (?1, ?2, ?3, ?4)`,
        )
        .bind(session.id, websiteId, session.distinctId ?? null, session.createdAt),
    );
  }
  for (const event of events) {
    statements.push(
      db
        .prepare(
          `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
           VALUES (?1, ?2, ?3, ?3, ?4, '/', ?5, ?6)`,
        )
        .bind(event.id, websiteId, event.sessionId, event.createdAt, EVENT_TYPE.customEvent, event.name),
    );
    let index = 0;
    for (const [key, value] of Object.entries(event.data ?? {})) {
      const isNumber = typeof value === 'number';
      statements.push(
        db
          .prepare(
            `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, data_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
          )
          .bind(
            `${event.id}-data-${index++}`,
            websiteId,
            event.id,
            key,
            isNumber ? null : value,
            isNumber ? value : null,
            isNumber ? 2 : 1,
            event.createdAt,
          ),
      );
    }
  }
  for (let offset = 0; offset < statements.length; offset += 400) {
    await db.batch(statements.slice(offset, offset + 400));
  }
}

/** A `$feature_flag_called` exposure as the tracker records it, without `$feature/<key>` unless asked. */
export function exposure(
  id: string,
  sessionId: string,
  flagKey: string,
  variant: string,
  createdAt: number,
  { featureProperty = false }: { featureProperty?: boolean } = {},
): SeedEvent {
  return {
    id,
    sessionId,
    name: '$feature_flag_called',
    createdAt,
    data: {
      $feature_flag: flagKey,
      $feature_flag_response: variant,
      ...(featureProperty ? { [`$feature/${flagKey}`]: variant } : {}),
    },
  };
}
