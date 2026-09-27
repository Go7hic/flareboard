import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { t } from '../lib/i18n';

interface StatRow {
  value: string;
  total: number;
}

export function EventDataPanel({ websiteId }: { websiteId: string }) {
  const [property, setProperty] = useState('');

  const propertiesQuery = useQuery({
    queryKey: ['event-data-properties', websiteId],
    queryFn: () => api<string[]>(`/api/websites/${websiteId}/event-data/properties`),
  });

  const statsQuery = useQuery({
    queryKey: ['event-data-stats', websiteId, property],
    enabled: Boolean(property),
    queryFn: () =>
      api<StatRow[]>(
        `/api/websites/${websiteId}/event-data/stats?propertyName=${encodeURIComponent(property)}`,
      ),
  });

  const sessionPropsQuery = useQuery({
    queryKey: ['session-data-properties', websiteId],
    queryFn: () => api<string[]>(`/api/websites/${websiteId}/session-data/properties`),
  });

  const properties = propertiesQuery.data ?? [];

  return (
    <section className="panel section-gap-lg">
      <h2 className="section-title">{t('eventDataTitle')}</h2>
      <p className="section-lead">{t('eventDataLead')}</p>
      {propertiesQuery.isLoading ? (
        <div className="skeleton skeleton-block section-gap" aria-hidden />
      ) : properties.length ? (
        <>
          <select
            className="select"
            value={property}
            onChange={(e) => setProperty(e.target.value)}
            aria-label={t('eventDataSelectProperty')}
          >
            <option value="">{t('eventDataSelectProperty')}</option>
            {properties.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {property && statsQuery.isLoading ? (
            <div className="skeleton skeleton-block section-gap" aria-hidden />
          ) : property && statsQuery.data?.length ? (
            <ul className="list-plain section-gap">
              {statsQuery.data.map((row) => (
                <li key={row.value} className="list-item list-row">
                  <span>{row.value}</span>
                  <strong className="list-row-value">{row.total}</strong>
                </li>
              ))}
            </ul>
          ) : property ? (
            <p className="text-muted event-data-note">{t('eventDataNoValues')}</p>
          ) : null}
        </>
      ) : (
        <p className="text-muted event-data-note">
          {t('eventDataEmpty')} <code>flareboard.track('event', {'{'} key: 'value' {'}'})</code>
        </p>
      )}
      {sessionPropsQuery.data?.length ? (
        <p className="text-muted event-data-note event-data-traits">
          {t('eventDataSessionTraits')}: {sessionPropsQuery.data.join(', ')}
        </p>
      ) : null}
    </section>
  );
}
