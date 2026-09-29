import type { LogAttributeFilter, LogSavedFilter, LogSeverity, LogSource } from '../../lib/api';

/** Everything the logs explorer filters on; serialized to the API's query parameters. */
export type LogFilterState = {
  levels: LogSeverity[];
  search: string;
  service: string;
  environment: string;
  release: string;
  source: '' | LogSource;
  traceId: string;
  sessionId: string;
  attributes: LogAttributeFilter[];
};

export const EMPTY_LOG_FILTERS: LogFilterState = {
  levels: [],
  search: '',
  service: '',
  environment: '',
  release: '',
  source: '',
  traceId: '',
  sessionId: '',
  attributes: [],
};

/** Adds the filters to `params` (level, q, service, environment, release, source, traceId, sessionId, attr). */
export function appendLogFilterParams(params: URLSearchParams, filters: LogFilterState, search = filters.search) {
  if (filters.levels.length) params.set('level', filters.levels.join(','));
  if (search.trim()) params.set('q', search.trim());
  if (filters.service) params.set('service', filters.service);
  if (filters.environment) params.set('environment', filters.environment);
  if (filters.release) params.set('release', filters.release);
  if (filters.source) params.set('source', filters.source);
  if (filters.traceId) params.set('traceId', filters.traceId);
  if (filters.sessionId) params.set('sessionId', filters.sessionId);
  for (const attribute of filters.attributes) {
    params.append('attr', attribute.value === undefined ? attribute.key : `${attribute.key}=${attribute.value}`);
  }
  return params;
}

export function hasLogFilters(filters: LogFilterState) {
  return (
    filters.levels.length > 0 ||
    Boolean(filters.search.trim()) ||
    Boolean(filters.service || filters.environment || filters.release || filters.source) ||
    Boolean(filters.traceId || filters.sessionId) ||
    filters.attributes.length > 0
  );
}

/** Parses `key=value` (or a bare `key`, meaning "is set") typed into the attribute field. */
export function parseAttributeInput(input: string): LogAttributeFilter | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const separator = trimmed.indexOf('=');
  if (separator === -1) return { key: trimmed };
  const key = trimmed.slice(0, separator).trim();
  return key ? { key, value: trimmed.slice(separator + 1).trim() } : null;
}

export function attributeLabel(attribute: LogAttributeFilter) {
  return attribute.value === undefined ? attribute.key : `${attribute.key} = ${attribute.value}`;
}

/** Attribute values as the API compares them: strings as-is, everything else as JSON text. */
export function attributeValueText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function filtersFromSaved(saved: LogSavedFilter['filters']): LogFilterState {
  return {
    ...EMPTY_LOG_FILTERS,
    levels: saved.level ? [saved.level] : [],
    search: saved.search ?? '',
    service: saved.service ?? '',
    environment: saved.environment ?? '',
    release: saved.release ?? '',
    source: saved.source ?? '',
    traceId: saved.traceId ?? '',
    sessionId: saved.sessionId ?? '',
    attributes: saved.attributes ?? [],
  };
}

/** Saved filters keep one level (the API schema), the first selected. */
export function filtersToSaved(filters: LogFilterState): LogSavedFilter['filters'] {
  return {
    level: filters.levels[0],
    search: filters.search.trim() || undefined,
    service: filters.service || undefined,
    environment: filters.environment || undefined,
    release: filters.release || undefined,
    source: filters.source || undefined,
    traceId: filters.traceId || undefined,
    sessionId: filters.sessionId || undefined,
    attributes: filters.attributes.length ? filters.attributes : undefined,
  };
}
