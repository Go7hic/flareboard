import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Braces } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { BreakdownList } from './BreakdownList';
import { EmptyState } from './EmptyState';
import { SectionCard } from './SectionCard';
import { formatShare } from './traffic/format';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Skeleton } from './ui/skeleton';

interface StatRow {
  value: string;
  total: number;
}

const VALUE_LIMIT = 12;
/** The stats endpoint returns at most this many values; shares are exact only below it. */
const API_VALUE_LIMIT = 50;

/**
 * Value distribution of one event property across every event in the period, plus the
 * session traits sent with identify(). Follows the page's date range.
 */
export function EventDataPanel({ websiteId, rangeQs }: { websiteId: string; rangeQs: string }) {
  const [property, setProperty] = useState('');

  // Properties with their send counts, most used first (the picker order and its default).
  const fieldsQuery = useQuery({
    queryKey: ['event-data-fields', websiteId, rangeQs],
    placeholderData: keepPreviousData,
    queryFn: () => api<Array<{ field: string; count: number }>>(`/api/websites/${websiteId}/event-data/fields?${rangeQs}`),
  });

  const sessionPropsQuery = useQuery({
    queryKey: ['session-data-properties', websiteId, rangeQs],
    placeholderData: keepPreviousData,
    queryFn: () => api<string[]>(`/api/websites/${websiteId}/session-data/properties?${rangeQs}`),
  });

  const properties = useMemo(() => (fieldsQuery.data ?? []).map((row) => row.field), [fieldsQuery.data]);

  // Start on the most used property a person sent (not a system `$` key), so the card shows data.
  useEffect(() => {
    if (!properties.length) return;
    if (property && properties.includes(property)) return;
    setProperty(properties.find((name) => !name.startsWith('$')) ?? properties[0]);
  }, [properties, property]);

  const statsQuery = useQuery({
    queryKey: ['event-data-stats', websiteId, property, rangeQs],
    enabled: Boolean(property),
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<StatRow[]>(
        `/api/websites/${websiteId}/event-data/stats?propertyName=${encodeURIComponent(property)}&${rangeQs}`,
      ),
  });

  const rows = statsQuery.data ?? [];
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const complete = rows.length < API_VALUE_LIMIT;
  const max = Math.max(1, ...rows.map((row) => row.total));
  const traits = sessionPropsQuery.data ?? [];

  const picker = properties.length ? (
    <Select
      value={property || null}
      onValueChange={(next) => setProperty(typeof next === 'string' ? next : '')}
      items={properties.map((name) => ({ value: name, label: name }))}
    >
      <SelectTrigger size="sm" className="traffic-select" aria-label={t('eventDataSelectProperty')}>
        <SelectValue placeholder={t('eventDataSelectProperty')} className="mono" />
      </SelectTrigger>
      <SelectContent>
        {properties.map((name) => (
          <SelectItem key={name} value={name} className="mono">
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : null;

  return (
    <SectionCard
      title={t('trafficPropertyValuesTitle')}
      description={t('trafficPropertyValuesLead')}
      actions={picker}
      footer={
        traits.length ? (
          <span className="traffic-traits">
            <span>{t('eventDataSessionTraits')}</span>
            <span className="traffic-chips">
              {traits.map((trait) => (
                <span key={trait} className="traffic-chip mono">
                  {trait}
                </span>
              ))}
            </span>
          </span>
        ) : undefined
      }
    >
      {fieldsQuery.isLoading ? (
        <div className="traffic-skeleton-rows" aria-hidden>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-8 w-1/2" />
        </div>
      ) : !properties.length ? (
        <EmptyState
          icon={<Braces />}
          title={t('trafficPropertiesEmptyTitle')}
          description={
            <>
              {t('trafficPropertiesEmptyBody')} <code>flareboard.track('signup', {'{'} plan: 'pro' {'}'})</code>
            </>
          }
        />
      ) : statsQuery.isLoading ? (
        <div className="traffic-skeleton-rows" aria-hidden>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      ) : rows.length ? (
        <BreakdownList
          labelHeader={t('value')}
          columns={complete ? [{ label: t('events') }, { label: t('trafficShare') }] : [{ label: t('events') }]}
          items={rows.slice(0, VALUE_LIMIT).map((row) => ({
            id: row.value,
            label: row.value,
            title: row.value,
            mono: true,
            share: row.total / max,
            values: complete
              ? [formatNumber(row.total), formatShare(total ? row.total / total : null)]
              : [formatNumber(row.total)],
          }))}
        />
      ) : (
        <p className="traffic-section-empty">{t('trafficPropertyNoValues')}</p>
      )}
    </SectionCard>
  );
}
