/** Build SQL fragments from legacy segment parameters JSON. */
export type SegmentParams = Record<string, unknown>;

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
  const binds: (string | number)[] = [];
  let joinSession = false;

  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const value = String(raw);

    if (key === 'path' || key === 'url') {
      eventClauses.push('e.url_path = ?');
      binds.push(value);
      continue;
    }
    if (key === 'pathContains') {
      eventClauses.push('e.url_path LIKE ?');
      binds.push(`%${value}%`);
      continue;
    }
    if (key === 'hostname') {
      eventClauses.push('e.hostname = ?');
      binds.push(value);
      continue;
    }
    if (key === 'utmSource' || key === 'utm_source') {
      eventClauses.push('e.utm_source = ?');
      binds.push(value);
      continue;
    }
    if (key === 'utmMedium' || key === 'utm_medium') {
      eventClauses.push('e.utm_medium = ?');
      binds.push(value);
      continue;
    }
    if (key === 'utmCampaign' || key === 'utm_campaign') {
      eventClauses.push('e.utm_campaign = ?');
      binds.push(value);
      continue;
    }
    if (key === 'tag') {
      eventClauses.push('e.tag = ?');
      binds.push(value);
      continue;
    }
    if (key === 'referrer') {
      eventClauses.push('e.referrer_domain = ?');
      binds.push(value);
      continue;
    }
    if (key === 'event' || key === 'eventName') {
      eventClauses.push('e.event_name = ?');
      binds.push(value);
      continue;
    }

    const col = SESSION_FIELDS[key];
    if (col) {
      joinSession = true;
      sessionClauses.push(`s.${col} = ?`);
      binds.push(value);
    }
  }

  return { joinSession, sessionClauses, eventClauses, binds };
}
