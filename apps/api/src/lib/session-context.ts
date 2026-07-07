import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';

export type SessionContextKind =
  | 'pageview'
  | 'event'
  | 'feature_flag'
  | 'error'
  | 'log'
  | 'ai'
  | 'survey_response'
  | 'workflow_execution';

export type SessionContextItem = {
  id: string;
  kind: SessionContextKind;
  title: string;
  detail: string | null;
  urlPath: string | null;
  createdAt: number;
  source?: {
    module: 'feature_flags' | 'errors' | 'logs' | 'ai_observability' | 'surveys' | 'workflows';
    id?: string | null;
  };
  properties?: Array<{ key: string; value: string | null }>;
};

function valueFor(props: Array<{ key: string; value: string | null }>, key: string) {
  return props.find((prop) => prop.key === key)?.value ?? null;
}

function kindFor(eventType: number, eventName: string | null, props: Array<{ key: string; value: string | null }>): SessionContextKind {
  if (eventName === '$feature_flag_called' || valueFor(props, '$feature_flag')) return 'feature_flag';
  if (eventType === EVENT_TYPE.error) return 'error';
  if (eventType === EVENT_TYPE.log) return 'log';
  if (eventType === EVENT_TYPE.ai) return 'ai';
  if (eventType === EVENT_TYPE.pageView) return 'pageview';
  return 'event';
}

function titleFor(
  kind: SessionContextKind,
  eventName: string | null,
  urlPath: string | null,
  props: Array<{ key: string; value: string | null }>,
) {
  if (kind === 'feature_flag') return valueFor(props, '$feature_flag') ?? eventName ?? 'Feature flag';
  if (kind === 'error') return valueFor(props, 'message') ?? eventName ?? 'Error';
  if (kind === 'log') return valueFor(props, 'message') ?? eventName ?? 'Log';
  if (kind === 'ai') return valueFor(props, 'model') ?? eventName ?? 'AI call';
  if (kind === 'pageview') return urlPath || '/';
  return eventName ?? urlPath ?? 'Event';
}

function detailFor(kind: SessionContextKind, props: Array<{ key: string; value: string | null }>) {
  if (kind === 'feature_flag') return valueFor(props, '$feature_flag_response');
  if (kind === 'error') return valueFor(props, 'severity');
  if (kind === 'log') return valueFor(props, 'level');
  if (kind === 'ai') return valueFor(props, 'status');
  return null;
}

function sourceFor(
  kind: SessionContextKind,
  props: Array<{ key: string; value: string | null }>,
): SessionContextItem['source'] | undefined {
  if (kind === 'feature_flag') {
    return { module: 'feature_flags', id: valueFor(props, '$feature_flag') };
  }
  if (kind === 'error') return { module: 'errors' };
  if (kind === 'log') return { module: 'logs' };
  if (kind === 'ai') return { module: 'ai_observability' };
  return undefined;
}

export async function getSessionContext(env: Env, websiteId: string, sessionId: string) {
  const events = await env.DB.prepare(
    `SELECT event_id as id,
            event_type as eventType,
            event_name as eventName,
            url_path as urlPath,
            created_at as createdAt
     FROM website_event
     WHERE website_id = ?1 AND session_id = ?2
     ORDER BY created_at ASC
     LIMIT 500`,
  )
    .bind(websiteId, sessionId)
    .all<{
      id: string;
      eventType: number;
      eventName: string | null;
      urlPath: string | null;
      createdAt: number;
    }>();

  const eventRows = events.results ?? [];
  const propertiesByEvent = new Map<string, Array<{ key: string; value: string | null }>>();

  if (eventRows.length) {
    const placeholders = eventRows.map((_, index) => `?${index + 2}`).join(',');
    const props = await env.DB.prepare(
      `SELECT website_event_id as eventId,
              data_key as key,
              COALESCE(string_value, CAST(number_value AS TEXT), CAST(date_value AS TEXT)) as value
       FROM event_data
       WHERE website_id = ?1
         AND website_event_id IN (${placeholders})
       ORDER BY created_at ASC`,
    )
      .bind(websiteId, ...eventRows.map((row) => row.id))
      .all<{ eventId: string; key: string; value: string | null }>();

    for (const prop of props.results ?? []) {
      const current = propertiesByEvent.get(prop.eventId) ?? [];
      current.push({ key: prop.key, value: prop.value });
      propertiesByEvent.set(prop.eventId, current);
    }
  }

  const items: SessionContextItem[] = eventRows.map((event) => {
    const properties = propertiesByEvent.get(event.id) ?? [];
    const kind = kindFor(event.eventType, event.eventName, properties);
    return {
      id: event.id,
      kind,
      title: titleFor(kind, event.eventName, event.urlPath, properties),
      detail: detailFor(kind, properties),
      urlPath: event.urlPath,
      createdAt: event.createdAt,
      source: sourceFor(kind, properties),
      properties,
    };
  });

  const surveys = await env.DB.prepare(
    `SELECT sr.response_id as id,
            sr.survey_id as surveyId,
            sr.answer,
            sr.url_path as urlPath,
            sr.created_at as createdAt,
            s.name as surveyName
     FROM survey_response sr
     LEFT JOIN survey s ON s.survey_id = sr.survey_id
     WHERE sr.website_id = ?1 AND sr.session_id = ?2
     ORDER BY sr.created_at ASC
     LIMIT 100`,
  )
    .bind(websiteId, sessionId)
    .all<{
      id: string;
      surveyId: string;
      answer: string;
      urlPath: string | null;
      createdAt: number;
      surveyName: string | null;
    }>();

  for (const survey of surveys.results ?? []) {
    items.push({
      id: survey.id,
      kind: 'survey_response',
      title: survey.surveyName ?? 'Survey response',
      detail: survey.answer,
      urlPath: survey.urlPath,
      createdAt: survey.createdAt,
      source: { module: 'surveys', id: survey.surveyId },
    });
  }

  const workflows = await env.DB.prepare(
    `SELECT we.execution_id as id,
            we.workflow_id as workflowId,
            we.event_name as eventName,
            we.status,
            we.error,
            we.created_at as createdAt,
            w.name as workflowName,
            w.action_type as actionType
     FROM workflow_execution we
     LEFT JOIN workflow w ON w.workflow_id = we.workflow_id
     WHERE we.website_id = ?1 AND we.session_id = ?2
     ORDER BY we.created_at ASC
     LIMIT 100`,
  )
    .bind(websiteId, sessionId)
    .all<{
      id: string;
      workflowId: string;
      eventName: string | null;
      status: string;
      error: string | null;
      createdAt: number;
      workflowName: string | null;
      actionType: string | null;
    }>();

  for (const workflow of workflows.results ?? []) {
    items.push({
      id: workflow.id,
      kind: 'workflow_execution',
      title: workflow.workflowName ?? 'Workflow execution',
      detail: workflow.status,
      urlPath: null,
      createdAt: workflow.createdAt,
      source: { module: 'workflows', id: workflow.workflowId },
      properties: [
        { key: 'event', value: workflow.eventName },
        { key: 'action', value: workflow.actionType },
        { key: 'error', value: workflow.error },
      ].filter((prop) => prop.value != null),
    });
  }

  return items.sort((a, b) => a.createdAt - b.createdAt);
}
