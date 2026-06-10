import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { EventDataPanel } from '../components/EventDataPanel';
import { MetricsTable } from '../components/MetricsTable';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { api, type MetricRow } from '../lib/api';
import { t } from '../lib/i18n';

export default function WebsiteEventsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();

  const eventsQuery = useQuery({
    queryKey: ['events', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<MetricRow[]>(`/api/websites/${websiteId}/events`),
  });

  return (
    <div className="page page-events">
      <WebsitePageShell websiteId={websiteId} />
      <section className="panel section-gap custom-events-panel">
        <MetricsTable
          embedded
          title={t('customEvents')}
          rows={eventsQuery.data ?? []}
          loading={eventsQuery.isLoading}
        />
      </section>
      {websiteId ? <EventDataPanel websiteId={websiteId} /> : null}
    </div>
  );
}
