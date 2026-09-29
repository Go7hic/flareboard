import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  INSIGHT_DIMENSIONS,
  MAX_PROPERTY_FILTERS,
  NUMERIC_PROPERTY_OPERATORS,
  PROPERTY_OPERATORS,
  propertyFilterProblem,
  VALUELESS_PROPERTY_OPERATORS,
  type PropertyFilter,
  type PropertyFilterType,
  type PropertyOperator,
} from '@flareboard/shared/insight-query';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api, type PropertyKeyRow, type PropertyValueRow } from '../lib/api';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';

/** Observed event or person property keys of a website (for key pickers). */
export function usePropertyKeys(websiteId: string | undefined, type: 'event' | 'person', rangeQs = '') {
  return useQuery({
    queryKey: ['insight-property-keys', websiteId, type, rangeQs],
    enabled: Boolean(websiteId),
    staleTime: 60_000,
    queryFn: () =>
      api<PropertyKeyRow[]>(
        `/api/insights/property-keys?websiteId=${websiteId}&type=${type}${rangeQs ? `&${rangeQs}` : ''}`,
      ),
  });
}

function usePropertyValues(
  websiteId: string | undefined,
  type: PropertyFilterType,
  key: string,
  search: string,
  rangeQs: string,
) {
  const debounced = useDebouncedValue(search.trim(), 250);
  return useQuery({
    queryKey: ['insight-property-values', websiteId, type, key, debounced, rangeQs],
    enabled: Boolean(websiteId && key.trim()),
    staleTime: 60_000,
    queryFn: () =>
      api<PropertyValueRow[]>(
        `/api/insights/property-values?websiteId=${websiteId}&type=${type}&key=${encodeURIComponent(key.trim())}${
          debounced ? `&search=${encodeURIComponent(debounced)}` : ''
        }${rangeQs ? `&${rangeQs}` : ''}`,
      ),
  });
}

export function operatorLabel(operator: PropertyOperator) {
  return t(`propertyOperator_${operator}`);
}

export function filterTypeLabel(type: PropertyFilterType) {
  return t(`propertyFilterType_${type}`);
}

export function dimensionLabel(key: string) {
  return t(`insightDimension_${key}`);
}

/** One-line summary, e.g. `Person · plan is pro, team`. */
export function describeFilter(filter: PropertyFilter): string {
  const key = filter.type === 'dimension' ? dimensionLabel(filter.key) : filter.key;
  const value = VALUELESS_PROPERTY_OPERATORS.includes(filter.operator)
    ? ''
    : filter.operator === 'between' && Array.isArray(filter.value)
      ? ` ${filter.value.join(' – ')}`
      : ` ${valueText(filter)}`;
  return `${filterTypeLabel(filter.type)} · ${key} ${operatorLabel(filter.operator)}${value}`;
}

/** Text of a filter value for the single value input (lists are comma separated). */
function valueText(filter: PropertyFilter): string {
  if (filter.value === null || filter.value === undefined) return '';
  if (Array.isArray(filter.value)) return filter.value.join(', ');
  return String(filter.value);
}

function parseValue(operator: PropertyOperator, text: string): PropertyFilter['value'] {
  if (operator === 'is' || operator === 'is_not') {
    return text
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return text;
}

function FilterRow({
  websiteId,
  filter,
  onChange,
  onRemove,
  rangeQs,
  allowedTypes,
}: {
  websiteId: string | undefined;
  filter: PropertyFilter;
  onChange: (next: PropertyFilter) => void;
  onRemove: () => void;
  rangeQs: string;
  allowedTypes: readonly PropertyFilterType[];
}) {
  const id = useId();
  const [valueDraft, setValueDraft] = useState(() => valueText(filter));
  // Rows are keyed by position: resync the draft when a different filter lands in this row
  // (removal above it, a loaded insight), but keep in-progress text such as "a, ".
  useEffect(() => {
    if (JSON.stringify(parseValue(filter.operator, valueDraft)) !== JSON.stringify(filter.value ?? null)) {
      setValueDraft(valueText(filter));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.value, filter.operator]);
  const keys = usePropertyKeys(websiteId, filter.type === 'person' ? 'person' : 'event', rangeQs);
  const values = usePropertyValues(
    websiteId,
    filter.type,
    filter.key,
    filter.operator === 'is' || filter.operator === 'is_not' ? (valueDraft.split(',').pop() ?? '') : valueDraft,
    rangeQs,
  );
  const numeric = NUMERIC_PROPERTY_OPERATORS.includes(filter.operator);
  const valueless = VALUELESS_PROPERTY_OPERATORS.includes(filter.operator);
  const operators = PROPERTY_OPERATORS.filter(
    (operator) => filter.type !== 'dimension' || !NUMERIC_PROPERTY_OPERATORS.includes(operator),
  );
  const problem = filter.key.trim() ? propertyFilterProblem(filter) : null;
  const range = Array.isArray(filter.value) ? filter.value : [];

  function setOperator(operator: PropertyOperator) {
    const next: PropertyFilter = { ...filter, operator };
    if (VALUELESS_PROPERTY_OPERATORS.includes(operator)) next.value = null;
    else if (operator === 'between') next.value = ['', ''];
    else next.value = parseValue(operator, valueDraft);
    onChange(next);
  }

  return (
    <div className="property-filter-row">
      <select
        className="select property-filter-type"
        aria-label={t('propertyFilterTypeLabel')}
        value={filter.type}
        onChange={(event) => {
          const type = event.target.value as PropertyFilterType;
          const operator =
            type === 'dimension' && NUMERIC_PROPERTY_OPERATORS.includes(filter.operator) ? 'is' : filter.operator;
          onChange({ type, key: type === 'dimension' ? 'path' : '', operator, value: operator === 'is' ? [] : filter.value });
          setValueDraft('');
        }}
      >
        {allowedTypes.map((type) => (
          <option key={type} value={type}>
            {filterTypeLabel(type)}
          </option>
        ))}
      </select>

      {filter.type === 'dimension' ? (
        <select
          className="select property-filter-key"
          aria-label={t('propertyFilterKey')}
          value={filter.key}
          onChange={(event) => onChange({ ...filter, key: event.target.value })}
        >
          {INSIGHT_DIMENSIONS.map((dimension) => (
            <option key={dimension} value={dimension}>
              {dimensionLabel(dimension)}
            </option>
          ))}
        </select>
      ) : (
        <>
          <Input
            className="property-filter-key"
            aria-label={t('propertyFilterKey')}
            placeholder={t('propertyFilterKeyPlaceholder')}
            list={`${id}-keys`}
            value={filter.key}
            onChange={(event) => onChange({ ...filter, key: event.target.value })}
          />
          <datalist id={`${id}-keys`}>
            {(keys.data ?? []).map((row) => (
              <option key={row.key} value={row.key} />
            ))}
          </datalist>
        </>
      )}

      <select
        className="select property-filter-operator"
        aria-label={t('propertyFilterOperator')}
        value={filter.operator}
        onChange={(event) => setOperator(event.target.value as PropertyOperator)}
      >
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {operatorLabel(operator)}
          </option>
        ))}
      </select>

      {valueless ? null : filter.operator === 'between' ? (
        <div className="property-filter-range">
          <Input
            type="number"
            aria-label={t('propertyFilterMin')}
            placeholder={t('propertyFilterMin')}
            value={String(range[0] ?? '')}
            onChange={(event) => onChange({ ...filter, value: [event.target.value, String(range[1] ?? '')] })}
          />
          <Input
            type="number"
            aria-label={t('propertyFilterMax')}
            placeholder={t('propertyFilterMax')}
            value={String(range[1] ?? '')}
            onChange={(event) => onChange({ ...filter, value: [String(range[0] ?? ''), event.target.value] })}
          />
        </div>
      ) : (
        <>
          <Input
            className="property-filter-value"
            type={numeric ? 'number' : 'text'}
            aria-label={t('propertyFilterValue')}
            placeholder={
              filter.operator === 'is' || filter.operator === 'is_not'
                ? t('propertyFilterValuesPlaceholder')
                : filter.operator === 'regex' || filter.operator === 'not_regex'
                  ? '^/blog/.*'
                  : t('propertyFilterValue')
            }
            list={numeric ? undefined : `${id}-values`}
            value={valueDraft}
            onChange={(event) => {
              setValueDraft(event.target.value);
              onChange({ ...filter, value: parseValue(filter.operator, event.target.value) });
            }}
          />
          {numeric ? null : (
            <datalist id={`${id}-values`}>
              {(values.data ?? []).map((row) => (
                <option key={row.value} value={row.value} />
              ))}
            </datalist>
          )}
        </>
      )}

      <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={t('propertyFilterRemove')}>
        <X aria-hidden size={14} strokeWidth={2} />
      </Button>
      {problem ? (
        <p className="property-filter-problem text-muted" role="status">
          {filter.operator === 'regex' || filter.operator === 'not_regex'
            ? t('propertyFilterRegexHint')
            : t('propertyFilterIncomplete')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Editable list of property filters (AND). Key pickers suggest observed event / person keys;
 * value inputs suggest observed values. Incomplete rows are kept in state but callers should
 * send `completeFilters(filters)` to the API.
 */
export function PropertyFilterBuilder({
  websiteId,
  value,
  onChange,
  rangeQs = '',
  allowedTypes = ['event', 'person', 'dimension'],
  addLabel,
}: {
  websiteId: string | undefined;
  value: PropertyFilter[];
  onChange: (next: PropertyFilter[]) => void;
  /** `startAt=…&endAt=…` so suggestions match the analysed period. */
  rangeQs?: string;
  allowedTypes?: readonly PropertyFilterType[];
  addLabel?: string;
}) {
  return (
    <div className="property-filter-builder">
      {value.map((filter, index) => (
        <FilterRow
          key={index}
          websiteId={websiteId}
          filter={filter}
          rangeQs={rangeQs}
          allowedTypes={allowedTypes}
          onChange={(next) => onChange(value.map((item, i) => (i === index ? next : item)))}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
        />
      ))}
      {value.length < MAX_PROPERTY_FILTERS ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const type = allowedTypes[0] ?? 'event';
            onChange([...value, { type, key: type === 'dimension' ? 'path' : '', operator: 'is', value: [] }]);
          }}
        >
          {addLabel ?? t('propertyFilterAdd')}
        </Button>
      ) : null}
    </div>
  );
}
