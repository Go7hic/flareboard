import { WebsitePageShell } from '../components/WebsitePageShell';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { GoalsPanel } from '../components/GoalsPanel';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { t } from '../lib/i18n';

export default function WebsiteGoalsPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone } =
    useWebsiteReportContext('30d');

  return (
    <div className="page page-goals">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <div className="journey-page-bar">
            <p className="journey-page-hint">{t('goalLead')}</p>
            <WebsiteReportControls
              range={range}
              onRangeChange={setRange}
              segmentId={segmentId}
              onSegmentChange={setSegmentId}
              segments={segments}
              timezone={timezone}
            />
          </div>
        }
      />

      {websiteId ? <GoalsPanel websiteId={websiteId} reportUrl={reportUrl} /> : null}
    </div>
  );
}
