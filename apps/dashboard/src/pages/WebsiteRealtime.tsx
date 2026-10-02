import { useParams } from 'react-router-dom';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { RealtimeWidget } from '../components/RealtimeWidget';
import { useRealtimeData } from '../hooks/useRealtimeData';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';

function RealtimeReport({ websiteId }: { websiteId: string }) {
  const { data, isLoading, sseConnected, error, refetch } = useRealtimeData(websiteId);
  return (
    <Page className="page-realtime">
      <PageHeader
        title={t('realtime')}
        lead={t('realtimeLeadLive')}
        actions={
          <span
            className={cn('traffic-live-status', sseConnected && 'is-live')}
            role="status"
            aria-live="polite"
            title={sseConnected ? t('trafficLiveStreaming') : t('realtimePolling')}
          >
            <span className={cn('live-dot', !sseConnected && 'is-idle')} aria-hidden />
            {sseConnected ? t('trafficLive') : t('realtimePolling')}
          </span>
        }
      />
      <PageBody>
        <RealtimeWidget
          websiteId={websiteId}
          data={data}
          isLoading={isLoading}
          error={error instanceof Error ? error : null}
          onRetry={() => refetch()}
        />
      </PageBody>
    </Page>
  );
}

export default function WebsiteRealtimePage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  if (!websiteId) return null;
  return <RealtimeReport websiteId={websiteId} />;
}
