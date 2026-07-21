import { useParams } from 'react-router-dom';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { RealtimeWidget } from '../components/RealtimeWidget';
import { t } from '../lib/i18n';

export default function WebsiteRealtimePage() {
  const { websiteId } = useParams<{ websiteId: string }>();

  return (
    <Page className="page-realtime" variant="bleed">
      <PageHeader title={t('realtime')} lead={t('realtimeLeadLive')} />
      <PageBody>{websiteId ? <RealtimeWidget websiteId={websiteId} /> : null}</PageBody>
    </Page>
  );
}
