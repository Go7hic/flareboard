import { useParams } from 'react-router-dom';
import { SegmentsPanel } from '../components/SegmentsPanel';
import { t } from '../lib/i18n';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
export default function WebsiteSegmentsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();

  return (
    <Page className="page-segments">
      <PageHeader title={t('segments')} lead={t('segmentsLead')} />
      <PageBody>
        {websiteId ? <SegmentsPanel websiteId={websiteId} /> : null}
      </PageBody>
    </Page>
  );
}
