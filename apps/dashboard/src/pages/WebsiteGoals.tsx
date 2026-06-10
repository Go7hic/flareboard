import { WebsitePageShell } from '../components/WebsitePageShell';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { GoalsPanel } from '../components/GoalsPanel';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';

export default function WebsiteGoalsPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl } =
    useWebsiteReportContext('30d');

  return (
    <div className="page page-goals">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <WebsiteReportControls
            range={range}
            onRangeChange={setRange}
            segmentId={segmentId}
            onSegmentChange={setSegmentId}
            segments={segments}
          />
        }
      />

      {websiteId ? <GoalsPanel websiteId={websiteId} reportUrl={reportUrl} /> : null}
    </div>
  );
}
