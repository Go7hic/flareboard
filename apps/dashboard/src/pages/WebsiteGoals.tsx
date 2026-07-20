import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { GoalsPanel } from '../components/GoalsPanel';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { t } from '../lib/i18n';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';

export default function WebsiteGoalsPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone } =
    useWebsiteReportContext('30d');

  return (
    <Page className="page-goals">
      <PageHeader
        title={t('goals')}
        lead={t('goalLead')}
        actions={
          <WebsiteReportControls
            range={range}
            onRangeChange={setRange}
            segmentId={segmentId}
            onSegmentChange={setSegmentId}
            segments={segments}
            timezone={timezone}
          />
        }
      />

      <PageBody>
        {websiteId ? <GoalsPanel websiteId={websiteId} reportUrl={reportUrl} /> : null}
      </PageBody>
    </Page>
  );
}
