/**
 * Compiles event-property, person-property and dimension filters (packages/shared
 * insight-query) into parameterized SQL over the analytics tables.
 *
 * Fragments assume the aliases `e` (website_event) and `s` (session, joined on
 * `s.session_id = e.session_id`); `needsSession` says whether the caller must join it.
 *
 * - Event properties: `EXISTS (SELECT 1 FROM event_data d WHERE d.website_event_id = e.event_id ...)`.
 * - Person properties: the session's distinct id -> `person.properties_json` (json_each, so any
 *   key works without JSON-path escaping; booleans compare as 'true' / 'false').
 * - Dimensions: event / session columns.
 *
 * Negative operators (is not, does not contain, does not match, is not set) also match rows
 * where the property is missing. Numeric operators only match numeric values.
 */
import {
  propertyFilterNumber,
  propertyFilterRange,
  propertyFilterText,
  propertyFilterValues,
  regexToGlob,
  type InsightBreakdown,
  type InsightDimension,
  type PropertyFilter,
} from '@flareboard/shared';

/** D1 rejects statements with more than 100 bound parameters. */
export const D1_MAX_BOUND_PARAMETERS = 100;

/** A query the user can fix (bad filter, too many values, ...): routes answer 400. */
export class InsightQueryError extends Error {
  readonly status = 400;
}

/**
 * Bound parameters of one statement.
 *
 * `numbered` (default) returns `?N` placeholders and reuses the slot for repeated values, so
 * fragments can be placed anywhere in the SQL and repeated without costing extra parameters.
 * `positional` returns bare `?` for legacy call sites that concatenate binds in text order.
 */
export class SqlParams {
  readonly values: (string | number)[] = [];
  private readonly slots = new Map<string, number>();

  constructor(private readonly mode: 'numbered' | 'positional' = 'numbered') {}

  add(value: string | number): string {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new InsightQueryError('Invalid number in query');
    }
    if (this.mode === 'positional') {
      this.values.push(value);
      return '?';
    }
    const slotKey = `${typeof value}:${value}`;
    const existing = this.slots.get(slotKey);
    if (existing) return `?${existing}`;
    this.values.push(value);
    const slot = this.values.length;
    this.slots.set(slotKey, slot);
    return `?${slot}`;
  }

  /** Throws when the statement would exceed D1's bound-parameter limit. */
  assertWithinLimit() {
    if (this.values.length > D1_MAX_BOUND_PARAMETERS) {
      throw new InsightQueryError(
        `This query needs ${this.values.length} values; the limit is ${D1_MAX_BOUND_PARAMETERS}. Remove some filter values or steps.`,
      );
    }
  }
}

/** Escape `%`, `_` and `\` for `LIKE ... ESCAPE '\'`. */
export function likeContainsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

type DimensionColumn = { sql: string; needsSession: boolean };

const DIMENSION_COLUMNS: Record<InsightDimension, DimensionColumn> = {
  path: { sql: 'e.url_path', needsSession: false },
  hostname: { sql: 'e.hostname', needsSession: false },
  page_title: { sql: 'e.page_title', needsSession: false },
  referrer: { sql: 'e.referrer_domain', needsSession: false },
  utm_source: { sql: 'e.utm_source', needsSession: false },
  utm_medium: { sql: 'e.utm_medium', needsSession: false },
  utm_campaign: { sql: 'e.utm_campaign', needsSession: false },
  utm_content: { sql: 'e.utm_content', needsSession: false },
  utm_term: { sql: 'e.utm_term', needsSession: false },
  event: { sql: 'e.event_name', needsSession: false },
  tag: { sql: 'e.tag', needsSession: false },
  browser: { sql: 's.browser', needsSession: true },
  os: { sql: 's.os', needsSession: true },
  device: { sql: 's.device', needsSession: true },
  screen: { sql: 's.screen', needsSession: true },
  country: { sql: 's.country', needsSession: true },
  region: { sql: 's.region', needsSession: true },
  city: { sql: 's.city', needsSession: true },
  language: { sql: 's.language', needsSession: true },
};

export function dimensionColumn(key: string): DimensionColumn {
  const column = DIMENSION_COLUMNS[key as InsightDimension];
  if (!column) throw new InsightQueryError(`Unknown dimension "${key}"`);
  return column;
}

/** Event property value as text (integral numbers without a trailing `.0`). */
const EVENT_VALUE_TEXT = `COALESCE(d.string_value, CASE
  WHEN d.number_value IS NULL THEN NULL
  WHEN d.number_value = CAST(d.number_value AS INTEGER) THEN CAST(CAST(d.number_value AS INTEGER) AS TEXT)
  ELSE CAST(d.number_value AS TEXT) END)`;

/** Person property (json_each row `j`) as text; JSON booleans become 'true' / 'false'. */
const PERSON_VALUE_TEXT = `CASE j.type WHEN 'true' THEN 'true' WHEN 'false' THEN 'false'
  WHEN 'null' THEN NULL ELSE CAST(j.value AS TEXT) END`;
const PERSON_IS_NUMBER = `j.type IN ('integer', 'real')`;

// `keyParam` is added before the condition's values so positional binds follow text order.
function eventPropertyExists(keyParam: string, condition: string | null) {
  return `EXISTS (SELECT 1 FROM event_data d WHERE d.website_event_id = e.event_id AND d.data_key = ${keyParam}${
    condition ? ` AND (${condition})` : ''
  })`;
}

function personPropertyExists(keyParam: string, condition: string | null) {
  // json_valid keeps one malformed row from failing the whole query.
  return `EXISTS (SELECT 1 FROM person p, json_each(CASE WHEN json_valid(p.properties_json) THEN p.properties_json ELSE '{}' END) j
    WHERE p.website_id = s.website_id AND p.distinct_id = s.distinct_id AND j.key = ${keyParam}${
      condition ? ` AND (${condition})` : ''
    })`;
}

function numericValues(values: string[]): number[] {
  return values.map((v) => Number(v)).filter((n) => Number.isFinite(n));
}

function inList(expr: string, values: (string | number)[], params: SqlParams) {
  return `${expr} IN (${values.map((v) => params.add(v)).join(', ')})`;
}

function globAny(expr: string, pattern: string, params: SqlParams) {
  const compiled = regexToGlob(pattern);
  if (!compiled.ok) throw new InsightQueryError(compiled.reason);
  const parts = compiled.globs.map((glob) => `${expr} GLOB ${params.add(glob)}`);
  return parts.length === 1 ? parts[0]! : `(${parts.join(' OR ')})`;
}

/**
 * Positive condition on a property value (`text` = value as text, `number` = numeric value or
 * NULL). Returns null for is_set (existence alone).
 */
function valueCondition(
  filter: PropertyFilter,
  params: SqlParams,
  text: string,
  number: string,
  isNumber: string,
): string | null {
  switch (filter.operator) {
    case 'is':
    case 'is_not': {
      const values = propertyFilterValues(filter);
      const numbers = numericValues(values);
      const parts = [inList(text, values, params)];
      if (numbers.length) parts.push(`(${isNumber} AND ${inList(number, numbers, params)})`);
      return parts.join(' OR ');
    }
    case 'contains':
    case 'not_contains':
      return `${text} LIKE ${params.add(likeContainsPattern(propertyFilterText(filter)))} ESCAPE '\\'`;
    case 'regex':
    case 'not_regex':
      return globAny(text, propertyFilterText(filter), params);
    case 'gt':
    case 'lt': {
      const value = propertyFilterNumber(filter);
      if (value === null) throw new InsightQueryError(`Filter "${filter.key}" needs a number`);
      return `${isNumber} AND ${number} ${filter.operator === 'gt' ? '>' : '<'} ${params.add(value)}`;
    }
    case 'between': {
      const range = propertyFilterRange(filter);
      if (!range) throw new InsightQueryError(`Filter "${filter.key}" needs a minimum and a maximum`);
      return `${isNumber} AND ${number} BETWEEN ${params.add(range[0])} AND ${params.add(range[1])}`;
    }
    case 'is_set':
    case 'is_not_set':
      return null;
  }
}

const NEGATIVE_OPERATORS = new Set(['is_not', 'not_contains', 'not_regex', 'is_not_set']);

export type CompiledFilter = { sql: string; needsSession: boolean };

function compileDimensionFilter(filter: PropertyFilter, params: SqlParams): CompiledFilter {
  const column = dimensionColumn(filter.key);
  const col = column.sql;
  const empty = `(${col} IS NULL OR ${col} = '')`;
  let sql: string;
  switch (filter.operator) {
    case 'is':
      sql = inList(col, propertyFilterValues(filter), params);
      break;
    case 'is_not':
      sql = `(${col} IS NULL OR NOT ${inList(col, propertyFilterValues(filter), params)})`;
      break;
    case 'contains':
      sql = `${col} LIKE ${params.add(likeContainsPattern(propertyFilterText(filter)))} ESCAPE '\\'`;
      break;
    case 'not_contains':
      sql = `(${col} IS NULL OR ${col} NOT LIKE ${params.add(likeContainsPattern(propertyFilterText(filter)))} ESCAPE '\\')`;
      break;
    case 'regex':
      sql = globAny(col, propertyFilterText(filter), params);
      break;
    case 'not_regex':
      sql = `(${col} IS NULL OR NOT ${globAny(col, propertyFilterText(filter), params)})`;
      break;
    case 'is_set':
      sql = `NOT ${empty}`;
      break;
    case 'is_not_set':
      sql = empty;
      break;
    default:
      throw new InsightQueryError(`Dimension "${filter.key}" cannot be compared as a number`);
  }
  return { sql, needsSession: column.needsSession };
}

export function compilePropertyFilter(filter: PropertyFilter, params: SqlParams): CompiledFilter {
  if (filter.type === 'dimension') return compileDimensionFilter(filter, params);
  const negative = NEGATIVE_OPERATORS.has(filter.operator);
  const keyParam = params.add(filter.key);
  if (filter.type === 'event') {
    const condition = valueCondition(filter, params, EVENT_VALUE_TEXT, 'd.number_value', 'd.number_value IS NOT NULL');
    const exists = eventPropertyExists(keyParam, condition);
    return { sql: negative ? `NOT ${exists}` : exists, needsSession: false };
  }
  const condition =
    filter.operator === 'is_set' || filter.operator === 'is_not_set'
      ? `j.type != 'null'`
      : valueCondition(filter, params, PERSON_VALUE_TEXT, 'j.value', PERSON_IS_NUMBER);
  const exists = personPropertyExists(keyParam, condition);
  return { sql: negative ? `NOT ${exists}` : exists, needsSession: true };
}

/** AND of all filters; `sql` is empty when there are none. */
export function compilePropertyFilters(
  filters: readonly PropertyFilter[] | null | undefined,
  params: SqlParams,
): CompiledFilter {
  const parts: string[] = [];
  let needsSession = false;
  for (const filter of filters ?? []) {
    const compiled = compilePropertyFilter(filter, params);
    parts.push(compiled.sql);
    needsSession ||= compiled.needsSession;
  }
  return { sql: parts.join(' AND '), needsSession };
}

/** Breakdown value of an event row as text, NULL when the property is not set. */
export function breakdownValueSql(breakdown: InsightBreakdown, params: SqlParams): CompiledFilter {
  if (breakdown.type === 'dimension') {
    const column = dimensionColumn(breakdown.key);
    return { sql: `NULLIF(${column.sql}, '')`, needsSession: column.needsSession };
  }
  if (breakdown.type === 'event') {
    return {
      sql: `(SELECT ${EVENT_VALUE_TEXT} FROM event_data d WHERE d.website_event_id = e.event_id AND d.data_key = ${params.add(
        breakdown.key,
      )} LIMIT 1)`,
      needsSession: false,
    };
  }
  return {
    sql: `(SELECT ${PERSON_VALUE_TEXT} FROM person p, json_each(CASE WHEN json_valid(p.properties_json) THEN p.properties_json ELSE '{}' END) j
      WHERE p.website_id = s.website_id AND p.distinct_id = s.distinct_id AND j.key = ${params.add(breakdown.key)} LIMIT 1)`,
    needsSession: true,
  };
}

/** Numeric event property of an event row (for sum / avg / min / max / median). */
export function numericEventPropertySql(key: string, params: SqlParams): string {
  return `(SELECT d.number_value FROM event_data d WHERE d.website_event_id = e.event_id AND d.data_key = ${params.add(
    key,
  )} AND d.number_value IS NOT NULL LIMIT 1)`;
}
