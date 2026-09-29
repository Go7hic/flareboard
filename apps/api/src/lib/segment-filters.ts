import { propertyFiltersSchema } from '@flareboard/shared';
import { compilePropertyFilters, SqlParams } from './property-filters';

/** Build SQL fragments from legacy segment parameters JSON. */
export type SegmentParams = Record<string, unknown>;

/**
 * Callers place `eventClauses` before `sessionClauses` and bind `binds` right after, so
 * `binds` lists every event-clause value first, then every session-clause value.
 */
export interface SegmentSql {
  joinSession: boolean;
  sessionClauses: string[];
  eventClauses: string[];
  binds: (string | number)[];
}

const SESSION_FIELDS: Record<string, string> = {
  country: 'country',
  browser: 'browser',
  os: 'os',
  device: 'device',
  language: 'language',
  city: 'city',
  region: 'region',
};

export function buildSegmentSql(params: SegmentParams | null | undefined): SegmentSql {
  if (!params || !Object.keys(params).length) {
    return { joinSession: false, sessionClauses: [], eventClauses: [], binds: [] };
  }

  const sessionClauses: string[] = [];
  const eventClauses: string[] = [];
  const eventBinds: (string | number)[] = [];
  const sessionBinds: (string | number)[] = [];
  let joinSession = false;

  for (const [key, raw] of Object.entries(params)) {
    if (key === 'properties') continue;
    if (raw === undefined || raw === null || raw === '') continue;
    const value = String(raw);

    if (key === 'path' || key === 'url') {
      eventClauses.push('e.url_path = ?');
      eventBinds.push(value);
      continue;
    }
    if (key === 'pathContains') {
      eventClauses.push('e.url_path LIKE ?');
      eventBinds.push(`%${value}%`);
      continue;
    }
    if (key === 'hostname') {
      eventClauses.push('e.hostname = ?');
      eventBinds.push(value);
      continue;
    }
    if (key === 'utmSource' || key === 'utm_source') {
      eventClauses.push('e.utm_source = ?');
      eventBinds.push(value);
      continue;
    }
    if (key === 'utmMedium' || key === 'utm_medium') {
      eventClauses.push('e.utm_medium = ?');
      eventBinds.push(value);
      continue;
    }
    if (key === 'utmCampaign' || key === 'utm_campaign') {
      eventClauses.push('e.utm_campaign = ?');
      eventBinds.push(value);
      continue;
    }
    if (key === 'tag') {
      eventClauses.push('e.tag = ?');
      eventBinds.push(value);
      continue;
    }
    if (key === 'referrer') {
      eventClauses.push('e.referrer_domain = ?');
      eventBinds.push(value);
      continue;
    }
    if (key === 'event' || key === 'eventName') {
      eventClauses.push('e.event_name = ?');
      eventBinds.push(value);
      continue;
    }

    const col = SESSION_FIELDS[key];
    if (col) {
      joinSession = true;
      sessionClauses.push(`s.${col} = ?`);
      sessionBinds.push(value);
    }
  }

  // Event / person / dimension property filters (see property-filters.ts). Invalid entries
  // are ignored like unknown legacy keys, so one bad saved segment never breaks a report.
  const properties = propertyFiltersSchema.safeParse(params.properties ?? []);
  if (properties.success && properties.data.length) {
    const positional = new SqlParams('positional');
    const compiled = compilePropertyFilters(properties.data, positional);
    eventClauses.push(`(${compiled.sql})`);
    eventBinds.push(...positional.values);
    joinSession ||= compiled.needsSession;
  }

  return { joinSession, sessionClauses, eventClauses, binds: [...eventBinds, ...sessionBinds] };
}
