import { useParams } from 'react-router-dom';
import { CohortsPanel } from '../components/CohortsPanel';
import { t } from '../lib/i18n';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';

export default function WebsiteCohortsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();

  return (
    <Page className="page-cohorts">
      <PageHeader title={t('cohorts')} />
      <PageBody>
        {websiteId ? <CohortsPanel websiteId={websiteId} /> : null}
      </PageBody>
    </Page>
  );
}
