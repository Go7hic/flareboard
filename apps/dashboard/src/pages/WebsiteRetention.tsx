import { useQuery } from '@tanstack/react-query';
import { DataViewState } from '../components/DataViewState';
import { RetentionHeatmap } from '../components/RetentionHeatmap';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';

export default function WebsiteRetentionPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone } =
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
    <Page className="page-retention">
      <PageHeader
        title={t('retention')}
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
      <section className="panel section-gap">
        <DataViewState
          loading={retentionQuery.isLoading}
          error={retentionQuery.isError ? retentionQuery.error : null}
          onRetry={() => retentionQuery.refetch()}
          isEmpty={!retentionQuery.isLoading && (retentionQuery.data?.cohorts ?? []).length === 0}
          emptyTitle={t('noDataInPeriod')}
        >
          <RetentionHeatmap cohorts={retentionQuery.data?.cohorts ?? []} />
        </DataViewState>
      </section>
      </PageBody>
    </Page>
  );
}
