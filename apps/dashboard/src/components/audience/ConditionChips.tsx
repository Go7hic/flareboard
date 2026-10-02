import type { ReactNode } from 'react';
import {
  propertyFiltersSchema,
  VALUELESS_PROPERTY_OPERATORS,
  type PropertyFilter,
} from '@flareboard/shared/insight-query';
import { t } from '../../lib/i18n';
import { getCountryLabel } from '../../lib/map-format';
import { SEGMENT_FIELD_OPTIONS, type SegmentField } from '../../lib/segment-utils';
import { countryFlagEmoji } from '../../lib/session-display';
import { dimensionLabel, filterTypeLabel, operatorLabel } from '../PropertyFilterBuilder';

/** One readable clause: "Country · equals · US". */
export type ConditionChip = {
  field: ReactNode;
  operator?: ReactNode;
  value?: ReactNode;
  /** Code-like value (paths, event names, raw keys) renders in mono. */
  mono?: boolean;
  /** Plain-text form for one-line summaries and titles. */
  text: string;
};

/** A top-level condition, optionally narrowed by property filters ("… with plan is pro"). */
export type ConditionRow = { chip: ConditionChip; filters?: ConditionChip[] };

function chip(field: string, operator: string | undefined, value: string | undefined, mono = false): ConditionChip {
  return {
    field,
    operator,
    value,
    mono,
    text: [field, operator, value].filter(Boolean).join(' '),
  };
}

function countryChip(code: string): ConditionChip {
  const flag = countryFlagEmoji(code);
  const name = getCountryLabel(code);
  return {
    field: t('segmentField_country'),
    operator: t('cohortEquals'),
    value: (
      <span title={code}>
        {flag ? `${flag} ` : ''}
        {name}
      </span>
    ),
    text: `${t('segmentField_country')} ${t('cohortEquals')} ${name}`,
  };
}

/** Property filter → chip ("Person · plan  is  pro, team"). */
export function filterChip(filter: PropertyFilter): ConditionChip {
  // Dimensions name themselves ("UTM medium"); property keys need their scope ("Person · plan").
  const field =
    filter.type === 'dimension' ? dimensionLabel(filter.key) : `${filterTypeLabel(filter.type)} · ${filter.key}`;
  let value: string | undefined;
  if (!VALUELESS_PROPERTY_OPERATORS.includes(filter.operator)) {
    if (filter.operator === 'between' && Array.isArray(filter.value)) value = filter.value.join(' – ');
    else if (Array.isArray(filter.value)) value = filter.value.join(', ');
    else if (filter.value !== null && filter.value !== undefined) value = String(filter.value);
  }
  return chip(field, operatorLabel(filter.operator), value, filter.type !== 'dimension');
}

function readFilters(raw: unknown): PropertyFilter[] {
  const parsed = propertyFiltersSchema.safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
}

/**
 * Segment parameters (`{ country: 'US', pathContains: '/blog', properties: [...] }`) as rows.
 * Unknown keys stay visible as raw `key equals value` so nothing in the JSON is hidden.
 */
export function segmentConditionRows(params: Record<string, unknown> | null | undefined): ConditionRow[] {
  const rows: ConditionRow[] = [];
  const equals = t('cohortEquals');
  for (const [key, raw] of Object.entries(params ?? {})) {
    if (key === 'properties' || raw === undefined || raw === null || raw === '') continue;
    const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : JSON.stringify(raw);
    if (key === 'pathContains') rows.push({ chip: chip(t('segmentField_path'), t('cohortContains'), value, true) });
    else if (key === 'path' || key === 'url') rows.push({ chip: chip(t('segmentField_path'), equals, value, true) });
    else if (key === 'eventName' || key === 'event') {
      rows.push({ chip: chip(t('segmentField_event_name'), equals, value, true) });
    } else if (key === 'country' && /^[A-Za-z]{2}$/.test(value)) rows.push({ chip: countryChip(value.toUpperCase()) });
    else if (SEGMENT_FIELD_OPTIONS.includes(key as SegmentField)) {
      rows.push({ chip: chip(t(`segmentField_${key}`), equals, value, key === 'hostname' || key === 'referrer') });
    } else rows.push({ chip: chip(key, equals, value, true) });
  }
  for (const filter of readFilters(params?.properties)) rows.push({ chip: filterChip(filter) });
  return rows;
}

type CohortConditionLike = { field: string; operator: string; value: string; filters?: unknown };

/** Cohort definition conditions as rows; `any_event` shows only its property filters. */
export function cohortConditionRows(conditions: CohortConditionLike[]): ConditionRow[] {
  return conditions.map((condition) => {
    const operator = condition.operator === 'contains' ? t('cohortContains') : t('cohortEquals');
    const main =
      condition.field === 'any_event'
        ? chip(t('cohortAnyEvent'), undefined, undefined)
        : condition.field === 'url_path'
          ? chip(t('cohortPath'), operator, condition.value, true)
          : condition.field === 'event_name'
            ? chip(t('cohortEvent'), operator, condition.value, true)
            : chip(condition.field, operator, condition.value, true);
    const filters = readFilters(condition.filters).map(filterChip);
    return { chip: main, filters: filters.length ? filters : undefined };
  });
}

/** One-line plain summary for list subtitles: "Country equals United States +1". */
export function conditionSummary(rows: ConditionRow[]): string {
  if (!rows.length) return '';
  const first = rows[0]!;
  const text = first.filters?.length ? `${first.chip.text} · ${first.filters[0]!.text}` : first.chip.text;
  return rows.length > 1 ? `${text} +${rows.length - 1}` : text;
}

function Chip({ chip: item }: { chip: ConditionChip }) {
  return (
    <span className="audience-chip" title={item.text}>
      <span className="audience-chip-field">{item.field}</span>
      {item.operator ? <span className="audience-chip-op">{item.operator}</span> : null}
      {item.value !== undefined ? (
        <span className={item.mono ? 'audience-chip-value mono' : 'audience-chip-value'}>{item.value}</span>
      ) : null}
    </span>
  );
}

/** Readable definition: one row per condition, joined by "and", nested filters after "with". */
export function ConditionList({ rows }: { rows: ConditionRow[] }) {
  return (
    <ol className="audience-conditions">
      {rows.map((row, index) => (
        <li key={index} className="audience-condition">
          <span className="audience-condition-join">{index === 0 ? t('audienceWhere') : t('audienceAnd')}</span>
          <span className="audience-condition-chips">
            <Chip chip={row.chip} />
            {row.filters?.map((filter, filterIndex) => (
              <span key={filterIndex} className="audience-condition-filter">
                <span className="audience-condition-with">{t('audienceWith')}</span>
                <Chip chip={filter} />
              </span>
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
}
