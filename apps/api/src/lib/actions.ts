import type { Env } from '../env';

export type ActionRule = {
  field: 'event_name' | 'url_path' | 'property';
  key?: string;
  operator: 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'not_equals' | 'not_contains';
  value: string;
};

type ActionDefinitionLike = {
  id: string;
  websiteId: string;
  name: string;
  description: string;
  rules: ActionRule[];
  createdAt: Date | number | null;
  updatedAt: Date | number | null;
};

function dateValue(value: Date | number | null) {
  if (value instanceof Date) return value.getTime();
  return value ?? null;
}

function scalarPredicate(column: string, operator: ActionRule['operator'], value: string, next: (value: string) => string) {
  switch (operator) {
    case 'equals':
      return `${column} = ${next(value)}`;
    case 'contains':
      return `${column} LIKE ${next(`%${value}%`)}`;
    case 'starts_with':
      return `${column} LIKE ${next(`${value}%`)}`;
    case 'ends_with':
      return `${column} LIKE ${next(`%${value}`)}`;
    case 'not_equals':
      return `(${column} IS NULL OR ${column} != ${next(value)})`;
    case 'not_contains':
      return `(${column} IS NULL OR ${column} NOT LIKE ${next(`%${value}%`)})`;
    default:
      return '1 = 1';
  }
}

export function buildActionWhere(websiteId: string, startAt: number, endAt: number, rules: ActionRule[]) {
  const bindings: unknown[] = [websiteId, startAt, endAt];
  const next = (value: unknown) => {
    bindings.push(value);
    return `?${bindings.length}`;
  };
  const clauses = [
    'e.website_id = ?1',
    'e.created_at >= ?2',
    'e.created_at <= ?3',
  ];

  for (const rule of rules) {
    if (rule.field === 'event_name') {
      clauses.push(scalarPredicate('e.event_name', rule.operator, rule.value, next));
      continue;
    }
    if (rule.field === 'url_path') {
      clauses.push(scalarPredicate('e.url_path', rule.operator, rule.value, next));
      continue;
    }
    if (rule.field === 'property' && rule.key) {
      const valueExpr = "COALESCE(ed.string_value, CAST(ed.number_value AS TEXT), CAST(ed.date_value AS TEXT))";
      const propertyBindings: unknown[] = [];
      const propertyNext = (value: unknown) => {
        propertyBindings.push(value);
        return `?${bindings.length + propertyBindings.length}`;
      };
      const predicate = scalarPredicate(valueExpr, rule.operator, rule.value, propertyNext);
      bindings.push(...propertyBindings);
      clauses.push(
        `EXISTS (
          SELECT 1
          FROM event_data ed
          WHERE ed.website_event_id = e.event_id
            AND ed.website_id = e.website_id
            AND ed.data_key = ${next(rule.key)}
            AND ${predicate}
        )`,
      );
    }
  }

  return {
    where: clauses.join('\n       AND '),
    bindings,
  };
}

export function serializeAction(row: ActionDefinitionLike, summary?: Awaited<ReturnType<typeof getActionSummary>>) {
  return {
    id: row.id,
    websiteId: row.websiteId,
    name: row.name,
    description: row.description,
    rules: Array.isArray(row.rules) ? row.rules : [],
    summary,
    createdAt: dateValue(row.createdAt),
    updatedAt: dateValue(row.updatedAt),
  };
}

export async function getActionSummary(
  env: Env,
  websiteId: string,
  rules: ActionRule[],
  startAt: number,
  endAt: number,
) {
  const filter = buildActionWhere(websiteId, startAt, endAt, rules);
  const [summary, trend, paths, recent] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) as events,
              COUNT(DISTINCT e.session_id) as sessions,
              COUNT(DISTINCT e.visit_id) as visits,
              MIN(e.created_at) as firstSeenAt,
              MAX(e.created_at) as lastSeenAt
       FROM website_event e
       WHERE ${filter.where}`,
    )
      .bind(...filter.bindings)
      .first<{
        events: number;
        sessions: number;
        visits: number;
        firstSeenAt: number | null;
        lastSeenAt: number | null;
      }>(),
    env.DB.prepare(
      `SELECT date(e.created_at / 1000, 'unixepoch') as date,
              COUNT(*) as events,
              COUNT(DISTINCT e.session_id) as sessions
       FROM website_event e
       WHERE ${filter.where}
       GROUP BY date(e.created_at / 1000, 'unixepoch')
       ORDER BY date ASC`,
    )
      .bind(...filter.bindings)
      .all<{ date: string; events: number; sessions: number }>(),
    env.DB.prepare(
      `SELECT e.url_path as path,
              COUNT(*) as events,
              COUNT(DISTINCT e.session_id) as sessions,
              MAX(e.created_at) as lastSeenAt
       FROM website_event e
       WHERE ${filter.where}
       GROUP BY e.url_path
       ORDER BY events DESC, path ASC
       LIMIT 10`,
    )
      .bind(...filter.bindings)
      .all<{ path: string; events: number; sessions: number; lastSeenAt: number | null }>(),
    env.DB.prepare(
      `SELECT e.event_id as id,
              e.session_id as sessionId,
              e.visit_id as visitId,
              e.event_name as eventName,
              e.url_path as urlPath,
              e.created_at as createdAt
       FROM website_event e
       WHERE ${filter.where}
       ORDER BY e.created_at DESC
       LIMIT 20`,
    )
      .bind(...filter.bindings)
      .all<{
        id: string;
        sessionId: string;
        visitId: string;
        eventName: string | null;
        urlPath: string | null;
        createdAt: number;
      }>(),
  ]);

  return {
    ...(summary ?? { events: 0, sessions: 0, visits: 0, firstSeenAt: null, lastSeenAt: null }),
    trend: trend.results ?? [],
    paths: paths.results ?? [],
    recent: recent.results ?? [],
  };
}
