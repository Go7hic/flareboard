import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '../components/EmptyState';
import { RetentionHeatmap } from '../components/RetentionHeatmap';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { t } from '../lib/i18n';

export default function WebsiteRetentionPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl } =
    useWebsiteReportContext('30d');

  const retentionQuery = useQuery({
    queryKey: ['reports-retention', websiteId, range, segmentId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<{ cohorts: Array<{ cohortWeek: string; weekOffset: number; users: number }> }>(
        reportUrl('retention'),
      ),
  });

  return (
    <div className="page page-retention">
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
      <section className="panel section-gap">
        {retentionQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : (retentionQuery.data?.cohorts ?? []).length === 0 ? (
          <EmptyState title={t('noDataInPeriod')} />
        ) : (
          <RetentionHeatmap cohorts={retentionQuery.data?.cohorts ?? []} />
        )}
      </section>
    </div>
  );
}
